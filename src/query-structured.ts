#!/usr/bin/env tsx

import 'dotenv/config';
import { mastra } from './mastra/index.js';
import { getSchemaForQuery } from './schemas/s1QuerySchemas.js';

async function main() {
  const question = process.argv.slice(2).join(' ');
  
  if (!question) {
    console.log('Usage: npm run query-structured "Your question here"');
    process.exit(1);
  }

  console.log('\n=== Enhanced S-1 Query Interface (Structured Output) ===\n');
  console.log(`Question: ${question}`);
  
  // Determine appropriate schema based on query
  const schema = getSchemaForQuery(question);
  const schemaType = getSchemaType(question);
  console.log(`Schema Type: ${schemaType}`);
  console.log(`Mode: Agent with structured output\n`);

  try {
    const agent = mastra.getAgent('s1QueryAgent');
    
    console.log('Generating structured response...\n');
    
    const result = await agent.generate(question, {
      output: schema,
      maxSteps: 8 // Allow multiple search steps
    });

    if (result.object) {
      console.log('=== STRUCTURED RESPONSE ===\n');
      console.log(JSON.stringify(result.object, null, 2));
    } else {
      console.log('Answer:', result.text);
    }

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

function getSchemaType(query: string): string {
  const lowerQuery = query.toLowerCase();
  
  if (lowerQuery.includes('ownership') || lowerQuery.includes('shares') || lowerQuery.includes('equity') || lowerQuery.includes('voting')) {
    return 'Ownership Analysis';
  }
  
  if (lowerQuery.includes('revenue') || lowerQuery.includes('income') || lowerQuery.includes('financial') || lowerQuery.includes('earnings') || lowerQuery.includes('loss')) {
    return 'Financial Data';
  }
  
  if (lowerQuery.includes('risk') || lowerQuery.includes('factor') || lowerQuery.includes('threat') || lowerQuery.includes('challenge')) {
    return 'Risk Analysis';
  }
  
  if (lowerQuery.includes('business') || lowerQuery.includes('operations') || lowerQuery.includes('model') || lowerQuery.includes('strategy')) {
    return 'Business Operations';
  }
  
  return 'General Analysis';
}

main();