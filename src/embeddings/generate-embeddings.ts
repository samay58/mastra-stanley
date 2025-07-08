import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { openai } from '@ai-sdk/openai';
import { embedMany } from 'ai';
import { PgVector } from '@mastra/pg';
import dotenv from 'dotenv';
import type { Chunk } from '../types/index.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface EmbeddingBatch {
  chunks: Chunk[];
  embeddings: number[][];
}

class EmbeddingGenerator {
  private vectorStore: PgVector;
  private batchSize = 50; // Process 50 chunks at a time
  
  constructor() {
    // Initialize vector store
    this.vectorStore = new PgVector({
      connectionString: process.env.POSTGRES_CONNECTION_STRING!
    });
  }

  async loadChunks(): Promise<Chunk[]> {
    console.log('Loading chunks from JSONL file...');
    const jsonlPath = join(__dirname, '../../output/text_chunks.jsonl');
    const content = await readFile(jsonlPath, 'utf-8');
    
    const chunks: Chunk[] = content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
    
    console.log(`Loaded ${chunks.length} chunks`);
    return chunks;
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      const { embeddings } = await embedMany({
        model: openai.embedding('text-embedding-3-small'),
        values: texts
      });
      
      return embeddings;
    } catch (error) {
      console.error('Error generating embeddings:', error);
      throw error;
    }
  }

  async processBatch(chunks: Chunk[]): Promise<EmbeddingBatch> {
    const texts = chunks.map(chunk => chunk.content);
    const embeddings = await this.generateEmbeddings(texts);
    
    return { chunks, embeddings };
  }

  async initializeVectorStore(): Promise<void> {
    console.log('Initializing vector store...');
    
    try {
      // Create index if it doesn't exist
      await this.vectorStore.createIndex({
        indexName: 's1_embeddings',
        dimension: 1536, // text-embedding-3-small dimension
        replace: true // Replace if exists
      });
      
      console.log('Vector store initialized');
    } catch (error) {
      console.error('Error initializing vector store:', error);
      throw error;
    }
  }

  async storeBatch(batch: EmbeddingBatch): Promise<void> {
    const { chunks, embeddings } = batch;
    
    // Prepare metadata for each chunk
    const metadata = chunks.map(chunk => ({
      id: chunk.id,
      text: chunk.content,
      section_path: chunk.metadata.section_path.join(' > '),
      section_hierarchy: chunk.metadata.section_hierarchy,
      page_idx: chunk.metadata.page_idx,
      chunk_type: chunk.metadata.chunk_type,
      chunk_size: chunk.metadata.chunk_size,
      timestamp: chunk.metadata.timestamp
    }));

    // Upsert embeddings with metadata
    await this.vectorStore.upsert({
      indexName: 's1_embeddings',
      vectors: embeddings,
      metadata
    });
  }

  async processAllChunks(): Promise<void> {
    console.log('\n=== Starting Embedding Generation ===\n');
    
    // Load all chunks
    const chunks = await this.loadChunks();
    
    // Initialize vector store
    await this.initializeVectorStore();
    
    // Process in batches
    const totalBatches = Math.ceil(chunks.length / this.batchSize);
    console.log(`Processing ${totalBatches} batches of ${this.batchSize} chunks each...\n`);
    
    for (let i = 0; i < chunks.length; i += this.batchSize) {
      const batchNum = Math.floor(i / this.batchSize) + 1;
      const batchChunks = chunks.slice(i, i + this.batchSize);
      
      console.log(`Processing batch ${batchNum}/${totalBatches} (${batchChunks.length} chunks)...`);
      
      try {
        // Generate embeddings for batch
        const batch = await this.processBatch(batchChunks);
        
        // Store in vector database
        await this.storeBatch(batch);
        
        console.log(`✓ Batch ${batchNum} complete`);
        
        // Add a small delay to avoid rate limits
        if (i + this.batchSize < chunks.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`Error processing batch ${batchNum}:`, error);
        throw error;
      }
    }
    
    console.log('\n=== Embedding Generation Complete! ===');
    console.log(`Total chunks processed: ${chunks.length}`);
    console.log(`Embeddings stored in index: s1_embeddings`);
  }
}

// Main execution
async function main() {
  // Check for required environment variables
  if (!process.env.OPENAI_API_KEY) {
    console.error('Error: OPENAI_API_KEY not found in environment variables');
    process.exit(1);
  }
  
  if (!process.env.POSTGRES_CONNECTION_STRING) {
    console.error('Error: POSTGRES_CONNECTION_STRING not found in environment variables');
    console.log('Please set up PostgreSQL with pgvector extension and add the connection string to .env');
    process.exit(1);
  }
  
  try {
    const generator = new EmbeddingGenerator();
    await generator.processAllChunks();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { EmbeddingGenerator };