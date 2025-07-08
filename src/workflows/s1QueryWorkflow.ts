import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { s1QueryAgent } from '../agents/s1QueryAgent.js';
import { openai } from '@ai-sdk/openai';

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
    
    // Use GPT to analyze the query
    const prompt = `Analyze this S-1 document query and extract:
1. Query type (financial/risk/business/management/general)
2. Key search terms
3. Whether financial tables are needed
4. Relevant S-1 sections to search

Query: "${query}"

Respond in JSON format.`;

    const response = await openai('gpt-4o-mini').doGenerate({
      inputFormat: 'messages',
      mode: { type: 'regular' },
      prompt: [{ role: 'user', content: prompt }],
      output: 'object'
    });

    const analysis = response.object as any;
    
    return {
      queryType: analysis.queryType || 'general',
      searchTerms: analysis.searchTerms || [query],
      needsTables: analysis.needsTables || false,
      sections: analysis.sections || []
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
      section: z.string(),
      description: z.string()
    }))
  }),
  execute: async ({ inputData }) => {
    const { searchTerms, needsTables, sections, originalQuery } = inputData;
    
    // Perform text search with re-ranking
    const searchPromises = searchTerms.map(term => 
      s1QueryAgent.tools.searchS1WithRerank.execute({
        context: {
          query: term,
          topK: 10,
          rerankTopK: 5,
          filter: sections.length > 0 ? { section_path: sections[0] } : undefined
        },
        mastra: undefined as any,
        runtimeContext: undefined as any
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
      const tableSearch = await s1QueryAgent.tools.lookupS1Table.execute({
        context: {
          keyword: searchTerms[0]
        },
        mastra: undefined as any,
        runtimeContext: undefined as any
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
      section: z.string(),
      description: z.string()
    }))
  }),
  outputSchema: z.object({
    answer: z.string(),
    citations: z.array(z.object({
      section: z.string(),
      pageNumber: z.number().optional(),
      type: z.enum(['text', 'table'])
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
    const citations = textResults.map(r => ({
      section: r.metadata.section_hierarchy || 'Unknown',
      pageNumber: r.metadata.page_idx,
      type: 'text' as const
    })).concat(tableResults.map(t => ({
      section: t.section,
      pageNumber: undefined,
      type: 'table' as const
    })));
    
    // Determine confidence based on result quality
    const confidence = textResults.length > 3 && textResults[0].score > 0.8 
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
      type: z.enum(['text', 'table'])
    })),
    confidence: z.enum(['high', 'medium', 'low'])
  })
})
  .then(analyzeQueryStep)
  .map(({ inputData, getInitData }) => ({
    ...inputData,
    originalQuery: getInitData().query
  }))
  .then(searchStep)
  .map(({ inputData, getInitData }) => ({
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