import { PgVector } from '@mastra/pg';
import { openai } from '@ai-sdk/openai';
import { embed } from 'ai';
import { BM25Scorer, createBM25Index, combineScores } from './bm25.js';
import { queryExpander } from './queryExpander.js';
import { Chunk } from '../types/index.js';

interface HybridSearchResult {
  chunk: Chunk;
  score: number;
  vectorScore: number;
  keywordScore: number;
  metadata: any;
}

interface HybridSearchOptions {
  topK?: number;
  vectorWeight?: number;
  expandQuery?: boolean;
  useHyDE?: boolean;
  filter?: {
    section_path?: string;
    page_idx?: number;
  };
}

export class HybridSearcher {
  private vectorStore: PgVector;
  private bm25Scorer: BM25Scorer | null = null;
  private chunksCache: Map<string, Chunk> = new Map();
  
  constructor(connectionString: string) {
    this.vectorStore = new PgVector({ connectionString });
  }
  
  /**
   * Initialize BM25 index with chunks
   */
  async initialize(): Promise<void> {
    // console.log('Initializing hybrid search...');
    
    try {
      // Load all chunks for BM25 indexing
      const chunks = await this.loadAllChunks();
      
      // Build BM25 index
      this.bm25Scorer = await createBM25Index(chunks);
      
      // Cache chunks for quick lookup
      chunks.forEach(chunk => {
        this.chunksCache.set(chunk.id, chunk);
      });
      
      // console.log(`Hybrid search initialized with ${chunks.length} chunks`);
    } catch (error) {
      console.error('Error initializing hybrid search:', error);
      throw error;
    }
  }
  
