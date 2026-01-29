import dotenv from 'dotenv';
// Load environment variables first
dotenv.config();

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { openai } from '@ai-sdk/openai';
import { embed } from 'ai';
import { PgVector } from '@mastra/pg';
import type { QueryResult } from '@mastra/core/vector';
import { getActiveFilingContext } from '../config/filing.js';

const VECTOR_INDEX = process.env.S1_VECTOR_INDEX?.trim() || 's1_embeddings';

function toResultText(result: QueryResult): string {
  const metadataText = result.metadata?.text;
  if (typeof metadataText === 'string' && metadataText.trim().length > 0) {
    return metadataText;
  }
  return result.document || '';
}

function toToolResult(result: QueryResult): { text: string; score: number; metadata: Record<string, any> } {
  const metadata = result.metadata ?? {};
  return {
    text: toResultText(result),
    score: result.score,
    metadata,
  };
}

// Create the basic vector query tool
export const s1VectorQueryTool = createTool({
  id: 'searchS1Document',
  description: 'Search through the active S-1 filing document to find relevant information about the company, financials, risks, and other IPO-related data',
  inputSchema: z.object({
    query: z.string().describe('The search query'),
    topK: z.number().default(5).describe('Number of results to return')
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      text: z.string(),
      score: z.number(),
      metadata: z.record(z.any())
    }))
  }),
  execute: async ({ context }) => {
    const { query, topK } = context;
    const filing = getActiveFilingContext();
    
    // Initialize vector store
    const vectorStore = new PgVector({
      connectionString: process.env.POSTGRES_CONNECTION_STRING!
    });
    
    // Generate query embedding
    const { embedding } = await embed({
      model: openai.embedding('text-embedding-3-small'),
      value: query
    });
    
    // Search vector store
    const results = await vectorStore.query({
      indexName: VECTOR_INDEX,
      queryVector: embedding,
      topK,
      filter: { filing_id: filing.filingId }
    });
    
    return { results: results.map(toToolResult) };
  }
});

// Create an enhanced search tool with re-ranking
export const s1SearchWithRerankTool = createTool({
  id: 'searchS1WithRerank',
  description: 'Advanced search through the S-1 document with re-ranking for better relevance',
  inputSchema: z.object({
    query: z.string().describe('The search query'),
    topK: z.number().default(10).describe('Number of results to retrieve'),
    rerankTopK: z.number().default(5).describe('Number of results after re-ranking'),
    filter: z.object({
      section_path: z.string().optional().describe('Filter by section (e.g., "RISK FACTORS")'),
      page_idx: z.number().optional().describe('Filter by page number')
    }).optional()
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      text: z.string(),
      score: z.number(),
      metadata: z.record(z.any())
    }))
  }),
  execute: async ({ context }) => {
    const { query, topK, rerankTopK, filter } = context;
    const filing = getActiveFilingContext();
    
    // Initialize vector store
    const vectorStore = new PgVector({
      connectionString: process.env.POSTGRES_CONNECTION_STRING!
    });
    
    // Generate query embedding
    const { embedding } = await embed({
      model: openai.embedding('text-embedding-3-small'),
      value: query
    });
    
    // Search vector store
    const initialResults = await vectorStore.query({
      indexName: VECTOR_INDEX,
      queryVector: embedding,
      topK,
      filter: { ...(filter || {}), filing_id: filing.filingId }
    });
    
    const toolResults = initialResults.map(toToolResult);

    // Enhanced result processing without external reranking
    // Sort by similarity score and apply relevance filtering
    const sortedResults = toolResults
      .sort((a, b) => b.score - a.score)
      .filter(result => result.score > 0.5); // Filter low-relevance results
    
    // Apply comprehensive financial terminology boosting
    const boostedResults = sortedResults.map(result => {
      let boostedScore = result.score;
      const lowerQuery = query.toLowerCase();
      const sectionPath = result.metadata?.section_hierarchy?.toLowerCase() || '';
      const resultText = result.text?.toLowerCase() || '';
      
      // Comprehensive financial terminology boost
      const financialTerms = [
        'revenue', 'income', 'earnings', 'profit', 'loss', 'ebitda', 'margin',
        'growth', 'sales', 'costs', 'expenses', 'operating', 'gross', 'net',
        'financial', 'statement', 'quarter', 'annual', 'year-over-year', 'yoy'
      ];
      
      const ownershipTerms = [
        'ownership', 'shares', 'equity', 'stock', 'voting', 'stockholder', 
        'shareholder', 'percentage', 'control', 'class', 'common', 'preferred'
      ];
      
      const executiveTerms = [
        'dylan', 'field', 'ceo', 'executive', 'officer', 'director', 'management',
        'compensation', 'salary', 'bonus', 'equity', 'grant'
      ];
      
      // Count term matches in query
      let financialMatches = 0;
      let ownershipMatches = 0;
      let executiveMatches = 0;
      
      financialTerms.forEach(term => {
        if (lowerQuery.includes(term)) financialMatches++;
      });
      
      ownershipTerms.forEach(term => {
        if (lowerQuery.includes(term)) ownershipMatches++;
      });
      
      executiveTerms.forEach(term => {
        if (lowerQuery.includes(term)) executiveMatches++;
      });
      
      // Apply section-specific boosting
      if (financialMatches > 0) {
        if (sectionPath.includes('management\'s discussion') || 
            sectionPath.includes('financial') ||
            sectionPath.includes('results of operations') ||
            sectionPath.includes('consolidated statements')) {
          boostedScore *= 2.0; // Strong boost for financial sections
        }
        
        // Boost for financial content in result text
        financialTerms.forEach(term => {
          if (resultText.includes(term)) {
            boostedScore *= 1.1;
          }
        });
      }
      
      if (ownershipMatches > 0) {
        if (sectionPath.includes('principal') || 
            sectionPath.includes('stockholder') || 
            sectionPath.includes('ownership') ||
            sectionPath.includes('capitalization') ||
            sectionPath.includes('dilution')) {
          boostedScore *= 2.0;
        }
        
        ownershipTerms.forEach(term => {
          if (resultText.includes(term)) {
            boostedScore *= 1.1;
          }
        });
      }
      
      if (executiveMatches > 0) {
        if (sectionPath.includes('management') || 
            sectionPath.includes('executive') ||
            sectionPath.includes('compensation')) {
          boostedScore *= 1.8;
        }
        
        executiveTerms.forEach(term => {
          if (resultText.includes(term)) {
            boostedScore *= 1.1;
          }
        });
      }
      
      // Risk analysis boosting
      if (lowerQuery.includes('risk') || lowerQuery.includes('factor')) {
        if (sectionPath.includes('risk')) {
          boostedScore *= 1.5;
        }
      }
      
      // Table content boosting
      if (resultText.includes('[table') || resultText.includes('table')) {
        if (financialMatches > 0 || ownershipMatches > 0) {
          boostedScore *= 1.3; // Tables are valuable for financial queries
        }
      }
      
      // Penalize very short chunks (likely headers)
      if (result.text && result.text.length < 100) {
        boostedScore *= 0.3;
      }
      
      return { ...result, score: boostedScore };
    });
    
    // Re-sort after boosting and return top results
    const finalResults = boostedResults
      .sort((a, b) => b.score - a.score)
      .slice(0, rerankTopK);
    
    return {
      results: finalResults
    };
  }
});

// Create a table lookup tool
// Helper function to clean financial data
function cleanFinancialValue(value: string): string {
  if (!value || typeof value !== 'string') return value;
  
  // Remove common formatting artifacts
  let cleaned = value
    .replace(/\$/g, '')           // Remove dollar signs
    .replace(/,/g, '')            // Remove commas
    .replace(/\s+/g, ' ')         // Normalize spaces
    .replace(/\(\s*(\d+)\s*\)/g, '-$1') // Convert (123) to -123
    .replace(/[^\d\-\.\s%]/g, '') // Keep only numbers, minus, decimal, space, %
    .trim();
  
  // Handle concatenated values sometimes produced by messy extractions (e.g., two numbers stuck together).
  if (cleaned.includes(' ') && !cleaned.includes('%')) {
    const parts = cleaned.split(' ').filter(part => part.trim());
    if (parts.length > 1) {
      // Take the part that looks most like a complete number
      const bestPart = parts.find(part => part.includes('.') && part.length > 3) || parts[parts.length - 1];
      cleaned = bestPart;
    }
  }
  
  return cleaned;
}

// Helper function to parse CSV content with enhanced year detection
async function parseCSVContent(content: string): Promise<string[][]> {
  const lines = content.split('\n').filter(line => line.trim());
  if (lines.length === 0) return [];
  
  const rows: string[][] = [];
  for (const line of lines) {
    // Enhanced CSV parsing - handles complex cases with embedded commas and quotes
    const cells: string[] = [];
    let currentCell = '';
    let inQuotes = false;
    let i = 0;
    
    while (i < line.length) {
      const char = line[i];
      
      if (char === '"' && !inQuotes) {
        inQuotes = true;
      } else if (char === '"' && inQuotes) {
        // Check if this is an escaped quote
        if (i + 1 < line.length && line[i + 1] === '"') {
          currentCell += '"';
          i++; // Skip the next quote
        } else {
          inQuotes = false;
        }
      } else if (char === ',' && !inQuotes) {
        cells.push(currentCell.trim());
        currentCell = '';
      } else {
        currentCell += char;
      }
      i++;
    }
    
    // Add the last cell
    cells.push(currentCell.trim());
    rows.push(cells);
  }
  
  return rows;
}

// Helper function to detect year columns with enhanced logic
function detectYearHeaders(rows: string[][]): { yearColumns: number[]; yearLabels: string[] } {
  const yearColumns: number[] = [];
  const yearLabels: string[] = [];
  
  if (rows.length === 0) return { yearColumns, yearLabels };
  
  // Check multiple rows for year patterns
  for (let rowIndex = 0; rowIndex < Math.min(4, rows.length); rowIndex++) {
    const row = rows[rowIndex];
    
    for (let colIndex = 0; colIndex < row.length; colIndex++) {
      const cell = row[colIndex];
      if (typeof cell === 'string') {
        // Look for 4-digit years or year patterns
        const yearMatch = cell.match(/\b(20\d{2})\b/);
        if (yearMatch) {
          const year = yearMatch[1];
          if (!yearColumns.includes(colIndex)) {
            yearColumns.push(colIndex);
            yearLabels.push(year);
          }
        }
      }
    }
  }
  
  // If we found years, return them
  if (yearColumns.length > 0) {
    return { yearColumns, yearLabels };
  }
  
  // Fallback: do not guess years/periods when they are not explicit.
  return inferYearColumnsFromData(rows);
}

// Helper function to avoid guessing year/period columns.
function inferYearColumnsFromData(_rows: string[][]): { yearColumns: number[]; yearLabels: string[] } {
  // If we cannot detect explicit years/periods, we intentionally do not guess.
  // Guessing creates incorrect period labels (worse than omitting them).
  return { yearColumns: [], yearLabels: [] };
}

export const s1TableLookupTool = createTool({
  id: 'lookupS1Table',
  description: 'Look up specific tables from the S-1 document by table number or content description',
  inputSchema: z.object({
    tableNumber: z.number().optional().describe('Table number (as extracted for the active filing)'),
    keyword: z.string().optional().describe('Keyword to search in table filenames'),
    section: z.string().optional().describe('Section containing the table')
  }),
  outputSchema: z.object({
    tables: z.array(z.object({
      filename: z.string(),
      path: z.string(),
      section: z.string(),
      description: z.string(),
      caption: z.string().optional(),
      anchor: z.string().optional(),
      source_url: z.string().optional()
    }))
  }),
  execute: async ({ context }) => {
    const { tableNumber, keyword, section } = context;
    const { readdir } = await import('fs/promises');
    const { readFile } = await import('fs/promises');
    const { join } = await import('path');
    const filing = getActiveFilingContext();
    const tablesDir = filing.tablesDir;
    
    try {
      type ManifestEntry = {
        filename?: string;
        section?: string;
        caption?: string;
        anchor?: string;
        source_url?: string;
      };

      let manifest: ManifestEntry[] | null = null;
      try {
        const raw = await readFile(filing.tablesManifestPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          manifest = parsed as ManifestEntry[];
        }
      } catch {
        // Fall back to directory scanning when the manifest is missing or invalid.
      }

      const manifestByFilename = manifest
        ? new Map(
            manifest
              .map(entry => [entry.filename, entry] as const)
              .filter((pair): pair is readonly [string, ManifestEntry] => typeof pair[0] === 'string')
          )
        : null;

      const csvFiles = manifest
        ? manifest
            .map(entry => entry.filename)
            .filter((name): name is string => typeof name === 'string' && name.endsWith('.csv'))
        : (await readdir(tablesDir)).filter(f => f.endsWith('.csv'));

      let matchedTables = csvFiles;
      
      // Filter by table number if provided
      if (tableNumber) {
        const paddedNum = String(tableNumber).padStart(3, '0');
        matchedTables = matchedTables.filter(f => f.includes(`table_${paddedNum}`));
      }
      
      // Filter by keyword if provided
      if (keyword) {
        const lowerKeyword = keyword.toLowerCase();
        matchedTables = matchedTables.filter(filename => {
          if (filename.toLowerCase().includes(lowerKeyword)) return true;
          const entry = manifestByFilename?.get(filename);
          if (!entry) return false;
          return (
            (entry.caption || '').toLowerCase().includes(lowerKeyword) ||
            (entry.section || '').toLowerCase().includes(lowerKeyword)
          );
        });
      }
      
      // Filter by section if provided
      if (section) {
        const lowerSection = section.toLowerCase().replace(/\s+/g, '_');
        matchedTables = matchedTables.filter(filename => {
          if (filename.toLowerCase().includes(lowerSection)) return true;
          const entry = manifestByFilename?.get(filename);
          if (!entry) return false;
          return (entry.section || '').toLowerCase().includes(section.toLowerCase());
        });
      }
      
      // Map to result format
      const tables = matchedTables.map(filename => {
        const parts = filename.replace('.csv', '').split('_');
        const tableNum = parseInt(parts[1], 10);
        const sectionName = parts.slice(2).join(' ');

        const manifestEntry = manifestByFilename?.get(filename);
        
        return {
          filename,
          path: join(tablesDir, filename),
          section: manifestEntry?.section || sectionName || 'Unknown',
          description: `Table ${Number.isFinite(tableNum) ? tableNum : '?'}: ${sectionName || manifestEntry?.section || 'Unknown'}`,
          caption: manifestEntry?.caption,
          anchor: manifestEntry?.anchor,
          source_url: manifestEntry?.source_url
        };
      });
      
      return { tables };
    } catch (error) {
      console.error('Error looking up tables:', error);
      return { tables: [] };
    }
  }
});

