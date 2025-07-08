import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { 
  ContentElement, 
  Chunk, 
  ChunkMetadata,
  TableData,
  MAJOR_SECTIONS,
  ProcessingConfig 
} from '../types/index.js';

export class S1Processor {
  private contentListPath: string;
  private outputDir: string;
  private config: ProcessingConfig;
  
  constructor(
    contentListPath: string, 
    outputDir: string,
    config: Partial<ProcessingConfig> = {}
  ) {
    this.contentListPath = contentListPath;
    this.outputDir = outputDir;
    this.config = {
      chunkSize: 1800, // Increased from 512 for better context preservation
      chunkOverlap: 300, // Increased from 50 for better context continuity  
      separator: '\n',
      extractMetadata: true,
      ...config
    };
  }

  async loadContentList(): Promise<ContentElement[]> {
    try {
      const data = await readFile(this.contentListPath, 'utf-8');
      return JSON.parse(data) as ContentElement[];
    } catch (error) {
      throw new Error(`Failed to load content list: ${error}`);
    }
  }

  classifyElement(element: ContentElement): 'MAJOR_HEADING' | 'HEADING' | 'TABLE' | 'TEXT' {
    const { type, text, text_level } = element;
    
    if (type === 'table') {
      return 'TABLE';
    }
    
    if (text) {
      const normalizedText = text.trim().toUpperCase();
      
      // Check for exact major section matches
      if (MAJOR_SECTIONS.includes(normalizedText as any)) {
        return 'MAJOR_HEADING';
      }
      
      // Check for partial matches with key financial sections
      const financialSections = [
        'MANAGEMENT\'S DISCUSSION AND ANALYSIS',
        'FINANCIAL STATEMENTS',
        'RESULTS OF OPERATIONS',
        'LIQUIDITY AND CAPITAL RESOURCES',
        'CONSOLIDATED STATEMENTS'
      ];
      
      for (const section of financialSections) {
        if (normalizedText.includes(section)) {
          return 'MAJOR_HEADING';
        }
      }
      
      // Standard heading detection
      if (text_level && text_level > 0) {
        return 'HEADING';
      }
      
      // Additional heading patterns for financial content
      if (normalizedText.match(/^(REVENUE|INCOME|EARNINGS|FINANCIAL|RESULTS|OPERATIONS|LIQUIDITY|CAPITAL|OWNERSHIP|STOCKHOLDERS)/)) {
        return 'HEADING';
      }
    }
    
    return 'TEXT';
  }

  async processDocument(): Promise<{ chunks: Chunk[], tables: TableData[] }> {
    console.log('Loading S-1 content list...');
    const elements = await this.loadContentList();
    console.log(`Loaded ${elements.length} elements`);

    // State tracking
    const allChunks: Chunk[] = [];
    const allTables: TableData[] = [];
    let currentChunkContent: string[] = [];
    let currentSectionPath: string[] = [];
    let chunkId = 0;
    let tableCounter = 0;

    // Ensure output directories exist
    await mkdir(this.outputDir, { recursive: true });
    await mkdir(join(this.outputDir, 'tables'), { recursive: true });

    console.log('Processing document elements...');
    
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      const elemType = this.classifyElement(element);
      const content = element.text?.trim() || '';

      switch (elemType) {
        case 'MAJOR_HEADING':
        case 'HEADING':
          // Save previous chunk if exists
          if (currentChunkContent.length > 0) {
            const chunk = this.createChunk(
              chunkId++,
              currentChunkContent.join('\n\n'),
              currentSectionPath,
              elements[i - 1]?.page_idx || 0
            );
            allChunks.push(chunk);
            currentChunkContent = [];
          }

          // Update section path with enhanced tracking
          if (elemType === 'MAJOR_HEADING') {
            currentSectionPath = [content];
            console.log(`📁 Major Section: ${content}`);
          } else {
            // For sub-headings, maintain hierarchy with better logic
            const level = element.text_level || 2;
            
            // Keep only the parent sections up to this level
            const maxParentSections = Math.max(0, level - 1);
            if (currentSectionPath.length > maxParentSections) {
              currentSectionPath = currentSectionPath.slice(0, maxParentSections);
            }
            
            // Add current heading
            currentSectionPath.push(content);
            console.log(`📂 Sub-section (level ${level}): ${currentSectionPath.join(' > ')}`);
          }

          // Add heading to new chunk
          currentChunkContent.push(`# ${content}`);
          break;

        case 'TABLE':
          tableCounter++;
          const tableData = await this.processTable(element, tableCounter, currentSectionPath);
          if (tableData) {
            allTables.push(tableData);
            
            // Create enriched table description for better discoverability
            const sectionContext = currentSectionPath.join(' > ');
            const tableDescription = this.generateTableDescription(element, tableData, sectionContext);
            
            const tableRef = `\n[TABLE ${tableCounter}] ${tableDescription}\n` +
                            `Section: ${sectionContext}\n` +
                            `Dimensions: ${tableData.rows} rows × ${tableData.cols} columns\n` +
                            `File: ${tableData.filename}\n`;
            
            currentChunkContent.push(tableRef);
          }
          break;

        case 'TEXT':
          if (content) {
            currentChunkContent.push(content);
            
            // Check if we need to split chunk due to size
            const currentText = currentChunkContent.join('\n\n');
            if (currentText.length > this.config.chunkSize) {
              // Find optimal split point using semantic boundaries
              const splitChunks = this.splitTextAtSemanticBoundaries(
                currentText, 
                this.config.chunkSize, 
                this.config.chunkOverlap
              );
              
              // Create chunks from splits
              for (let i = 0; i < splitChunks.length - 1; i++) {
                const chunk = this.createChunk(
                  chunkId++,
                  splitChunks[i],
                  currentSectionPath,
                  element.page_idx
                );
                allChunks.push(chunk);
              }
              
              // Keep the last split as current content for overlap
              currentChunkContent = [splitChunks[splitChunks.length - 1]];
            }
          }
          break;
      }

      // Progress indicator
      if (i % 100 === 0) {
        console.log(`Processed ${i}/${elements.length} elements...`);
      }
    }

