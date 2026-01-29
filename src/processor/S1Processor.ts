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
      // Table of contents lines are highly adversarial for heading detection because they
      // contain many section names and page numbers. Treat them as normal text so we can
      // skip them deterministically in the main loop.
      if (this.looksLikeTableOfContents(text)) {
        return 'TEXT';
      }

      const normalizedText = this.normalizeHeadingMatchText(text);
      
      // Check for exact major section matches
      if (MAJOR_SECTIONS.includes(normalizedText as any)) {
        return 'MAJOR_HEADING';
      }
      
      // Check for partial matches with key financial sections.
      // Guard aggressively: normal paragraphs frequently mention "financial statements".
      if (this.looksLikeHeadingText(text)) {
        if (normalizedText.includes("MANAGEMENT'S DISCUSSION AND ANALYSIS")) {
          return 'MAJOR_HEADING';
        }

        // Only treat financial statement headings as "major" when they are explicit and short.
        // Many S-1 paragraphs contain the phrase "financial statements"; an `includes()` match
        // here causes noisy section resets (especially with repeated page headers).
        const financialHeadings = [
          'FINANCIAL STATEMENTS',
          'CONSOLIDATED FINANCIAL STATEMENTS',
        ];

        for (const heading of financialHeadings) {
          if (normalizedText === heading) {
            return 'MAJOR_HEADING';
          }
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

  private normalizeHeadingMatchText(text: string): string {
    return text
      .trim()
      .replace(/\u00a0/g, ' ')
      // Normalize “smart quotes” so heading matching isn't filing-template-specific.
      .replace(/[\u2018\u2019\u2032]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\s+/g, ' ')
      .toUpperCase();
  }

  private looksLikeHeadingText(text: string): boolean {
    const cleaned = text
      .trim()
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ');

    if (!cleaned) return false;
    if (cleaned.length > 160) return false;
    // Headings rarely end with sentence punctuation.
    if (/[.!?]\s*$/.test(cleaned)) return false;

    const letters = cleaned.replace(/[^A-Za-z]/g, '');
    if (letters.length >= 6 && letters === letters.toUpperCase()) return true;

    return /^[A-Z][A-Za-z0-9 ,.'()-]{3,}$/.test(cleaned);
  }

  private looksLikeTableOfContents(text: string): boolean {
    const upper = text.toUpperCase();
    if (upper.includes('TABLE OF CONTENTS')) return true;

    // Some extracted filings collapse the entire TOC into one long line.
    // Detect it by “many major section names + page-like tokens”.
    let sectionHits = 0;
    for (const section of MAJOR_SECTIONS) {
      if (upper.includes(section)) sectionHits += 1;
      if (sectionHits >= 3) break;
    }

    if (sectionHits < 3) return false;
    if (/\b\d+\b/.test(text)) return true;
    if (/\b[iivx]+\b/i.test(text)) return true; // roman numerals (e.g., "ii")
    return false;
  }

  private normalizeBoilerplateKey(text: string): string {
    return text
      .trim()
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .toUpperCase();
  }

  private isLikelyBoilerplateLine(normalizedUpper: string): boolean {
    if (!normalizedUpper) return false;

    // Common SEC filing header/footer patterns.
    if (normalizedUpper.includes('SECURITIES AND EXCHANGE COMMISSION')) return true;
    if (normalizedUpper.includes('FORM S-1')) return true;

    // Repeated running headers like: "Company, Inc. / S-1 / July 1, 2025"
    if (normalizedUpper.includes('/ S-1 /')) return true;
    if (normalizedUpper.includes('S-1') && /\b20\d{2}\b/.test(normalizedUpper) && normalizedUpper.includes('/')) return true;

    return false;
  }

  private detectBoilerplateLines(elements: ContentElement[]): Set<string> {
    const counts = new Map<string, number>();

    for (const el of elements) {
      if (el.type !== 'text') continue;
      const text = el.text?.trim();
      if (!text) continue;

      const key = this.normalizeBoilerplateKey(text);
      if (key.length === 0) continue;
      // Only consider short, repeated strings as header/footer candidates.
      if (key.length > 120) continue;

      counts.set(key, (counts.get(key) || 0) + 1);
    }

    const out = new Set<string>();
    for (const [key, count] of counts.entries()) {
      // A repeated header/footer typically shows up on many pages.
      if (count < 8) continue;
      if (this.isLikelyBoilerplateLine(key)) {
        out.add(key);
      }
    }

    return out;
  }

  private inferTextChunkType(sectionPath: string[]): ChunkMetadata['chunk_type'] {
    const major = (sectionPath[0] || '').toUpperCase();
    if (!major) return 'text';

    if (major.includes("MANAGEMENT'S DISCUSSION AND ANALYSIS")) return 'mdna';
    if (major.includes('PROSPECTUS SUMMARY')) return 'summary';
    if (major.includes('RISK FACTORS')) return 'risk_factor';
    if (major.includes('BUSINESS')) return 'business';
    if (major.includes('EXECUTIVE COMPENSATION')) return 'exec_comp';
    if (major === 'MANAGEMENT') return 'management';
    if (major.includes('PRINCIPAL AND SELLING STOCKHOLDERS')) return 'ownership';
    if (
      major.includes('CAPITALIZATION') ||
      major.includes('DILUTION') ||
      major.includes('DESCRIPTION OF CAPITAL STOCK') ||
      major.includes('SHARES ELIGIBLE FOR FUTURE SALE')
    ) {
      return 'capital_structure';
    }
    if (major.includes('UNDERWRITERS')) return 'underwriters';
    if (
      major.includes('FINANCIAL STATEMENTS') ||
      major.includes('INDEX TO CONSOLIDATED FINANCIAL STATEMENTS')
    ) {
      return 'financial_statements';
    }

    return 'text';
  }

  async processDocument(): Promise<{ chunks: Chunk[], tables: TableData[] }> {
    console.log('Loading S-1 content list...');
    const elements = await this.loadContentList();
    console.log(`Loaded ${elements.length} elements`);

    const boilerplateLines = this.detectBoilerplateLines(elements);
    if (boilerplateLines.size > 0) {
      console.log(`Detected ${boilerplateLines.size} boilerplate header/footer lines to skip.`);
    }

    // State tracking
    const allChunks: Chunk[] = [];
    const allTables: TableData[] = [];
    let currentChunkBody: string[] = [];
    // Default pre-major content to an explicit cover section. Real filings will reset this
    // once we hit the first known MAJOR_HEADING.
    let currentSectionPath: string[] = ['Cover Page'];
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
      const content = element.text?.trim() || '';
      const elementAnchor = element.anchor?.trim() || undefined;

      if (element.type === 'text' && content) {
        const key = this.normalizeBoilerplateKey(content);
        if (boilerplateLines.has(key)) {
          continue;
        }
      }

      const elemType = this.classifyElement(element);

      switch (elemType) {
        case 'MAJOR_HEADING':
        case 'HEADING':
          // Save previous chunk if exists
          if (currentChunkBody.length > 0) {
            const chunk = this.createChunk(
              chunkId++,
              this.composeChunkContent(currentSectionPath, currentChunkBody),
              currentSectionPath,
              elements[i - 1]?.page_idx || 0,
              currentChunkAnchor || currentAnchor,
              this.inferTextChunkType(currentSectionPath)
            );
            allChunks.push(chunk);
            currentChunkBody = [];
          }
          // We're starting a new section; do not let citation anchors bleed across headings.
          currentChunkAnchor = undefined;

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
          if (elementAnchor) {
            currentChunkAnchor = elementAnchor;
          }
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
            
            const tableRef = `[TABLE ${tableCounter}] ${tableDescription}\n` +
                            `Section: ${sectionContext}\n` +
                            `Dimensions: ${tableData.rows} rows × ${tableData.cols} columns\n` +
                            `File: ${tableData.filename}\n` +
                            (tableData.anchor ? `Anchor: ${tableData.anchor}\n` : '');
            
            currentChunkBody.push(tableRef);

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
            if (this.looksLikeTableOfContents(content)) {
              // TOC lines add noise and break section inference. We skip them entirely.
              break;
            }

            if (elementAnchor) {
              // Preserve citation precision: avoid mixing multiple HTML anchors in a single chunk.
              // If a new anchor appears mid-chunk, flush the current chunk before continuing.
              if (
                currentChunkBody.length > 0 &&
                currentChunkAnchor &&
                elementAnchor !== currentChunkAnchor
              ) {
                const chunk = this.createChunk(
                  chunkId++,
                  this.composeChunkContent(currentSectionPath, currentChunkBody),
                  currentSectionPath,
                  element.page_idx,
                  currentChunkAnchor || currentAnchor,
                  this.inferTextChunkType(currentSectionPath)
                );
                allChunks.push(chunk);
                currentChunkBody = [];
                currentChunkAnchor = undefined;
              }

              currentAnchor = elementAnchor;
              if (!currentChunkAnchor) {
                currentChunkAnchor = elementAnchor;
              }
            }
            currentChunkBody.push(content);
            
            // Check if we need to split chunk due to size
            const preamble = this.buildChunkPreamble(currentSectionPath);
            const bodyText = currentChunkBody.join('\n\n');
            const overhead = preamble ? preamble.length + 2 : 0;
            const totalLength = overhead + bodyText.length;

            if (totalLength > this.config.chunkSize) {
              // Find optimal split point using semantic boundaries
              const bodyBudget = Math.max(1, this.config.chunkSize - overhead);
              const overlapBudget = Math.min(this.config.chunkOverlap, Math.max(0, bodyBudget - 1));
              const splitChunks = this.splitTextAtSemanticBoundaries(bodyText, bodyBudget, overlapBudget);
              
              // Create chunks from splits
              for (let i = 0; i < splitChunks.length - 1; i++) {
                const chunk = this.createChunk(
                  chunkId++,
                  preamble ? `${preamble}\n\n${splitChunks[i]}` : splitChunks[i],
                  currentSectionPath,
                  element.page_idx,
                  currentChunkAnchor || currentAnchor,
                  this.inferTextChunkType(currentSectionPath)
                );
                allChunks.push(chunk);
              }
              
              // Keep the last split as current content for overlap
              currentChunkBody = [splitChunks[splitChunks.length - 1]];
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
    if (currentChunkBody.length > 0) {
      const chunk = this.createChunk(
        chunkId++,
        this.composeChunkContent(currentSectionPath, currentChunkBody),
        currentSectionPath,
        elements[elements.length - 1]?.page_idx || 0,
        currentChunkAnchor || currentAnchor,
        this.inferTextChunkType(currentSectionPath)
      );
      allChunks.push(chunk);
    }

    // Link adjacent chunks so query-time synthesis can pull local context without re-running parsing.
    for (let i = 0; i < allChunks.length; i++) {
      allChunks[i].metadata.prev_chunk_id = i > 0 ? allChunks[i - 1].id : undefined;
      allChunks[i].metadata.next_chunk_id = i < allChunks.length - 1 ? allChunks[i + 1].id : undefined;
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

  private buildChunkPreamble(sectionPath: string[]): string {
    const cleaned = (sectionPath || []).map(s => s.trim()).filter(Boolean);
    if (cleaned.length === 0) return '';

    const major = cleaned[0];
    // Keep default pre-major chunks lean: cover-page-only context is rarely helpful and it reduces
    // the available chunk budget (which can cause unnecessary splits).
    if (cleaned.length === 1 && major.toLowerCase() === 'cover page') return '';
    if (cleaned.length === 1) return `# ${major}`;

    const leaf = cleaned[cleaned.length - 1];
    if (!leaf || leaf === major) return `# ${major}`;

    // Keep the preamble short: major + leaf is enough context for retrieval without bloating every chunk.
    return `# ${major}\n\n## ${leaf}`;
  }

  private composeChunkContent(sectionPath: string[], bodyParts: string[]): string {
    const preamble = this.buildChunkPreamble(sectionPath);
    const body = (bodyParts || []).join('\n\n').trim();
    if (!preamble) return body;
    if (!body) return preamble;
    return `${preamble}\n\n${body}`.trim();
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
      // Clone to avoid accidental mutation as the parser continues to update currentSectionPath.
      section_path: [...sectionPath],
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

      const structure = this.analyzeTableStructure(rows);

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
        ...structure,
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

  private analyzeTableStructure(rows: string[][]): Pick<TableData, 'title' | 'header' | 'header_row_count' | 'data_start_row'> {
    const collapseDuplicateRuns = (row: string[]): string[] => {
      const out = [...row];
      let prev: string | null = null;
      for (let i = 0; i < out.length; i++) {
        const cell = (out[i] || '').trim();
        if (!cell) {
          prev = null;
          continue;
        }
        if (prev && cell === prev) {
          out[i] = '';
          continue;
        }
        prev = cell;
      }
      return out;
    };

    const isYearCell = (cellRaw: string): boolean => {
      const cell = (cellRaw || '').trim();
      const m = cell.match(/^(\d{4})$/);
      if (!m) return false;
      const y = Number(m[1]);
      return Number.isFinite(y) && y >= 1900 && y <= 2099;
    };

    const isNumberishCell = (cellRaw: string): boolean => {
      const cell = (cellRaw || '').trim();
      if (!cell) return false;
      if (!/\d/.test(cell)) return false;

      // Footnote markers like "(1)" shouldn't drive table structure heuristics.
      if (/^\(?\d{1,2}\)?$/.test(cell)) return false;

      // Common number formats in filings: "$ 1,234", "(1,234)", "12.3%", "1,234", etc.
      const cleaned = cell
        .replace(/[$,]/g, '')
        .replace(/\s+/g, '')
        .replace(/^\((.*)\)$/, '-$1');

      if (/^-?\d+(\.\d+)?%?$/.test(cleaned)) return true;
      if (/\d{1,3}(,\d{3})+/.test(cell)) return true;
      if (/\d+\.\d+/.test(cell)) return true;

      return false;
    };

    const collapsed = rows.map(collapseDuplicateRuns);

    const totalNumberish = collapsed.reduce((acc, row) => {
      for (const cell of row) {
        if (isNumberishCell(cell) && !isYearCell(cell)) acc += 1;
      }
      return acc;
    }, 0);

    // If the table doesn't appear numeric, treat it as "layout". We still keep it,
    // but we don't try to guess headers.
    if (totalNumberish < 4) {
      return {};
    }

    // Collect top title/preamble rows that are effectively a single cell spanning columns.
    const titleRows: string[] = [];
    let start = 0;
    for (let r = 0; r < Math.min(3, collapsed.length); r++) {
      const row = collapsed[r] || [];
      const nonEmpty = row.map(c => (c || '').trim()).filter(Boolean);
      if (nonEmpty.length !== 1) break;
      titleRows.push(nonEmpty[0]);
      start = r + 1;
    }

    const looksLikeDataRow = (row: string[]): boolean => {
      const nonEmptyCount = row.map(c => (c || '').trim()).filter(Boolean).length;
      if (nonEmptyCount < 2) return false;

      const numberCount = row.reduce((acc, cell, idx) => {
        if (idx === 0) return acc;
        if (isNumberishCell(cell) && !isYearCell(cell)) return acc + 1;
        return acc;
      }, 0);

      if (numberCount >= 2) return true;
      const label = (row[0] || '').trim();
      const hasLabelText = /[A-Za-z]/.test(label);
      return numberCount >= 1 && hasLabelText;
    };

    let dataStartRow: number | undefined;
    for (let r = start; r < collapsed.length; r++) {
      if (looksLikeDataRow(collapsed[r] || [])) {
        dataStartRow = r;
        break;
      }
    }

    if (dataStartRow === undefined) {
      return {
        title: titleRows.length > 0 ? titleRows.join(' ') : undefined,
      };
    }

    const headerStart = start;
    const headerEnd = Math.max(headerStart - 1, dataStartRow - 1);
    const headerRows = headerEnd >= headerStart ? collapsed.slice(headerStart, headerEnd + 1) : [];

    const maxCols = collapsed.reduce((m, row) => Math.max(m, row.length), 0);
    const mergedHeader =
      headerRows.length > 0
        ? Array.from({ length: maxCols }, (_v, col) => {
            const parts = headerRows
              .map(r => (r[col] || '').trim())
              .filter(Boolean);
            const merged = parts.join(' ').replace(/\s+/g, ' ').trim();
            if (col === 0 && !merged) return 'Row';
            return merged;
          })
        : undefined;

    return {
      title: titleRows.length > 0 ? titleRows.join(' ') : undefined,
      header: mergedHeader,
      header_row_count: headerRows.length > 0 ? headerRows.length : undefined,
      data_start_row: dataStartRow,
    };
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

    // Save a sections manifest (lightweight node tree derived from chunk metadata).
    const sectionsManifestPath = join(this.outputDir, 'sections_manifest.json');
    const sectionsManifest = this.buildSectionsManifest(chunks);
    await writeFile(sectionsManifestPath, JSON.stringify(sectionsManifest, null, 2), 'utf-8');
    console.log(`✓ Saved sections manifest to ${sectionsManifestPath}`);

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

  private buildSectionsManifest(chunks: Chunk[]): any {
    type WorkingNode = {
      title: string;
      path: string[];
      chunkIds: Set<string>;
      anchors: Set<string>;
      children: Map<string, WorkingNode>;
    };

    const root: WorkingNode = {
      title: '__root__',
      path: [],
      chunkIds: new Set(),
      anchors: new Set(),
      children: new Map(),
    };

    const getOrCreate = (parent: WorkingNode, title: string, path: string[]): WorkingNode => {
      const existing = parent.children.get(title);
      if (existing) return existing;
      const next: WorkingNode = {
        title,
        path,
        chunkIds: new Set(),
        anchors: new Set(),
        children: new Map(),
      };
      parent.children.set(title, next);
      return next;
    };

    for (const chunk of chunks) {
      const path = (chunk.metadata.section_path || []).filter(Boolean);
      const sectionPath = path.length > 0 ? path : ['(uncategorized)'];
      const anchor = chunk.metadata.anchor;

      let node = root;
      for (let i = 0; i < sectionPath.length; i++) {
        const title = sectionPath[i];
        const nextPath = sectionPath.slice(0, i + 1);
        node = getOrCreate(node, title, nextPath);
        node.chunkIds.add(chunk.id);
        if (anchor) node.anchors.add(anchor);
      }
    }

    const toPlain = (node: WorkingNode): any => ({
      title: node.title,
      path: node.path,
      chunk_ids: Array.from(node.chunkIds),
      anchors: Array.from(node.anchors),
      children: Array.from(node.children.values())
        .sort((a, b) => a.title.localeCompare(b.title))
        .map(toPlain),
    });

    return {
      filing_id: this.filingId,
      generated_at: new Date().toISOString(),
      sections: Array.from(root.children.values())
        .sort((a, b) => a.title.localeCompare(b.title))
        .map(toPlain),
    };
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
      tableData.title ? `Title: ${tableData.title}` : undefined,
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
    const dataStartRow = Number.isFinite(tableData.data_start_row) ? (tableData.data_start_row as number) : 0;
    const slice =
      tableData.header && tableData.header.length > 0
        ? [tableData.header, ...tableData.data.slice(dataStartRow, dataStartRow + maxRows)]
        : tableData.data.slice(0, maxRows);
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

    const totalDataRows =
      Number.isFinite(tableData.data_start_row) && (tableData.data_start_row as number) >= 0
        ? Math.max(0, tableData.data.length - (tableData.data_start_row as number))
        : tableData.data.length;
    const truncatedNote = totalDataRows > maxRows
      ? `\n\n[Truncated: showing first ${maxRows} of ${totalDataRows} rows]`
      : '';

    return `${header}\n${markdownTable}${truncatedNote}`;
  }
}
