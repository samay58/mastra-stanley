import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import * as cheerio from 'cheerio';
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
  private filingId: string;
  private sourceUrl?: string;
  
  constructor(
    contentListPath: string, 
    outputDir: string,
    config: Partial<ProcessingConfig> = {},
    context: { filingId?: string; sourceUrl?: string } = {}
  ) {
    this.contentListPath = contentListPath;
    this.outputDir = outputDir;
    this.filingId = (context.filingId || 'figma').trim();
    this.sourceUrl = context.sourceUrl;
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
    let currentAnchor: string | undefined;
    let currentChunkAnchor: string | undefined;
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
      const elementAnchor = element.anchor?.trim() || undefined;

      switch (elemType) {
        case 'MAJOR_HEADING':
        case 'HEADING':
          // Save previous chunk if exists
          if (currentChunkContent.length > 0) {
            const chunk = this.createChunk(
              chunkId++,
              currentChunkContent.join('\n\n'),
              currentSectionPath,
              elements[i - 1]?.page_idx || 0,
              currentChunkAnchor || currentAnchor
            );
            allChunks.push(chunk);
            currentChunkContent = [];
            currentChunkAnchor = undefined;
          }

          // Update section path with enhanced tracking
          if (elemType === 'MAJOR_HEADING') {
            currentSectionPath = [content];
            console.log(`📁 Major Section: ${content}`);
          } else {
            // For sub-headings, maintain hierarchy with better logic
            const levelRaw = element.text_level || 2;
            // Many extracted filings don't reliably encode heading levels.
            // Treat level 1 headings as "child of major section" rather than a new root.
            const level = Math.max(2, levelRaw);
            
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
          if (elementAnchor) {
            currentAnchor = elementAnchor;
          }
          if (!currentChunkAnchor && elementAnchor) {
            currentChunkAnchor = elementAnchor;
          }
          currentChunkContent.push(`# ${content}`);
          break;

        case 'TABLE':
          tableCounter++;
          if (elementAnchor) {
            currentAnchor = elementAnchor;
          }
          if (!currentChunkAnchor && (elementAnchor || currentAnchor)) {
            currentChunkAnchor = elementAnchor || currentAnchor;
          }
          const tableAnchor = elementAnchor || currentAnchor;
          const tableData = await this.processTable(element, tableCounter, currentSectionPath, tableAnchor);
          if (tableData) {
            allTables.push(tableData);
            
            // Create enriched table description for better discoverability
            const sectionContext = currentSectionPath.join(' > ');
            const tableDescription = this.generateTableDescription(element, tableData, sectionContext);
            
            const tableRef = `\n[TABLE ${tableCounter}] ${tableDescription}\n` +
                            `Section: ${sectionContext}\n` +
                            `Dimensions: ${tableData.rows} rows × ${tableData.cols} columns\n` +
                            `File: ${tableData.filename}\n` +
                            (tableData.anchor ? `Anchor: ${tableData.anchor}\n` : '');
            
            currentChunkContent.push(tableRef);

            // Also index a table-focused chunk so retrieval can land on exact numeric context,
            // then tools can refine via CSV/table resolvers.
            const tableChunk = this.createChunk(
              chunkId++,
              this.formatTableChunkContent(tableCounter, tableDescription, sectionContext, tableData),
              currentSectionPath,
              element.page_idx,
              tableData.anchor,
              'table_reference'
            );
            allChunks.push(tableChunk);
          }
          break;

        case 'TEXT':
          if (content) {
            if (elementAnchor) {
              currentAnchor = elementAnchor;
              if (!currentChunkAnchor) {
                currentChunkAnchor = elementAnchor;
              }
            }
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
                  element.page_idx,
                  currentChunkAnchor || currentAnchor
                );
                allChunks.push(chunk);
              }
              
              // Keep the last split as current content for overlap
              currentChunkContent = [splitChunks[splitChunks.length - 1]];
              currentChunkAnchor = currentChunkAnchor || currentAnchor;
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
        elements[elements.length - 1]?.page_idx || 0,
        currentChunkAnchor || currentAnchor
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

      // If we consumed to the end of the input, stop. Continuing with overlap would create
      // a tail of near-duplicate chunks (pathological chunk explosion).
      if (endPos >= text.length) {
        break;
      }

      // Move forward with overlap.
      // `endPos - overlap` should normally advance us by ~maxChunkSize-overlap. The
      // `currentPos + 1` guard ensures progress even if overlap params are misconfigured.
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
    pageIdx: number,
    anchor?: string,
    chunkType: ChunkMetadata['chunk_type'] = 'text'
  ): Chunk {
    const padded = String(id).padStart(5, '0');
    const metadata: ChunkMetadata = {
      id: `${this.filingId}-chunk-${padded}`,
      filing_id: this.filingId,
      text: content,
      section_path: sectionPath,
      section_hierarchy: sectionPath.join(' > '),
      page_idx: pageIdx,
      anchor,
      source_url: this.sourceUrl,
      chunk_type: chunkType,
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
    sectionPath: string[],
    anchor?: string
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
        anchor,
        caption: element.table_caption?.join(' ') || undefined,
        source_url: this.sourceUrl,
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
    const normalizeCellText = (text: string): string =>
      text
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const $ = cheerio.load(html);
    const table = $('table').first();
    if (table.length === 0) return [];

    // Track active rowspans: for each column index, either null or { text, remainingRows }.
    const rowSpans: Array<{ text: string; remainingRows: number } | null> = [];
    const matrix: string[][] = [];

    table.find('tr').each((_rowIdx, tr) => {
      const row: string[] = [];
      let col = 0;

      const fillSpans = () => {
        while (rowSpans[col]) {
          const span = rowSpans[col]!;
          row[col] = span.text;
          span.remainingRows -= 1;
          if (span.remainingRows <= 0) {
            rowSpans[col] = null;
          }
          col += 1;
        }
      };

      const cells = $(tr).find('th,td').toArray();
      for (const cell of cells) {
        fillSpans();

        // Avoid pulling in nested table contents twice.
        const $cell = $(cell);
        const $clone = $cell.clone();
        $clone.find('table').remove();

        const text = normalizeCellText($clone.text());
        const colspan = Math.max(1, Number.parseInt($cell.attr('colspan') || '1', 10) || 1);
        const rowspan = Math.max(1, Number.parseInt($cell.attr('rowspan') || '1', 10) || 1);

        for (let i = 0; i < colspan; i++) {
          row[col + i] = text;
          if (rowspan > 1) {
            rowSpans[col + i] = { text, remainingRows: rowspan - 1 };
          }
        }

        col += colspan;
      }

      // Fill any trailing spans after the last explicit cell.
      fillSpans();

      // Skip fully empty rows.
      if (row.every(c => !c || c.trim().length === 0)) return;
      matrix.push(row);
    });

    const maxCols = matrix.reduce((m, r) => Math.max(m, r.length), 0);
    if (maxCols <= 0) return [];

    return matrix.map(r => (r.length === maxCols ? r : [...r, ...Array(maxCols - r.length).fill('')]));
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

  async saveOutputs(chunks: Chunk[], tables: TableData[]): Promise<void> {
    // Save chunks as JSONL
    const jsonlPath = join(this.outputDir, 'text_chunks.jsonl');
    const jsonlContent = chunks.map(chunk => JSON.stringify(chunk)).join('\n');
    await writeFile(jsonlPath, jsonlContent, 'utf-8');
    console.log(`✓ Saved ${chunks.length} chunks to ${jsonlPath}`);

    // Save a table manifest for citation + tooling.
    const tablesManifestPath = join(this.outputDir, 'tables_manifest.json');
    await writeFile(tablesManifestPath, JSON.stringify(tables, null, 2), 'utf-8');
    console.log(`✓ Saved ${tables.length} tables to ${tablesManifestPath}`);

    // Create Mastra-ready format
    const mastraFormat = {
      source: this.sourceUrl ? `${this.filingId} S-1 Filing (${this.sourceUrl})` : `${this.filingId} S-1 Filing`,
      processing_date: new Date().toISOString(),
      statistics: {
        total_chunks: chunks.length,
        total_tables: tables.length,
        sections: [...new Set(chunks.map(c => c.metadata.section_path[0]).filter(Boolean))].length
      },
      chunks: chunks
    };

    const mastraPath = join(this.outputDir, 'mastra_import.json');
    await writeFile(mastraPath, JSON.stringify(mastraFormat, null, 2), 'utf-8');
    console.log(`✓ Created Mastra import file at ${mastraPath}`);
  }

  private formatTableChunkContent(
    tableNumber: number,
    tableDescription: string,
    sectionContext: string,
    tableData: TableData
  ): string {
    const header = [
      `# TABLE ${tableNumber}`,
      `Description: ${tableDescription}`,
      `Section: ${sectionContext || 'Unknown'}`,
      tableData.caption ? `Caption: ${tableData.caption}` : undefined,
      tableData.anchor ? `Anchor: ${tableData.anchor}` : undefined,
      tableData.source_url ? `Source: ${tableData.source_url}` : undefined,
      `Dimensions: ${tableData.rows} rows x ${tableData.cols} cols`,
      `File: ${tableData.filename}`,
      '',
      'Preview (tabular):',
    ]
      .filter(Boolean)
      .join('\n');

    const maxRows = 40;
    const slice = tableData.data.slice(0, maxRows);
    const safeCell = (cell: string): string =>
      (cell || '')
        .replace(/\|/g, '/') // avoid breaking markdown tables
        .replace(/\s+/g, ' ')
        .trim();

    const rows = slice.map(r => r.map(safeCell));
    const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const padded = rows.map(r => (r.length === cols ? r : [...r, ...Array(cols - r.length).fill('')]));

    const markdownTable =
      padded.length > 0
        ? [
            `| ${padded[0].join(' | ')} |`,
            `| ${Array(cols).fill('---').join(' | ')} |`,
            ...padded.slice(1).map(r => `| ${r.join(' | ')} |`),
          ].join('\n')
        : '(empty table)';

    const truncatedNote = tableData.data.length > maxRows
      ? `\n\n[Truncated: showing first ${maxRows} of ${tableData.data.length} rows]`
      : '';

    return `${header}\n${markdownTable}${truncatedNote}`;
  }
}