// Create a table data reader tool
export const s1TableDataTool = createTool({
  id: 'readS1TableData',
  description: 'Read and parse CSV table data from S-1 financial tables, returning clean structured data',
  inputSchema: z.object({
    tableNumber: z.number().optional().describe('Table number to read (as extracted for the active filing)'),
    filename: z.string().optional().describe('Specific filename to read'),
    keyword: z.string().optional().describe('Keyword to find specific table (e.g., "revenue", "operations", "financial")'),
    rowFilter: z.string().optional().describe('Filter rows containing this text'),
    cleanData: z.boolean().default(true).describe('Clean financial values (remove $, commas, etc)')
  }),
  outputSchema: z.object({
    tableData: z.array(z.object({
      tableNumber: z.number(),
      filename: z.string(),
      description: z.string(),
      caption: z.string().optional(),
      anchor: z.string().optional(),
      source_url: z.string().optional(),
      headers: z.array(z.string()).optional(),
      rows: z.array(z.array(z.string())),
      cleanedData: z.array(z.object({
        rowLabel: z.string(),
        values: z.array(z.string()),
        yearData: z.record(z.string()).optional()
      })).optional()
    })),
    summary: z.string().optional()
  }),
  execute: async ({ context }) => {
    const { tableNumber, filename, keyword, rowFilter, cleanData } = context;
    const { readdir, readFile } = await import('fs/promises');
    const { join } = await import('path');
    const filing = getActiveFilingContext();
    const tablesDir = filing.tablesDir;
    
    try {
      type ManifestEntry = {
        filename?: string;
        section?: string;
        caption?: string;
        anchor?: string;
        source_url?: string;
        title?: string;
        header?: string[];
        header_row_count?: number;
        data_start_row?: number;
      };

      let manifest: ManifestEntry[] | null = null;
      try {
        const raw = await readFile(filing.tablesManifestPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          manifest = parsed as ManifestEntry[];
        }
      } catch {
        // optional
      }

      const manifestByFilename = manifest
        ? new Map(
            manifest
              .map(entry => [entry.filename, entry] as const)
              .filter((pair): pair is readonly [string, ManifestEntry] => typeof pair[0] === 'string')
          )
        : null;

      let targetFiles: string[] = [];
      
      if (filename) {
        // Specific filename provided
        targetFiles = [filename];
      } else {
        // Find matching tables
        const files = manifest
          ? manifest
              .map(entry => entry.filename)
              .filter((name): name is string => typeof name === 'string' && name.endsWith('.csv'))
          : (await readdir(tablesDir)).filter(f => f.endsWith('.csv'));
        let csvFiles = files;
        
        if (tableNumber) {
          const paddedNum = String(tableNumber).padStart(3, '0');
          csvFiles = csvFiles.filter(f => f.includes(`table_${paddedNum}`));
        }
        
        if (keyword) {
          const lowerKeyword = keyword.toLowerCase();
          csvFiles = csvFiles.filter(f => {
            if (f.toLowerCase().includes(lowerKeyword)) return true;
            const entry = manifestByFilename?.get(f);
            if (!entry) return false;
            return (
              (entry.caption || '').toLowerCase().includes(lowerKeyword) ||
              (entry.section || '').toLowerCase().includes(lowerKeyword)
            );
          });
        }
        
        // For financial queries, prioritize key tables
        if (keyword && ['revenue', 'income', 'profit', 'expense', 'operations'].some(k => keyword.toLowerCase().includes(k))) {
          // Prioritize results_of_operations and financial tables
          csvFiles.sort((a, b) => {
            const aScore = a.includes('operations') ? 2 : a.includes('financial') ? 1 : 0;
            const bScore = b.includes('operations') ? 2 : b.includes('financial') ? 1 : 0;
            return bScore - aScore;
          });
        }
        
        targetFiles = csvFiles.slice(0, 3); // Limit to top 3 matches
      }
      
      type CleanedTableRow = {
        rowLabel: string;
        values: string[];
        yearData?: Record<string, string>;
      };

      type ParsedTable = {
        tableNumber: number;
        filename: string;
        description: string;
        caption?: string;
        anchor?: string;
        source_url?: string;
        headers?: string[];
        rows: string[][];
        cleanedData?: CleanedTableRow[];
      };

      const tableData: ParsedTable[] = [];
      
      for (const file of targetFiles) {
        const filePath = join(tablesDir, file);
        const content = await readFile(filePath, 'utf-8');
        const rows = await parseCSVContent(content);
        
        if (rows.length === 0) continue;

        const entry = manifestByFilename?.get(file);
        
        // Extract table number from filename
        const tableNumMatch = file.match(/table_(\d+)/);
        const tableNum = tableNumMatch ? parseInt(tableNumMatch[1], 10) : 0;
        
        // Extract description from filename
        const parts = file.replace('.csv', '').split('_');
        const description = parts.slice(2).join(' ');
        
        // Enhanced header detection with year mapping
        let headers: string[] = [];
        let dataStartIndex = 0;

        // Prefer processor-derived structure hints from the manifest when present.
        if (entry?.header && Array.isArray(entry.header) && entry.header.length > 0) {
          headers = entry.header;
        }
        if (Number.isFinite(entry?.data_start_row)) {
          dataStartIndex = entry?.data_start_row as number;
        }

        const headerProbeRows =
          dataStartIndex > 0 ? rows.slice(0, Math.min(rows.length, dataStartIndex)) : rows;
        const { yearColumns, yearLabels } = detectYearHeaders(headerProbeRows);
        
        // Build enhanced headers with year information
        if (headers.length === 0 && yearColumns.length > 0) {
          // Find the row that contains period descriptions
          let headerRow: string[] | null = null;
          for (let i = 0; i < Math.min(3, rows.length); i++) {
            if (rows[i].some(cell => /year|ended|months|quarter/i.test(cell))) {
              headerRow = rows[i];
              dataStartIndex = i + 1;
              break;
            }
          }
          
          // Create headers with year mapping
          if (headerRow) {
            headers = headerRow.map((cell, index) => {
              const yearIndex = yearColumns.indexOf(index);
              if (yearIndex !== -1) {
                return `${cell} (${yearLabels[yearIndex]})`;
              }
              return cell;
            });
          } else {
            // Fallback: create headers from year labels
            headers = ['Description'];
            yearLabels.forEach(year => {
              headers.push(`Year ${year}`);
            });
          }
        } else if (headers.length === 0) {
          // Original logic as fallback
          if (rows[0] && rows[0].some(cell => /\d{4}|quarter|year|ended/i.test(cell))) {
            headers = rows[0];
            dataStartIndex = 1;
          } else if (rows[1] && rows[1].some(cell => /\d{4}|quarter|year|ended/i.test(cell))) {
            headers = rows[1];
            dataStartIndex = 2;
          }
        }
        
        // Filter rows if requested
        let filteredRows = rows.slice(dataStartIndex);
        if (rowFilter) {
          const filterLower = rowFilter.toLowerCase();
          filteredRows = filteredRows.filter(row => 
            row.some(cell => cell.toLowerCase().includes(filterLower))
          );
        }
        
        // Clean data if requested with year mapping
        let cleanedData: CleanedTableRow[] = [];
        if (cleanData && filteredRows.length > 0) {
          cleanedData = filteredRows
            .filter(row => row.length > 1 && row[0].trim()) // Skip empty rows
            .map(row => {
              const cleanedRow: CleanedTableRow = {
                rowLabel: row[0],
                values: row.slice(1).map(cleanFinancialValue)
              };
              
              // Add year-specific data if we have year mappings
              if (yearColumns.length > 0 && yearLabels.length > 0) {
                const yearData: Record<string, string> = {};
                yearColumns.forEach((colIndex, yearIndex) => {
                  if (colIndex < row.length && yearLabels[yearIndex]) {
                    yearData[yearLabels[yearIndex]] = cleanFinancialValue(row[colIndex]);
                  }
                });
                cleanedRow.yearData = yearData;
              }
              
              return cleanedRow;
            });
        }
        
        tableData.push({
          tableNumber: tableNum,
          filename: file,
          description: description || 'Financial Table',
          caption: entry?.caption,
          anchor: entry?.anchor,
          source_url: entry?.source_url,
          headers: headers.length > 0 ? headers : undefined,
          rows: filteredRows,
          cleanedData: cleanedData.length > 0 ? cleanedData : undefined
        });
      }
      
      // Generate summary if we found financial data
      let summary = '';
      if (tableData.length > 0 && keyword) {
        const foundTables = tableData.map(t => `Table ${t.tableNumber}: ${t.description}`).join(', ');
        summary = `Found ${tableData.length} table(s) matching "${keyword}": ${foundTables}`;
        
        // Add specific data points if found with year information
        if (keyword.toLowerCase().includes('revenue') && tableData.length > 0) {
          const revenueRow = tableData[0].cleanedData?.find(row => 
            row.rowLabel.toLowerCase().includes('revenue') && 
            !row.rowLabel.toLowerCase().includes('cost')
          );
          if (revenueRow) {
            if (revenueRow.yearData) {
              // Add year-specific revenue data
              const yearEntries = Object.entries(revenueRow.yearData);
              if (yearEntries.length > 0) {
                summary += `. Revenue by year: ${yearEntries.map(([year, value]) => `${year}: $${value}`).join(', ')}`;
              }
            } else if (revenueRow.values.length > 0) {
              summary += `. Latest revenue figure: ${revenueRow.values[revenueRow.values.length - 1]}`;
            }
          }
        }
      }
      
      return { 
        tableData,
        summary: summary || undefined
      };
    } catch (error) {
      console.error('Error reading table data:', error);
      return { tableData: [] };
    }
  }
});

