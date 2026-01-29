import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';

interface ExpandedQuery {
  original: string;
  expanded: string[];
  synonyms: string[];
  documentPatterns: string[];
  contextEnhanced: string;
}

// Financial term synonyms mapping
const FINANCIAL_SYNONYMS: Record<string, string[]> = {
  revenue: ['income', 'sales', 'earnings', 'turnover', 'receipts', 'proceeds'],
  profit: ['earnings', 'income', 'gain', 'surplus', 'net income', 'bottom line'],
  growth: ['increase', 'expansion', 'rise', 'improvement', 'gain', 'year-over-year', 'yoy'],
  ownership: ['shares', 'equity', 'stake', 'holdings', 'stock', 'percentage'],
  expenses: ['costs', 'expenditures', 'spending', 'outlays', 'charges'],
  margin: ['profit margin', 'gross margin', 'operating margin', 'markup'],
  assets: ['resources', 'holdings', 'property', 'capital'],
  liabilities: ['debt', 'obligations', 'payables', 'amounts owed'],
  cash: ['cash flow', 'liquidity', 'funds', 'money', 'capital'],
  risk: ['risks', 'risk factors', 'threats', 'challenges', 'uncertainties']
};

// Common financial query patterns found in S-1 documents
const DOCUMENT_PATTERNS: Record<string, string[]> = {
  revenue: [
    'Our revenue was',
    'revenue for the year ended',
    'total revenue',
    'revenue increased',
    'revenue decreased',
    'revenue of $'
  ],
  growth: [
    'year-over-year growth',
    'growth rate',
    'representing % growth',
    'increased by %',
    'grew by %'
  ],
  ownership: [
    'owns shares',
    'ownership percentage',
    'voting power',
    'beneficial ownership',
    'shares outstanding'
  ],
  financial: [
    'for the year ended December 31',
    'for the three months ended',
    'fiscal year',
    'financial results',
    'financial performance'
  ]
};

export class QueryExpander {
  /**
   * Expand a query with synonyms and related terms
   */
  async expandQuery(query: string): Promise<ExpandedQuery> {
    const lowerQuery = query.toLowerCase();
    
    // Extract synonyms for detected financial terms
    const synonyms = this.extractSynonyms(lowerQuery);
    
    // Generate document-like patterns
    const documentPatterns = this.generateDocumentPatterns(lowerQuery);
    
    // Create context-enhanced version
    const contextEnhanced = this.enhanceWithContext(query);
    
    // Generate expanded queries
    const expanded = this.generateExpandedQueries(query, synonyms, documentPatterns);
    
    return {
      original: query,
      expanded,
      synonyms,
      documentPatterns,
      contextEnhanced
    };
  }
  
  /**
   * Extract relevant synonyms based on query terms
   */
  private extractSynonyms(query: string): string[] {
    const synonyms = new Set<string>();
    
    // Check each financial term category
    for (const [term, termSynonyms] of Object.entries(FINANCIAL_SYNONYMS)) {
      if (query.includes(term)) {
        termSynonyms.forEach(syn => synonyms.add(syn));
      }
      
      // Also check if any synonym is in the query
      for (const synonym of termSynonyms) {
        if (query.includes(synonym)) {
          synonyms.add(term);
          termSynonyms.forEach(syn => synonyms.add(syn));
          break;
        }
      }
    }
    
    return Array.from(synonyms);
  }
  
  /**
   * Generate document-like patterns that might match S-1 content
   */
  private generateDocumentPatterns(query: string): string[] {
    const patterns = new Set<string>();
    
    // Check for pattern categories
    for (const [category, categoryPatterns] of Object.entries(DOCUMENT_PATTERNS)) {
      if (query.includes(category) || 
          FINANCIAL_SYNONYMS[category]?.some(syn => query.includes(syn))) {
        categoryPatterns.forEach(pattern => patterns.add(pattern));
      }
    }
    
    // Add specific patterns based on query intent
    if (query.includes('revenue') || query.includes('income')) {
      patterns.add('$[0-9]+ million');
      patterns.add('$[0-9]+.[0-9]+ million');
    }
    
    if (query.includes('growth') || query.includes('increase')) {
      patterns.add('[0-9]+% growth');
      patterns.add('[0-9]+% year-over-year');
    }
    
    return Array.from(patterns);
  }
  
