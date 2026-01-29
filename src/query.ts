import dotenv from 'dotenv';

// Load environment variables FIRST
dotenv.config();

import { mastra, s1QueryAgent } from './mastra/index.js';

async function queryS1(question: string, useWorkflow: boolean = false) {
  console.log('\n=== S-1 Query Interface ===\n');
  console.log(`Question: ${question}`);
  console.log(`Mode: ${useWorkflow ? 'Workflow (comprehensive)' : 'Agent (direct)'}\n`);

  try {
    if (useWorkflow) {
      // Use workflow for comprehensive multi-step processing
      console.log('Running comprehensive workflow...\n');
      
      const workflow = mastra.getWorkflow('s1QueryWorkflow');
      const run = await workflow.createRunAsync();
      
      const result = await run.start({
        inputData: { query: question }
      });
      
      if (result.status === 'success') {
        console.log('Answer:', result.result.answer);
        console.log('\nCitations:');
        result.result.citations.forEach(citation => {
          const source = citation.source_url
            ? citation.anchor
              ? `${citation.source_url}#${citation.anchor}`
              : citation.source_url
            : undefined;
          console.log(
            `- ${citation.section} ${citation.pageNumber ? `(Page ${citation.pageNumber})` : ''} [${citation.type}]${source ? ` ${source}` : ''}`
          );
        });
        console.log(`\nConfidence: ${result.result.confidence}`);
      } else if (result.status === 'failed') {
        console.error('Workflow failed:', result.error);
      } else {
        console.error('Workflow suspended:', result.suspended);
      }
    } else {
      // Use agent directly for simple queries
      console.log('Using direct agent query...\n');
      
      const response = await s1QueryAgent.generate([
        { role: 'user', content: question }
      ]);
      
      console.log('Answer:', response.text);
    }
  } catch (error) {
    console.error('Error processing query:', error);
  }
}

// Example queries to test the system
async function runExamples() {
  console.log('=== IPO S-1 Agent Examples ===\n');
  
  // Check environment
  if (!process.env.OPENAI_API_KEY || !process.env.POSTGRES_CONNECTION_STRING) {
    console.error('Error: Missing required environment variables');
    console.log('Please ensure OPENAI_API_KEY and POSTGRES_CONNECTION_STRING are set in .env');
    process.exit(1);
  }

  // Example 1: Simple financial query
  await queryS1('What is the IPO price range?');
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Example 2: Risk analysis (using workflow)
  await queryS1("What are the top 3 risks mentioned in the Risk Factors section?", true);
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Example 3: Financial metrics
  await queryS1('What were the company\'s revenues and key business metrics?');
}

// Command line interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    // Run examples
    await runExamples();
  } else {
    // Process user query
    const query = args.join(' ');
    const useWorkflow = args.includes('--workflow') || args.includes('-w');
    
    await queryS1(query, useWorkflow);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { queryS1 };