// Create a hybrid search tool that combines semantic + keyword matching
export const s1HybridSearchTool = createTool({
  id: 'hybridS1Search',
  description: 'Advanced hybrid search combining semantic similarity and keyword matching for financial queries',
  inputSchema: z.object({
    query: z.string().describe('The search query'),
    topK: z.number().default(10).describe('Number of results to retrieve'),
    rerankTopK: z.number().default(5).describe('Number of results after re-ranking'),
    keywordWeight: z.number().default(0.3).describe('Weight for keyword matching (0.0 to 1.0)')
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      text: z.string(),
      score: z.number(),
      keywordScore: z.number().optional(),
      semanticScore: z.number().optional(),
      metadata: z.record(z.any())
    }))
  }),
  execute: async ({ context }) => {
    const { query, topK, rerankTopK, keywordWeight } = context;
    const filing = getActiveFilingContext();
    
    // Initialize vector store
    const vectorStore = new PgVector({
      connectionString: process.env.POSTGRES_CONNECTION_STRING!
    });
    
    // Generate query embedding for semantic search
    const { embedding } = await embed({
      model: openai.embedding('text-embedding-3-small'),
      value: query
    });
    
    // Perform semantic search
    const semanticResults = await vectorStore.query({
      indexName: VECTOR_INDEX,
      queryVector: embedding,
      topK: topK * 2, // Get more results for hybrid ranking
      filter: { filing_id: filing.filingId }
    });

    const semanticToolResults = semanticResults.map(toToolResult);
    
    // Perform keyword matching
    const queryTerms = query.toLowerCase().split(/\s+/)
      .filter(term => term.length > 2); // Filter out very short terms
    
    const hybridResults = semanticToolResults.map(result => {
      const resultText = result.text?.toLowerCase() || '';
      const sectionPath = result.metadata?.section_hierarchy?.toLowerCase() || '';
      
      // Calculate keyword score
      let keywordScore = 0;
      let totalTerms = queryTerms.length;
      
      if (totalTerms > 0) {
        queryTerms.forEach(term => {
          // Exact matches in text
          if (resultText.includes(term)) {
            keywordScore += 1.0;
          }
          
          // Exact matches in section path (higher weight)
          if (sectionPath.includes(term)) {
            keywordScore += 1.5;
          }
          
          // Partial matches for longer terms
          if (term.length > 4) {
            if (resultText.includes(term.substring(0, term.length - 1))) {
              keywordScore += 0.5;
            }
          }
        });
        
        keywordScore = keywordScore / totalTerms; // Normalize
      }
      
      // Combine semantic and keyword scores
      const semanticScore = result.score || 0;
      const hybridScore = (semanticScore * (1 - keywordWeight)) + (keywordScore * keywordWeight);
      
      return {
        ...result,
        score: hybridScore,
        keywordScore,
        semanticScore
      };
    });
    
    // Sort by hybrid score and apply the same boosting logic
    const sortedResults = hybridResults
      .sort((a, b) => b.score - a.score)
      .filter(result => result.score > 0.3) // Lower threshold for hybrid search
      .slice(0, rerankTopK);
    
    return {
      results: sortedResults
    };
  }
});

