import dotenv from 'dotenv';

// Load environment variables FIRST before any imports that need them
dotenv.config();

import { Mastra } from '@mastra/core';
import { PgVector } from '@mastra/pg';
import { s1QueryAgent, s1BasicAgent } from '../agents/s1QueryAgent.js';
import { 
  financialAnalysisAgent,
  businessStrategyAgent,
  riskAssessmentAgent,
  valuationAgent,
  executiveSummaryAgent
} from '../agents/index.js';
import { s1QueryWorkflow, s1SimpleWorkflow } from '../workflows/s1QueryWorkflow.js';
import { investmentResearchWorkflow } from '../workflows/investmentResearchWorkflow.js';
import { 
  s1VectorQueryTool, 
  s1SearchWithRerankTool, 
  s1TableLookupTool 
} from '../tools/vectorQuery.js';

// Initialize Mastra instance
export const mastra = new Mastra({
  agents: {
    s1QueryAgent,
    s1BasicAgent,
    financialAnalysisAgent,
    businessStrategyAgent,
    riskAssessmentAgent,
    valuationAgent,
    executiveSummaryAgent
  },
  
  workflows: {
    s1QueryWorkflow,
    s1SimpleWorkflow,
    investmentResearchWorkflow
  },
  
  vectors: {
    pgVector: new PgVector({
      connectionString: process.env.POSTGRES_CONNECTION_STRING!
    })
  }
});

// Initialize hybrid search proactively
let hybridSearchInitialized = false;

/**
 * Initialize hybrid search system proactively
 * This helps avoid initialization delays during workflow execution
 */
async function initializeHybridSearch(): Promise<boolean> {
  if (hybridSearchInitialized) {
    return true;
  }
  
  try {
    console.log('🚀 Initializing hybrid search system...');
    
    // Lazy import to avoid circular dependencies
    const { getHybridSearcher } = await import('../search/hybridSearch.js');
    await getHybridSearcher();
    
    hybridSearchInitialized = true;
    console.log('✅ Hybrid search system initialized successfully');
    return true;
  } catch (error) {
    console.warn('⚠️  Hybrid search initialization failed (will use fallback):', error instanceof Error ? error.message : 'Unknown error');
    return false;
  }
}

/**
 * Check if hybrid search is ready
 */
export function isHybridSearchReady(): boolean {
  return hybridSearchInitialized;
}

/**
 * Force re-initialization of hybrid search
 */
export async function reinitializeHybridSearch(): Promise<boolean> {
  hybridSearchInitialized = false;
  return initializeHybridSearch();
}

// Auto-initialize hybrid search (non-blocking)
initializeHybridSearch().catch(() => {
  // Silently fail - fallback mechanisms will handle this
});

// Export individual components for direct use
export { 
  s1QueryAgent, 
  s1BasicAgent,
  s1QueryWorkflow,
  s1SimpleWorkflow
};