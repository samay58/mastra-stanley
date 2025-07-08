import dotenv from 'dotenv';

// Load environment variables FIRST before any imports that need them
dotenv.config();

import { Mastra } from '@mastra/core';
import { PgVector } from '@mastra/pg';
import { s1QueryAgent, s1BasicAgent } from '../agents/s1QueryAgent.js';
import { s1QueryWorkflow, s1SimpleWorkflow } from '../workflows/s1QueryWorkflow.js';
import { 
  s1VectorQueryTool, 
  s1SearchWithRerankTool, 
  s1TableLookupTool 
} from '../tools/vectorQuery.js';

// Initialize Mastra instance
export const mastra = new Mastra({
  agents: {
    s1QueryAgent,
    s1BasicAgent
  },
  
  workflows: {
    s1QueryWorkflow,
    s1SimpleWorkflow
  },
  
  vectors: {
    pgVector: new PgVector({
      connectionString: process.env.POSTGRES_CONNECTION_STRING!
    })
  }
});

// Export individual components for direct use
export { 
  s1QueryAgent, 
  s1BasicAgent,
  s1QueryWorkflow,
  s1SimpleWorkflow
};