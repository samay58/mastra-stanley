import dotenv from 'dotenv';
// Load environment variables before any other imports
dotenv.config();

import { Agent } from '@mastra/core/agent';
import { openai } from '@ai-sdk/openai';
import { embed } from 'ai';
import { Memory } from '@mastra/memory';
import { PgVector, PostgresStore } from '@mastra/pg';
import { 
  s1VectorQueryTool, 
  s1SearchWithRerankTool, 
  s1TableLookupTool,
  s1HybridSearchTool,
  s1EnhancedSearchTool
} from '../tools/vectorQuery.js';

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
  description: 'An expert agent for analyzing and answering questions about Figma\'s S-1 IPO filing document',
  model: openai('gpt-4o-mini'),
  memory,
  instructions: `You are an expert financial analyst specializing in S-1 IPO filings. You have access to Figma's complete S-1 document with enhanced search capabilities.

## SEARCH STRATEGY (CRITICAL)
**ALWAYS START WITH**: enhancedS1Search - This uses advanced query expansion and hybrid search

**For Financial Queries**: 
- Use enhancedS1Search with expandQuery=true for natural language queries
- Try with useHyDE=true if initial results are poor
- Fallback to hybridS1Search or searchS1WithRerank if needed

**For Table Data**: Use lookupS1Table first, then search for context

**Search Tips**:
- Natural questions work: "What is Figma's revenue?" 
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
- **Find the actual financial data** - revenue was $749M in 2024, 48% YoY growth
- **Cite specific sections and pages** from the S-1 document
- **Search thoroughly** - if you don't find detailed data, try different search terms
- **Prioritize quantitative data** over general statements

Remember: This S-1 contains comprehensive financial information. If basic queries about revenue/ownership return limited results, refine your search terms and try multiple approaches.`,
  
  tools: {
    enhancedS1Search: s1EnhancedSearchTool,
    searchS1Document: s1VectorQueryTool,
    searchS1WithRerank: s1SearchWithRerankTool,
    hybridS1Search: s1HybridSearchTool,
    lookupS1Table: s1TableLookupTool
  }
});

// Create a simpler version for basic queries
export const s1BasicAgent = new Agent({
  name: 'S1BasicAgent', 
  description: 'A streamlined agent for quick S-1 document lookups',
  model: openai('gpt-4o-mini'),
  instructions: `You are a helpful assistant for looking up information in Figma's S-1 filing. 
  
Use the search tool to find relevant information and provide concise, accurate answers.
Always cite the section and page number when providing information.`,
  
  tools: {
    searchS1Document: s1VectorQueryTool
  }
});