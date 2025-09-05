/**
 * Agent Quick Check
 *
 * What: Runs a few sanity queries against the Financial Analysis Agent.
 * Why: Quick verification that env vars and DB connectivity are wired up.
 * Run: `npx tsx examples/agent_quick_check.ts`
 * Reqs: `OPENAI_API_KEY`, `POSTGRES_CONNECTION_STRING` in `.env`.
 * Tip: Start Postgres locally (with pgvector) before running.
 */

import dotenv from 'dotenv';
dotenv.config();

import { financialAnalysisAgent } from '../src/agents/financialAnalysisAgent.js';

async function main() {
  console.log('🧪 Agent Quick Check\n');

  const testQueries = [
    "What is Figma's 2024 revenue?",
    "What is Figma's gross margin for 2024?",
    "How has Figma's revenue and net income trended?",
  ];

  for (const query of testQueries) {
    console.log(`\n📊 Query: ${query}`);
    console.log('='.repeat(60));

    try {
      const response = await financialAnalysisAgent.generate(query);
      console.log('\n📈 Response:');
      // Some agent SDKs return plain text; others return an object
      console.log((response as any).text ?? response);

      const messages = (response as any).messages ?? [];
      const toolCalls = messages.filter((m: any) => m.role === 'tool');
      if (toolCalls.length > 0) {
        console.log(`\n🔧 Tools used: ${toolCalls.length}`);
        toolCalls.forEach((call: any) => {
          console.log(`   - ${call.name ?? 'Unknown tool'}`);
        });
      }
    } catch (error) {
      console.error('❌ Error:', error);
    }

    console.log('\n' + '-'.repeat(60));
  }
}

main().catch(console.error);