// Create an enhanced hybrid search tool
export const s1EnhancedSearchTool = createTool({
  id: 'enhancedS1Search',
  description: 'Advanced hybrid search using query expansion, BM25 keyword matching, and vector similarity for optimal financial document retrieval',
  inputSchema: z.object({
    query: z.string().describe('The search query'),
    topK: z.number().default(10).describe('Number of results to return'),
    expandQuery: z.boolean().default(true).describe('Whether to expand query with synonyms'),
    useHyDE: z.boolean().default(false).describe('Whether to use hypothetical document embeddings'),
    vectorWeight: z.number().default(0.7).describe('Weight for vector similarity (0-1)')
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      text: z.string(),
      score: z.number(),
      vectorScore: z.number(),
      keywordScore: z.number(),
      metadata: z.record(z.any())
    }))
  }),
  execute: async ({ context, runtimeContext }) => {
    const { query, topK, expandQuery, useHyDE, vectorWeight } = context;
    
    try {
      // Lazy import to avoid circular dependencies
      const { getHybridSearcher } = await import('../search/hybridSearch.js');
      
      console.log('🔍 Attempting enhanced hybrid search...');
      const searcher = await getHybridSearcher();
      
      // Perform hybrid search
      const results = await searcher.search(query, {
        topK,
        vectorWeight,
        expandQuery,
        useHyDE
      });
      
      // Apply financial boosting
      const boostedResults = searcher.applyFinancialBoosting(results, query);
      
      console.log(`✅ Enhanced hybrid search successful - found ${boostedResults.length} results`);
      
      // Format results
      return {
        results: boostedResults.map(r => ({
          text: r.chunk.content,
          score: r.score,
          vectorScore: r.vectorScore,
          keywordScore: r.keywordScore,
          metadata: {
            ...r.chunk.metadata,
            combined_score: r.score,
            search_method: 'hybrid'
          }
        }))
      };
    } catch (error) {
      console.error('❌ Enhanced hybrid search failed:', error);
      
      // Log the specific error for debugging
      if (error instanceof Error) {
        console.error(`❌ Error message: ${error.message}`);
        
        // Check if it's an initialization error
        if (error.message.includes('not initialized') || error.message.includes('Chunks file not found')) {
          console.log('💡 Hybrid search not ready - this may be the first run or chunks need to be processed');
          console.log('💡 Run "npm run process-s1" if you haven\'t processed the S-1 document yet');
        }
      }
      
      console.log('🔄 Falling back to standard vector search...');
      
      try {
        // Fallback to standard vector search with reranking
        const fallbackResult = await s1SearchWithRerankTool.execute({ 
          context: { 
            query, 
            topK, 
            rerankTopK: Math.min(topK, 5)
          },
          runtimeContext
        });
        
        console.log(`✅ Fallback vector search successful - found ${fallbackResult.results.length} results`);
        
        // Add search method metadata to indicate fallback was used
        return {
          results: fallbackResult.results.map(r => ({
            text: r.text,
            score: r.score,
            vectorScore: r.score,
            keywordScore: 0,
            metadata: {
              ...r.metadata,
              search_method: 'vector_fallback',
              fallback_reason: 'hybrid_search_unavailable'
            }
          }))
        };
      } catch (fallbackError) {
        console.error('❌ Fallback vector search also failed:', fallbackError);
        
        // Final fallback to basic vector search
        console.log('🔄 Falling back to basic vector search...');
        const basicResult = await s1VectorQueryTool.execute({ context: { query, topK }, runtimeContext });
        
        return {
          results: basicResult.results.map(r => ({
            text: r.text,
            score: r.score,
            vectorScore: r.score,
            keywordScore: 0,
            metadata: {
              ...r.metadata,
              search_method: 'basic_vector_fallback',
              fallback_reason: 'all_enhanced_methods_failed'
            }
          }))
        };
      }
    }
  }
});

// Define the prompt constant (if it doesn't exist)
export const PGVECTOR_PROMPT = `You have access to pgvector-powered search tools for the S-1 document.`;
