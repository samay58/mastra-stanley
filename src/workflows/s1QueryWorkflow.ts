import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { s1QueryAgent } from '../agents/s1QueryAgent.js';
import { s1SearchWithRerankTool, s1TableLookupTool } from '../tools/vectorQuery.js';

// Step 1: Analyze the query to determine what information is needed
const analyzeQueryStep = createStep({
  id: 'analyze-query',
  description: 'Analyze the user query to identify information needs',
  inputSchema: z.object({
    query: z.string()
  }),
  outputSchema: z.object({
    queryType: z.enum(['financial', 'risk', 'business', 'management', 'general']),
    searchTerms: z.array(z.string()),
    needsTables: z.boolean(),
    sections: z.array(z.string())
  }),
  execute: async ({ inputData }) => {
    const { query } = inputData;

    const q = query.trim();
    const lower = q.toLowerCase();
    const containsAny = (terms: string[]) => terms.some(t => lower.includes(t));

    const isRisk = containsAny(['risk', 'risk factor', 'factor', 'litigation', 'regulatory', 'compliance']);
    const isFinancial = containsAny([
      'revenue',
      'income',
      'earnings',
      'gross margin',
      'operating margin',
      'cash flow',
      'balance sheet',
      'statement of operations',
      'gaap',
      'ebitda',
      'net loss',
      'profit',
      'cost of revenue',
    ]);
    const isManagement = containsAny(['management', 'executive', 'ceo', 'cfo', 'compensation', 'director', 'officer']);
    const isBusiness = containsAny(['business', 'strategy', 'competition', 'competitive', 'market', 'customers', 'product']);

    const queryType = ((): 'financial' | 'risk' | 'business' | 'management' | 'general' => {
      if (isFinancial) return 'financial';
      if (isRisk) return 'risk';
      if (isManagement) return 'management';
      if (isBusiness) return 'business';
      return 'general';
    })();

    const needsTables =
      queryType === 'financial' || /\$|\b\d{4}\b|%|\bshares?\b/i.test(q);

    const sections = ((): string[] => {
      switch (queryType) {
        case 'risk':
          return ['RISK FACTORS'];
        case 'financial':
          return ["MANAGEMENT'S DISCUSSION AND ANALYSIS", 'FINANCIAL STATEMENTS', 'RESULTS OF OPERATIONS'];
        case 'management':
          return ['MANAGEMENT', 'EXECUTIVE COMPENSATION'];
        case 'business':
          return ['BUSINESS'];
        default:
          return [];
      }
    })();

    const searchTerms = new Set<string>([q]);
    if (queryType === 'risk' && !lower.includes('risk')) searchTerms.add(`risk factors ${q}`);
    if (queryType === 'financial' && !containsAny(['financial', 'statements', 'operations'])) {
      searchTerms.add(`financial statements ${q}`);
    }

    return {
      queryType,
      searchTerms: Array.from(searchTerms),
      needsTables,
      sections,
    };
  }
});

// Step 2: Search for relevant information
const searchStep = createStep({
  id: 'search-information',
  description: 'Search the S-1 document for relevant information',
  inputSchema: z.object({
    queryType: z.string(),
    searchTerms: z.array(z.string()),
    needsTables: z.boolean(),
    sections: z.array(z.string()),
    originalQuery: z.string()
  }),
  outputSchema: z.object({
    textResults: z.array(z.object({
      text: z.string(),
      score: z.number(),
      metadata: z.record(z.any())
    })),
    tableResults: z.array(z.object({
      filename: z.string(),
      path: z.string(),
      section: z.string(),
      description: z.string(),
      caption: z.string().optional(),
      anchor: z.string().optional(),
      source_url: z.string().optional()
    }))
  }),
  execute: async ({ inputData, runtimeContext }) => {
    const { searchTerms, needsTables } = inputData;
    
    // Perform text search with re-ranking
    const searchPromises = searchTerms.map(term => 
      s1SearchWithRerankTool.execute({
        context: {
          query: term,
          topK: 10,
          rerankTopK: 5,
          // NOTE: our vector-store metadata stores `section_path` as a joined string and
          // the values here are inconsistent across filings. Section filtering is
          // valuable, but do it via chunk_type priors/reranking rather than brittle
          // equality filters.
          filter: undefined
        },
        runtimeContext
      })
    );
    
    const searchResults = await Promise.all(searchPromises);
    const textResults = searchResults.flatMap(r => r.results);
    
    // Remove duplicates based on text content
    const uniqueResults = Array.from(
      new Map(textResults.map(r => [r.text, r])).values()
    );
    
    // Search for tables if needed
    let tableResults: any[] = [];
    if (needsTables) {
      const tableSearch = await s1TableLookupTool.execute({
        context: {
          keyword: searchTerms[0]
        },
        runtimeContext
      });
      tableResults = tableSearch.tables;
    }
    
    return {
      textResults: uniqueResults.slice(0, 10),
      tableResults
    };
  }
});

