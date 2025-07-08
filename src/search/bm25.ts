import { Chunk } from '../types/index.js';

interface BM25Params {
  k1: number; // Term frequency saturation parameter (typically 1.2)
  b: number;  // Length normalization parameter (typically 0.75)
}

interface DocumentStats {
  docLength: number;
  termFrequencies: Map<string, number>;
}

export class BM25Scorer {
  private params: BM25Params;
  private avgDocLength: number = 0;
  private docCount: number = 0;
  private documentFrequencies: Map<string, number> = new Map();
  private documentStats: Map<string, DocumentStats> = new Map();
  
  constructor(params: BM25Params = { k1: 1.2, b: 0.75 }) {
    this.params = params;
  }
  
  /**
   * Build BM25 index from chunks
   */
  buildIndex(chunks: Chunk[]): void {
    // Reset index
    this.documentFrequencies.clear();
    this.documentStats.clear();
    this.docCount = chunks.length;
    
    let totalLength = 0;
    
    // Process each document
    for (const chunk of chunks) {
      const tokens = this.tokenize(chunk.content);
      const docLength = tokens.length;
      totalLength += docLength;
      
      // Calculate term frequencies for this document
      const termFreqs = new Map<string, number>();
      const uniqueTerms = new Set<string>();
      
      for (const token of tokens) {
        termFreqs.set(token, (termFreqs.get(token) || 0) + 1);
        uniqueTerms.add(token);
      }
      
      // Update document frequencies
      for (const term of uniqueTerms) {
        this.documentFrequencies.set(
          term, 
          (this.documentFrequencies.get(term) || 0) + 1
        );
      }
      
      // Store document stats
      this.documentStats.set(chunk.id, {
        docLength,
        termFrequencies: termFreqs
      });
    }
    
    // Calculate average document length
    this.avgDocLength = totalLength / this.docCount;
  }
  
  /**
   * Score a single document against a query
   */
  scoreDocument(query: string, chunkId: string): number {
    const queryTerms = this.tokenize(query.toLowerCase());
    const docStats = this.documentStats.get(chunkId);
    
    if (!docStats) return 0;
    
    let score = 0;
    
    for (const term of queryTerms) {
      const termFreq = docStats.termFrequencies.get(term) || 0;
      if (termFreq === 0) continue;
      
      // IDF calculation: log((N - df + 0.5) / (df + 0.5))
      const df = this.documentFrequencies.get(term) || 0;
      const idf = Math.log((this.docCount - df + 0.5) / (df + 0.5));
      
      // BM25 formula
      const { k1, b } = this.params;
      const docLengthNorm = 1 - b + b * (docStats.docLength / this.avgDocLength);
      const tfComponent = (termFreq * (k1 + 1)) / (termFreq + k1 * docLengthNorm);
      
      score += idf * tfComponent;
    }
    
    return score;
  }
  
  /**
   * Search chunks using BM25 scoring
   */
  search(query: string, chunks: Chunk[], topK: number = 10): Array<{ chunk: Chunk; score: number }> {
    const scores = chunks.map(chunk => ({
      chunk,
      score: this.scoreDocument(query, chunk.id)
    }));
    
    // Sort by score descending and return top K
    return scores
      .sort((a, b) => b.score - a.score)
      .filter(result => result.score > 0)
      .slice(0, topK);
  }
  
  /**
   * Get term importance for query expansion
   */
  getTermImportance(term: string): number {
    const df = this.documentFrequencies.get(term.toLowerCase()) || 0;
    if (df === 0) return 0;
    
    // IDF as importance measure
    return Math.log((this.docCount - df + 0.5) / (df + 0.5));
  }
  
  /**
   * Simple tokenization - can be enhanced with better NLP
   */
  private tokenize(text: string): string[] {
    // Convert to lowercase and split on word boundaries
    return text
      .toLowerCase()
      .replace(/[^\w\s\$\%]/g, ' ') // Keep $ and % for financial data
      .split(/\s+/)
      .filter(token => token.length > 2); // Filter short tokens
  }
  
  /**
   * Enhanced tokenization for financial documents
   */
  tokenizeFinancial(text: string): string[] {
    const tokens = this.tokenize(text);
    const enhancedTokens: string[] = [];
    
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      enhancedTokens.push(token);
      
      // Detect financial patterns
      if (token.startsWith('$') && i + 1 < tokens.length) {
        // Combine currency amounts: $749 million -> $749million
        const nextToken = tokens[i + 1];
        if (nextToken === 'million' || nextToken === 'billion') {
          enhancedTokens.push(`${token}${nextToken}`);
        }
      }
      
      // Detect percentage patterns
      if (token.endsWith('%') || (i + 1 < tokens.length && tokens[i + 1] === '%')) {
        // Add percentage as compound token
        if (!token.endsWith('%')) {
          enhancedTokens.push(`${token}%`);
        }
      }
      
      // Detect year patterns
      if (/^\d{4}$/.test(token)) {
        enhancedTokens.push(`year${token}`);
      }
    }
    
    return enhancedTokens;
  }
}

/**
 * Create BM25 search tool for S-1 documents
 */
export async function createBM25Index(chunks: Chunk[]): Promise<BM25Scorer> {
  const scorer = new BM25Scorer({
    k1: 1.5, // Slightly higher for technical documents
    b: 0.75  // Standard length normalization
  });
  
  scorer.buildIndex(chunks);
  return scorer;
}

/**
 * Combine BM25 scores with vector similarity scores
 */
export function combineScores(
  bm25Score: number,
  vectorScore: number,
  bm25Weight: number = 0.3
): number {
  // Normalize BM25 score (typically 0-10 range) to 0-1
  const normalizedBM25 = Math.min(bm25Score / 10, 1);
  
  // Weighted combination
  return (normalizedBM25 * bm25Weight) + (vectorScore * (1 - bm25Weight));
}