  /**
   * Perform hybrid search combining vector and keyword search
   */
  async search(
    query: string, 
    options: HybridSearchOptions = {}
  ): Promise<HybridSearchResult[]> {
    const {
      topK = 10,
      vectorWeight = 0.7,
      expandQuery = true,
      useHyDE = false,
      filter
    } = options;
    
    if (!this.bm25Scorer) {
      throw new Error('Hybrid search not initialized. Call initialize() first.');
    }
    
    // Expand query if requested
    let searchQueries = [query];
    if (expandQuery) {
      const expanded = await queryExpander.expandQuery(query);
      searchQueries = [query, ...expanded.expanded.slice(0, 2)]; // Use top 2 expansions
    }
    
    // Generate hypothetical answer if using HyDE
    if (useHyDE) {
      const hypothetical = await queryExpander.generateHypotheticalAnswer(query);
      searchQueries.push(hypothetical);
    }
    
    // Collect results from all query variations
    const allResults = new Map<string, HybridSearchResult>();
    
    for (const searchQuery of searchQueries) {
      // Perform vector search
      const vectorResults = await this.vectorSearch(searchQuery, topK * 2, filter);
      
      // Perform keyword search
      const keywordResults = this.keywordSearch(searchQuery, topK * 2);
      
      // Optional debug logging (commented out for production)
      // if (searchQuery === query) { // Only log for original query
      //   console.log(`Vector results: ${vectorResults.length}, Keyword results: ${keywordResults.length}`);
      //   if (keywordResults.length > 0) {
      //     console.log(`Top keyword result: ID=${keywordResults[0].id}, Score=${keywordResults[0].score.toFixed(3)}`);
      //   }
      // }
      
      // Combine results
      this.mergeResults(
        vectorResults, 
        keywordResults, 
        vectorWeight,
        allResults
      );
    }
    
    // Sort by combined score and return top K
    return Array.from(allResults.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
  
  /**
   * Perform vector similarity search
   */
  private async vectorSearch(
    query: string,
    topK: number,
    filter?: any
  ): Promise<Array<{ id: string; score: number; metadata: any }>> {
    // Generate embedding for query
    const { embedding } = await embed({
      model: openai.embedding('text-embedding-3-small'),
      value: query
    });
    
    // Search vector store
    const results = await this.vectorStore.query({
      indexName: 's1_embeddings',
      queryVector: embedding,
      topK,
      filter
    });
    
    return results.map(r => ({
      id: r.metadata?.id || r.id,
      score: r.score,
      metadata: r.metadata || {}
    }));
  }
  
  /**
   * Perform BM25 keyword search
   */
  private keywordSearch(
    query: string,
    topK: number
  ): Array<{ id: string; score: number }> {
    if (!this.bm25Scorer) return [];
    
    const chunks = Array.from(this.chunksCache.values());
    const results = this.bm25Scorer.search(query, chunks, topK);
    
    return results.map(r => ({
      id: r.chunk.id,
      score: r.score
    }));
  }
  
  /**
   * Merge vector and keyword results
   */
  private mergeResults(
    vectorResults: Array<{ id: string; score: number; metadata: any }>,
    keywordResults: Array<{ id: string; score: number }>,
    vectorWeight: number,
    mergedResults: Map<string, HybridSearchResult>
  ): void {
    // Create maps for quick lookup
    const vectorMap = new Map(vectorResults.map(r => [r.id, r]));
    const keywordMap = new Map(keywordResults.map(r => [r.id, r]));
    
    // Get all unique chunk IDs
    const allIds = new Set([
      ...vectorResults.map(r => r.id),
      ...keywordResults.map(r => r.id)
    ]);
    
    // Calculate combined scores
    for (const id of allIds) {
      // Try to get chunk from cache
      let chunk = this.chunksCache.get(id);
      
      // If not in cache, try to reconstruct from vector result metadata
      if (!chunk && vectorMap.has(id)) {
        const vResult = vectorMap.get(id)!;
        if (vResult.metadata?.text) {
          chunk = {
            id: id,
            content: vResult.metadata.text,
            metadata: {
              id: id,
              text: vResult.metadata.text,
              section_path: vResult.metadata.section_path?.split(' > ') || [],
              section_hierarchy: vResult.metadata.section_hierarchy || '',
              page_idx: vResult.metadata.page_idx || 0,
              chunk_type: vResult.metadata.chunk_type || 'text',
              chunk_size: vResult.metadata.chunk_size || 0,
              timestamp: vResult.metadata.timestamp || new Date().toISOString()
            }
          } as Chunk;
        }
      }
      
      if (!chunk) continue;
      
      const vectorResult = vectorMap.get(id);
      const keywordResult = keywordMap.get(id);
      
      const vectorScore = vectorResult?.score || 0;
      const keywordScore = keywordResult?.score || 0;
      
      // Combine scores
      const combinedScore = combineScores(keywordScore, vectorScore, 1 - vectorWeight);
      
      // Update or add result
      const existing = mergedResults.get(id);
      if (!existing || combinedScore > existing.score) {
        mergedResults.set(id, {
          chunk,
          score: combinedScore,
          vectorScore,
          keywordScore: keywordScore || 0,
          metadata: vectorResult?.metadata || {}
        });
      }
    }
  }
  
  /**
   * Load all chunks from the file system
   */
  private async loadAllChunks(): Promise<Chunk[]> {
    const { readFile } = await import('fs/promises');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const chunksPath = join(__dirname, '../../output/text_chunks.jsonl');
    
    const content = await readFile(chunksPath, 'utf-8');
    const chunks: Chunk[] = content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
    
    return chunks;
  }
  
  /**
   * Apply financial-specific boosting to results
   */
  public applyFinancialBoosting(
    results: HybridSearchResult[],
    query: string
  ): HybridSearchResult[] {
    const lowerQuery = query.toLowerCase();
    
    return results.map(result => {
      let boostFactor = 1.0;
      const chunkText = result.chunk.content.toLowerCase();
      const sectionPath = result.chunk.metadata.section_hierarchy?.toLowerCase() || '';
      
      // Boost based on query type
      if (lowerQuery.includes('revenue') || lowerQuery.includes('income')) {
        if (chunkText.includes('$') && chunkText.includes('million')) {
          boostFactor *= 1.5;
        }
        if (sectionPath.includes('financial') || sectionPath.includes('results')) {
          boostFactor *= 1.3;
        }
      }
      
      if (lowerQuery.includes('ownership')) {
        if (chunkText.includes('%') && chunkText.includes('shares')) {
          boostFactor *= 1.5;
        }
        if (sectionPath.includes('stockholder') || sectionPath.includes('ownership')) {
          boostFactor *= 1.3;
        }
      }
      
      // Apply boost
      return {
        ...result,
        score: result.score * boostFactor
      };
    });
  }
}

// Singleton instance
let hybridSearcher: HybridSearcher | null = null;

/**
 * Get or create hybrid searcher instance
 */
export async function getHybridSearcher(): Promise<HybridSearcher> {
  if (!hybridSearcher) {
    hybridSearcher = new HybridSearcher(process.env.POSTGRES_CONNECTION_STRING!);
    await hybridSearcher.initialize();
  }
  return hybridSearcher;
}