    // Save the last chunk
    if (currentChunkContent.length > 0) {
      const chunk = this.createChunk(
        chunkId++,
        currentChunkContent.join('\n\n'),
        currentSectionPath,
        elements[elements.length - 1]?.page_idx || 0
      );
      allChunks.push(chunk);
    }

    console.log(`Processing complete: ${allChunks.length} chunks, ${allTables.length} tables`);
    
    return { chunks: allChunks, tables: allTables };
  }

  private splitTextAtSemanticBoundaries(
    text: string, 
    maxChunkSize: number, 
    overlap: number
  ): string[] {
    if (text.length <= maxChunkSize) {
      return [text];
    }

    const chunks: string[] = [];
    let currentPos = 0;

    while (currentPos < text.length) {
      let endPos = Math.min(currentPos + maxChunkSize, text.length);
      
      // If we're not at the end, try to find a better split point
      if (endPos < text.length) {
        // Look for semantic boundaries in order of preference
        const boundaries = [
          /\n\n/g,  // Paragraph breaks (highest priority)
          /\. /g,   // Sentence endings  
          /\; /g,   // Semicolons
          /\, /g,   // Commas
          /\s/g     // Any whitespace (fallback)
        ];
        
        let bestSplit = endPos;
        
        for (const boundary of boundaries) {
          const searchStart = Math.max(currentPos, endPos - 200); // Look back up to 200 chars
          const searchText = text.substring(searchStart, endPos);
          const matches = Array.from(searchText.matchAll(boundary));
          
          if (matches.length > 0) {
            // Take the last match (closest to end)
            const lastMatch = matches[matches.length - 1];
            bestSplit = searchStart + lastMatch.index! + lastMatch[0].length;
            break;
          }
        }
        
        endPos = bestSplit;
      }

      const chunk = text.substring(currentPos, endPos).trim();
      if (chunk) {
        chunks.push(chunk);
      }

      // Move forward with overlap
      currentPos = Math.max(currentPos + 1, endPos - overlap);
    }

    return chunks;
  }

  private generateTableDescription(
    element: ContentElement, 
    tableData: TableData, 
    sectionContext: string
  ): string {
    // Use table caption if available
    if (element.table_caption && element.table_caption.length > 0) {
      return element.table_caption.join(' ');
    }
    
    // Generate description based on section context and filename
    const filename = tableData.filename.toLowerCase();
    
    if (filename.includes('revenue') || filename.includes('income') || filename.includes('financial')) {
      return 'Financial performance data including revenue, income, and operating metrics';
    }
    
    if (filename.includes('ownership') || filename.includes('stockholder') || filename.includes('equity')) {
      return 'Ownership structure and stockholder information';
    }
    
    if (filename.includes('capitalization')) {
      return 'Capitalization table showing share structure and ownership percentages';
    }
    
    if (filename.includes('dilution')) {
      return 'Share dilution analysis for IPO investors';
    }
    
    if (filename.includes('compensation') || filename.includes('executive')) {
      return 'Executive compensation and equity awards information';
    }
    
    if (sectionContext.toLowerCase().includes('financial')) {
      return 'Financial data table';
    }
    
    if (sectionContext.toLowerCase().includes('management')) {
      return 'Management discussion and analysis supporting data';
    }
    
    // Fallback description
    return `Data table from ${sectionContext} section`;
  }

  private createChunk(
    id: number, 
    content: string, 
    sectionPath: string[],
    pageIdx: number
  ): Chunk {
    const metadata: ChunkMetadata = {
      id: `figma-s1-chunk-${String(id).padStart(4, '0')}`,
      text: content,
      section_path: sectionPath,
      section_hierarchy: sectionPath.join(' > '),
      page_idx: pageIdx,
      chunk_type: 'text',
      chunk_size: content.length,
      timestamp: new Date().toISOString()
    };

    return {
      id: metadata.id,
      content,
      metadata
    };
  }

  private async processTable(
    element: ContentElement, 
    tableNum: number, 
    sectionPath: string[]
  ): Promise<TableData | null> {
    if (!element.table_body) return null;

    try {
      // Parse HTML table (simplified - in production use a proper HTML parser)
      const rows = this.parseHTMLTable(element.table_body);
      
      if (rows.length === 0) return null;

      // Generate descriptive filename
      const sectionSlug = sectionPath[sectionPath.length - 1]
        ?.toLowerCase()
        .split(' ')
        .slice(0, 3)
        .join('_') || 'unknown';
      const filename = `table_${String(tableNum).padStart(3, '0')}_${sectionSlug}.csv`;

      // Save as CSV
      const csvContent = this.convertToCSV(rows);
      const filepath = join(this.outputDir, 'tables', filename);
      await writeFile(filepath, csvContent, 'utf-8');

      return {
        filename,
        section: sectionPath[sectionPath.length - 1] || 'Unknown',
        rows: rows.length,
        cols: rows[0]?.length || 0,
        data: rows
      };
    } catch (error) {
      console.warn(`Warning: Could not parse table ${tableNum}: ${error}`);
      return null;
    }
  }

  private parseHTMLTable(html: string): string[][] {
    // Simple regex-based HTML table parser
    // In production, use a proper HTML parser like cheerio
    const rows: string[][] = [];
    const rowMatches = html.match(/<tr[^>]*>(.*?)<\/tr>/gs) || [];
    
    for (const rowHtml of rowMatches) {
      const cells: string[] = [];
      const cellMatches = rowHtml.match(/<t[dh][^>]*>(.*?)<\/t[dh]>/gs) || [];
      
      for (const cellHtml of cellMatches) {
        const cellText = cellHtml
          .replace(/<[^>]+>/g, '') // Remove HTML tags
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#x27;/g, "'")
          .trim();
        cells.push(cellText);
      }
      
      if (cells.length > 0) {
        rows.push(cells);
      }
    }
    
    return rows;
  }

  private convertToCSV(data: string[][]): string {
    return data.map(row => 
      row.map(cell => {
        // Escape quotes and wrap in quotes if contains comma, newline, or quotes
        const escaped = cell.replace(/"/g, '""');
        return /[,\n"]/.test(cell) ? `"${escaped}"` : escaped;
      }).join(',')
    ).join('\n');
  }

  async saveOutputs(chunks: Chunk[]): Promise<void> {
    // Save chunks as JSONL
    const jsonlPath = join(this.outputDir, 'text_chunks.jsonl');
    const jsonlContent = chunks.map(chunk => JSON.stringify(chunk)).join('\n');
    await writeFile(jsonlPath, jsonlContent, 'utf-8');
    console.log(`✓ Saved ${chunks.length} chunks to ${jsonlPath}`);

    // Create Mastra-ready format
    const mastraFormat = {
      source: 'Figma S-1 Filing',
      processing_date: new Date().toISOString(),
      statistics: {
        total_chunks: chunks.length,
        total_tables: (await this.getTableCount()),
        sections: [...new Set(chunks.map(c => c.metadata.section_path[0]).filter(Boolean))].length
      },
      chunks: chunks
    };

    const mastraPath = join(this.outputDir, 'mastra_import.json');
    await writeFile(mastraPath, JSON.stringify(mastraFormat, null, 2), 'utf-8');
    console.log(`✓ Created Mastra import file at ${mastraPath}`);
  }

  private async getTableCount(): Promise<number> {
    try {
      const { readdir } = await import('fs/promises');
      const files = await readdir(join(this.outputDir, 'tables'));
      return files.filter(f => f.endsWith('.csv')).length;
    } catch {
      return 0;
    }
  }
}