  /**
   * Enhance query with S-1 document context
   */
  private enhanceWithContext(query: string): string {
    // Add S-1 filing context
    const contextPrefixes = [
      'In the S-1 filing,',
      'According to the S-1 document,',
      'The S-1 registration statement shows'
    ];
    
    // Add year context for financial queries
    const currentYear = new Date().getFullYear();
    const yearContext = query.match(/\d{4}/) ? '' : ` for ${currentYear - 1} or ${currentYear}`;
    
    // Randomly select a context prefix
    const prefix = contextPrefixes[Math.floor(Math.random() * contextPrefixes.length)];
    
    return `${prefix} ${query}${yearContext}`;
  }
  
  /**
   * Generate multiple expanded query variations
   */
  private generateExpandedQueries(
    original: string, 
    synonyms: string[], 
    patterns: string[]
  ): string[] {
    const expanded = new Set<string>();
    
    // Add original query
    expanded.add(original);
    
    // Create synonym variations
    for (const synonym of synonyms.slice(0, 3)) { // Limit to top 3 synonyms
      const variation = original.toLowerCase().replace(
        /revenue|income|earnings|profit|growth|ownership/gi,
        synonym
      );
      if (variation !== original.toLowerCase()) {
        expanded.add(variation);
      }
    }
    
    // Add pattern-based queries
    if (patterns.length > 0) {
      expanded.add(`${original} ${patterns[0]}`);
    }
    
    // Add question variations
    if (original.includes('?')) {
      // Convert question to statement pattern
      const statement = original
        .replace('What is', '')
        .replace('What was', '')
        .replace('How much', '')
        .replace('?', '')
        .trim();
      expanded.add(statement);
      const company = process.env.S1_COMPANY_NAME?.trim();
      if (company) {
        expanded.add(`${company} ${statement}`);
      }
    }
    
    return Array.from(expanded);
  }
  
  /**
   * Generate a hypothetical document answer for HyDE
   */
  async generateHypotheticalAnswer(query: string): Promise<string> {
    try {
      const company = process.env.S1_COMPANY_NAME?.trim() || 'the company';
      const { text } = await generateText({
        model: openai('gpt-4o-mini'),
        prompt: `Given this query about ${company}'s S-1 filing: "${query}"
        
Generate a hypothetical answer that would appear in an S-1 document. 
Use typical S-1 language and structure. Include specific placeholder numbers where appropriate.
Keep it under 100 words and use formal financial document language.

Example format: "Our revenue was $XXX million for the year ended December 31, 20XX, representing XX% year-over-year growth."`,
        temperature: 0.3,
        maxTokens: 150
      });
      
      return text;
    } catch (error) {
      console.error('Error generating hypothetical answer:', error);
      // Fallback to pattern-based generation
      return this.generateFallbackHypothetical(query);
    }
  }
  
  /**
   * Fallback hypothetical answer generation
   */
  private generateFallbackHypothetical(query: string): string {
    const lowerQuery = query.toLowerCase();
    
    if (lowerQuery.includes('revenue') || lowerQuery.includes('income')) {
      return 'Our revenue was $XXX million for the year ended December 31, 2024, representing XX% year-over-year growth compared to the year ended December 31, 2023.';
    }
    
    if (lowerQuery.includes('growth')) {
      return 'We achieved a year-over-year growth rate of XX%, with revenue increasing from $XXX million to $XXX million.';
    }
    
    if (lowerQuery.includes('ownership')) {
      return 'The beneficial ownership includes XX% of outstanding shares, representing XX% of total voting power.';
    }
    
    // Default pattern
    return 'According to our financial results, we reported $XXX million in the relevant period.';
  }
}

// Export singleton instance
export const queryExpander = new QueryExpander();
