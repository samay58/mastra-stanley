import dotenv from 'dotenv';
// Load environment variables first
dotenv.config();

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { openai } from '@ai-sdk/openai';
import { embed } from 'ai';
import { PgVector } from '@mastra/pg';
import { rerank } from '@mastra/rag';

// Create the basic vector query tool
export const s1VectorQueryTool = createTool({
  id: 'searchS1Document',
  description: 'Search through the Figma S-1 filing document to find relevant information about the company, financials, risks, and other IPO-related data',
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
      indexName: 's1_embeddings',
      queryVector: embedding,
      topK
    });
    
    return { results };
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
      indexName: 's1_embeddings',
      queryVector: embedding,
      topK,
      filter
    });
    
    // Enhanced result processing without external reranking
    // Sort by similarity score and apply relevance filtering
    const sortedResults = initialResults
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
export const s1TableLookupTool = createTool({
  id: 'lookupS1Table',
  description: 'Look up specific tables from the S-1 document by table number or content description',
  inputSchema: z.object({
    tableNumber: z.number().optional().describe('Table number (1-71)'),
    keyword: z.string().optional().describe('Keyword to search in table filenames'),
    section: z.string().optional().describe('Section containing the table')
  }),
  outputSchema: z.object({
    tables: z.array(z.object({
      filename: z.string(),
      path: z.string(),
      section: z.string(),
      description: z.string()
    }))
  }),
  execute: async ({ context }) => {
    const { tableNumber, keyword, section } = context;
    const { readdir } = await import('fs/promises');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const tablesDir = join(__dirname, '../../output/tables');
    
    try {
      const files = await readdir(tablesDir);
      const csvFiles = files.filter(f => f.endsWith('.csv'));
      
      let matchedTables = csvFiles;
      
      // Filter by table number if provided
      if (tableNumber) {
        const paddedNum = String(tableNumber).padStart(3, '0');
        matchedTables = matchedTables.filter(f => f.includes(`table_${paddedNum}`));
      }
      
      // Filter by keyword if provided
      if (keyword) {
        const lowerKeyword = keyword.toLowerCase();
        matchedTables = matchedTables.filter(f => f.toLowerCase().includes(lowerKeyword));
      }
      
      // Filter by section if provided
      if (section) {
        const lowerSection = section.toLowerCase().replace(/\s+/g, '_');
        matchedTables = matchedTables.filter(f => f.toLowerCase().includes(lowerSection));
      }
      
      // Map to result format
      const tables = matchedTables.map(filename => {
        const parts = filename.replace('.csv', '').split('_');
        const tableNum = parseInt(parts[1], 10);
        const sectionName = parts.slice(2).join(' ');
        
        return {
          filename,
          path: join(tablesDir, filename),
          section: sectionName || 'Unknown',
          description: `Table ${tableNum}: ${sectionName}`
        };
      });
      
      return { tables };
    } catch (error) {
      console.error('Error looking up tables:', error);
      return { tables: [] };
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
      indexName: 's1_embeddings',
      queryVector: embedding,
      topK: topK * 2 // Get more results for hybrid ranking
    });
    
    // Perform keyword matching
    const queryTerms = query.toLowerCase().split(/\s+/)
      .filter(term => term.length > 2); // Filter out very short terms
    
    const hybridResults = semanticResults.map(result => {
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
  execute: async ({ context }) => {
    const { query, topK, expandQuery, useHyDE, vectorWeight } = context;
    
    try {
      // Lazy import to avoid circular dependencies
      const { getHybridSearcher } = await import('../search/hybridSearch.js');
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
      
      // Format results
      return {
        results: boostedResults.map(r => ({
          text: r.chunk.content,
          score: r.score,
          vectorScore: r.vectorScore,
          keywordScore: r.keywordScore,
          metadata: {
            ...r.chunk.metadata,
            combined_score: r.score
          }
        }))
      };
    } catch (error) {
      console.error('Enhanced search error:', error);
      // Fallback to standard vector search
      return s1VectorQueryTool.execute({ context: { query, topK } });
    }
  }
});

// Define the prompt constant (if it doesn't exist)
export const PGVECTOR_PROMPT = `You have access to pgvector-powered search tools for the S-1 document.`;