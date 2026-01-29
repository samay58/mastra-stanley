import dotenv from 'dotenv';
// Load environment variables before any other imports
dotenv.config();

import { Agent } from '@mastra/core/agent';
import { openai } from '@ai-sdk/openai';
import { Memory } from '@mastra/memory';
import { PgVector, PostgresStore } from '@mastra/pg';
import { 
  s1VectorQueryTool, 
  s1SearchWithRerankTool, 
  s1TableLookupTool,
  s1TableDataTool,
  s1HybridSearchTool,
  s1EnhancedSearchTool
} from '../tools/vectorQuery.js';
import { s1FactsLookupTool } from '../tools/facts.js';

// Create memory system for S-1 analysis with context retention
const memory = new Memory({
  storage: new PostgresStore({
    connectionString: process.env.POSTGRES_CONNECTION_STRING!
  }),
  vector: new PgVector({
    connectionString: process.env.POSTGRES_CONNECTION_STRING!
  }),
  embedder: openai.embedding('text-embedding-3-small'),
  options: {
    lastMessages: 20, // Keep more context for complex financial discussions
    semanticRecall: {
      topK: 5, // Recall relevant previous queries and answers
      messageRange: 10
    },
    workingMemory: {
      enabled: true,
      template: `Previous S-1 analysis context:
{workingMemory}

Use this context to provide more comprehensive and connected analysis.`
    }
  }
});

export const s1QueryAgent = new Agent({
  name: 'S1QueryAgent',
  description: 'An expert agent for analyzing and answering questions about an S-1 IPO filing document',
  model: openai('gpt-4o-mini'),
  memory,
  instructions: `You are an expert financial analyst specializing in S-1 IPO filings. You have access to the active S-1 document via search and table tools.

## SEARCH STRATEGY (CRITICAL)
**ALWAYS START WITH**: enhancedS1Search - This uses advanced query expansion and hybrid search

**For Financial Queries**: 
- Use enhancedS1Search with expandQuery=true for natural language queries
- Try with useHyDE=true if initial results are poor
- Fallback to hybridS1Search or searchS1WithRerank if needed

**For Numeric / Offering-Term Questions (PREFERRED FAST PATH)**:
- Use lookupS1Facts first (facts are extracted deterministically with citations).
- Only state a number if you can cite a fact evidence object or a table row/value with an anchor/source_url.

**For Table / Numeric Data (PREFERRED)**:
- Use tableDataReader to fetch the exact row(s) and period(s) from extracted tables.
- Only state a number if you can quote the row/value and cite the table anchor/section.

**Search Tips**:
- Natural questions work: "What is the company's revenue?" 
- The enhanced search handles synonyms: revenue = income = earnings
- Adjustable vectorWeight: lower (0.3-0.5) for exact matches, higher (0.7-0.9) for conceptual search

## KEY FINANCIAL SECTIONS
- Management's Discussion and Analysis (MD&A)
- Results of Operations  
- Financial Statements
- Principal and Selling Stockholders
- Capitalization

## RESPONSE FORMAT
**Direct Answer**: [Clear response with specific numbers/data]

**Supporting Evidence**: 
- [Exact quote] (Section: [name], Page: [number])

**Analysis**: [Brief expert interpretation]

**Confidence Level**: High/Medium/Low

## QUALITY REQUIREMENTS
- **Do not use prior knowledge**. Only use what you can retrieve from the tools.
- **Cite specific sections and anchors** from the S-1 document.
- **Do not invent numbers**. If the exact value/period isn't found, say so and explain what you searched.
- **Search thoroughly** - if you don't find detailed data, try different search terms
- **Prioritize quantitative data** over general statements

Remember: This S-1 contains comprehensive financial information. If basic queries about revenue/ownership return limited results, refine your search terms and try multiple approaches.`,
  
  tools: {
    lookupS1Facts: s1FactsLookupTool,
    enhancedS1Search: s1EnhancedSearchTool,
    searchS1Document: s1VectorQueryTool,
    searchS1WithRerank: s1SearchWithRerankTool,
    hybridS1Search: s1HybridSearchTool,
    lookupS1Table: s1TableLookupTool,
    tableDataReader: s1TableDataTool
  }
});

// Create a simpler version for basic queries
export const s1BasicAgent = new Agent({
  name: 'S1BasicAgent', 
  description: 'A streamlined agent for quick S-1 document lookups',
  model: openai('gpt-4o-mini'),
  instructions: `You are a helpful assistant for looking up information in the active S-1 filing. 
  
Use the search tool to find relevant information and provide concise, accurate answers.
Always cite the section and page number when providing information.`,
  
  tools: {
    searchS1Document: s1VectorQueryTool
  }
});