// Step 3: Generate comprehensive answer
const generateAnswerStep = createStep({
  id: 'generate-answer',
  description: 'Generate a comprehensive answer based on search results',
  inputSchema: z.object({
    originalQuery: z.string(),
    textResults: z.array(z.object({
      text: z.string(),
      score: z.number(),
      metadata: z.record(z.any())
    })),
    tableResults: z.array(z.object({
      filename: z.string(),
      path: z.string(),
      section: z.string(),
      description: z.string(),
      caption: z.string().optional(),
      anchor: z.string().optional(),
      source_url: z.string().optional()
    }))
  }),
  outputSchema: z.object({
    answer: z.string(),
    citations: z.array(z.object({
      section: z.string(),
      pageNumber: z.number().optional(),
      type: z.enum(['text', 'table']),
      chunkId: z.string().optional(),
      tableFilename: z.string().optional(),
      source_url: z.string().optional(),
      anchor: z.string().optional()
    })),
    confidence: z.enum(['high', 'medium', 'low'])
  }),
  execute: async ({ inputData }) => {
    const { originalQuery, textResults, tableResults } = inputData;
    
    // Prepare context from search results
    const context = textResults.map((r, i) => 
      `[${i + 1}] ${r.text}\n[Section: ${r.metadata.section_hierarchy || 'Unknown'}, Page: ${r.metadata.page_idx || 'N/A'}]`
    ).join('\n\n');
    
    const tableContext = tableResults.length > 0
      ? '\n\nRelevant tables found:\n' + tableResults.map(t => 
          `- ${t.description} (${t.filename})`
        ).join('\n')
      : '';
    
    // Generate answer using the agent
    const response = await s1QueryAgent.generate([
      {
        role: 'system',
        content: 'Generate a comprehensive answer based on the following search results from the S-1 document. Include specific citations.'
      },
      {
        role: 'user',
        content: `Query: "${originalQuery}"\n\nSearch Results:\n${context}${tableContext}`
      }
    ]);
    
    // Extract citations from the response
    const citations: Array<{
      section: string;
      pageNumber?: number;
      type: 'text' | 'table';
      chunkId?: string;
      tableFilename?: string;
      source_url?: string;
      anchor?: string;
    }> = [
      ...textResults.map(r => ({
        section: r.metadata.section_hierarchy || 'Unknown',
        pageNumber: r.metadata.page_idx,
        type: 'text' as const,
        chunkId: r.metadata.id,
        source_url: r.metadata.source_url,
        anchor: r.metadata.anchor,
      })),
      ...tableResults.map(t => ({
        section: t.section,
        type: 'table' as const,
        tableFilename: t.filename,
        source_url: t.source_url,
        anchor: t.anchor,
      })),
    ];
    
    // Determine confidence based on result quality
    const confidence: 'high' | 'medium' | 'low' =
      textResults.length > 3 && textResults[0].score > 0.8
        ? 'high'
        : textResults.length > 0
          ? 'medium'
          : 'low';
    
    return {
      answer: response.text,
      citations: Array.from(new Map(citations.map(c => 
        [`${c.section}-${c.pageNumber}-${c.type}`, c]
      )).values()),
      confidence
    };
  }
});

// Create the main workflow
export const s1QueryWorkflow = createWorkflow({
  id: 's1-query-workflow',
  description: 'Multi-step workflow for comprehensive S-1 document queries',
  inputSchema: z.object({
    query: z.string().describe('The user query about the S-1 document')
  }),
  outputSchema: z.object({
    answer: z.string(),
    citations: z.array(z.object({
      section: z.string(),
      pageNumber: z.number().optional(),
      type: z.enum(['text', 'table']),
      chunkId: z.string().optional(),
      tableFilename: z.string().optional(),
      source_url: z.string().optional(),
      anchor: z.string().optional()
    })),
    confidence: z.enum(['high', 'medium', 'low'])
  })
})
  .then(analyzeQueryStep)
  .map(async ({ inputData, getInitData }) => ({
    ...inputData,
    originalQuery: getInitData().query
  }))
  .then(searchStep)
  .map(async ({ inputData, getInitData }) => ({
    ...inputData,
    originalQuery: getInitData().query
  }))
  .then(generateAnswerStep)
  .commit();

// Create a simple workflow for basic queries
export const s1SimpleWorkflow = createWorkflow({
  id: 's1-simple-workflow',
  description: 'Simple workflow for basic S-1 lookups',
  inputSchema: z.object({
    query: z.string()
  }),
  outputSchema: z.object({
    answer: z.string()
  })
})
  .then(createStep({
    id: 'simple-search',
    inputSchema: z.object({ query: z.string() }),
    outputSchema: z.object({ answer: z.string() }),
    execute: async ({ inputData }) => {
      const response = await s1QueryAgent.generate([
        { role: 'user', content: inputData.query }
      ]);
      
      return { answer: response.text };
    }
  }))
  .commit();
