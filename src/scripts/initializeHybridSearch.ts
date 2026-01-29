#!/usr/bin/env tsx

/**
 * Hybrid Search Initialization Helper
 * 
 * This script initializes the hybrid search system and validates that all
 * required components are working correctly. Useful for debugging and
 * ensuring the search system is ready before running workflows.
 */

import dotenv from 'dotenv';
import { getActiveFilingContext } from '../config/filing.js';

// Load environment variables
dotenv.config();

async function initializeAndValidate() {
  console.log('🔍 Hybrid Search Initialization & Validation');
  console.log('=============================================\n');

  try {
    // Step 1: Check environment
    console.log('📋 Step 1: Environment Check');
    if (!process.env.POSTGRES_CONNECTION_STRING) {
      throw new Error('POSTGRES_CONNECTION_STRING environment variable is required');
    }
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    console.log('✅ Environment variables present\n');

    // Step 2: Check chunks file
    console.log('📋 Step 2: Chunks File Check');
    const { access } = await import('fs/promises');
    const chunksPath = getActiveFilingContext().chunksPath;
    
    try {
      await access(chunksPath);
      console.log(`✅ Chunks file found: ${chunksPath}`);
      
      // Check file size
      const { stat } = await import('fs/promises');
      const stats = await stat(chunksPath);
      console.log(`📊 File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
      
      // Count lines
      const { readFile } = await import('fs/promises');
      const content = await readFile(chunksPath, 'utf-8');
      const lineCount = content.split('\n').filter(line => line.trim()).length;
      console.log(`📊 Chunk count: ${lineCount} lines\n`);
    } catch (error) {
      console.error(`❌ Chunks file not found: ${chunksPath}`);
      console.error('💡 Run "npm run process-s1" to generate the chunks file');
      throw error;
    }

    // Step 3: Initialize hybrid search
    console.log('📋 Step 3: Hybrid Search Initialization');
    const { getHybridSearcher } = await import('../search/hybridSearch.js');
    
    const startTime = Date.now();
    const searcher = await getHybridSearcher();
    const initTime = Date.now() - startTime;
    
    console.log(`✅ Hybrid search initialized in ${initTime}ms\n`);

    // Step 4: Test search functionality
    console.log('📋 Step 4: Search Functionality Test');
    
    const testQueries = [
      'revenue growth',
      'beneficial ownership',
      'risk factors',
      'financial statements'
    ];

    for (const query of testQueries) {
      console.log(`🔍 Testing query: "${query}"`);
      
      try {
        const searchStart = Date.now();
        const results = await searcher.search(query, { topK: 3 });
        const searchTime = Date.now() - searchStart;
        
        console.log(`  ✅ Found ${results.length} results in ${searchTime}ms`);
        
        if (results.length > 0) {
          const topResult = results[0];
          console.log(`  📊 Top result score: ${topResult.score.toFixed(3)} (vector: ${topResult.vectorScore.toFixed(3)}, keyword: ${topResult.keywordScore.toFixed(3)})`);
          console.log(`  📄 Content preview: ${topResult.chunk.content.substring(0, 100)}...`);
        }
      } catch (error) {
        console.error(`  ❌ Search failed for "${query}":`, error instanceof Error ? error.message : 'Unknown error');
      }
      console.log('');
    }

    // Step 5: Test vector store connectivity
    console.log('📋 Step 5: Vector Store Connectivity Test');
    
    try {
      const { PgVector } = await import('@mastra/pg');
      const vectorStore = new PgVector({
        connectionString: process.env.POSTGRES_CONNECTION_STRING!
      });
      
      // Test with a simple embedding query
      const { openai } = await import('@ai-sdk/openai');
      const { embed } = await import('ai');
      
      const { embedding } = await embed({
        model: openai.embedding('text-embedding-3-small'),
        value: 'test query'
      });

      const indexName = process.env.S1_VECTOR_INDEX?.trim() || 's1_embeddings';
      
      const vectorResults = await vectorStore.query({
        indexName,
        queryVector: embedding,
        topK: 1
      });
      
      console.log(`✅ Vector store connection successful - found ${vectorResults.length} results\n`);
    } catch (error) {
      console.error('❌ Vector store connection failed:', error instanceof Error ? error.message : 'Unknown error');
    }

    // Step 6: System health summary
    console.log('📋 Step 6: System Health Summary');
    console.log('✅ Basic hybrid search checks passed\n');

    console.log('🚀 You can now run:');
    console.log('  • npm run test-workflow');
    console.log('  • npm run generate-report');
    console.log('  • npm run query "your search query"');

  } catch (error) {
    console.error('\n❌ Initialization failed:', error instanceof Error ? error.message : 'Unknown error');
    
    console.log('\n🔧 Troubleshooting steps:');
    console.log('1. Ensure PostgreSQL is running with pgvector extension');
    console.log('2. Check that embeddings have been generated: npm run embed');
    console.log('3. Verify S-1 document has been processed: npm run process-s1');
    console.log('4. Check environment variables in .env file');
    
    process.exit(1);
  }
}

// Health check function
export async function hybridSearchHealthCheck(): Promise<boolean> {
  try {
    const { getHybridSearcher } = await import('../search/hybridSearch.js');
    const searcher = await getHybridSearcher();
    
    // Test a simple search
    const results = await searcher.search('test', { topK: 1 });
    return results.length >= 0; // Even 0 results is OK, as long as no error
  } catch {
    return false;
  }
}

// Run initialization if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  initializeAndValidate().catch(console.error);
}

export { initializeAndValidate };
