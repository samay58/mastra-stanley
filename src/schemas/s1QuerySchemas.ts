import { z } from 'zod';

// Citation schema for structured references
export const CitationSchema = z.object({
  section: z.string().describe('Section name from the S-1 document'),
  page: z.number().describe('Page number in the document'),
  quote: z.string().describe('Exact quote or paraphrased content'),
  table_number: z.number().optional().describe('Table number if referencing a table')
});

// Base response schema with structured citations
export const BaseS1ResponseSchema = z.object({
  direct_answer: z.string().describe('Clear, direct response to the question'),
  supporting_evidence: z.array(CitationSchema).describe('Supporting evidence with citations'),
  analysis: z.string().describe('Expert interpretation and analysis'),
  confidence_level: z.enum(['High', 'Medium', 'Low']).describe('Confidence level based on evidence quality'),
  limitations: z.string().optional().describe('Any limitations or gaps in available information')
});

// Ownership-specific response schema
export const OwnershipQuerySchema = z.object({
  direct_answer: z.string().describe('Clear statement about ownership percentage or structure'),
  ownership_details: z.object({
    percentage: z.string().optional().describe('Ownership percentage if available'),
    share_class: z.string().optional().describe('Type of shares (Class A, Class B, etc.)'),
    voting_power: z.string().optional().describe('Voting power percentage'),
    conditions: z.string().optional().describe('Any conditions or restrictions on ownership')
  }),
  supporting_evidence: z.array(CitationSchema).describe('Supporting evidence with citations'),
  analysis: z.string().describe('Expert interpretation of ownership structure'),
  confidence_level: z.enum(['High', 'Medium', 'Low']).describe('Confidence level based on evidence quality')
});

// Financial data response schema
export const FinancialQuerySchema = z.object({
  direct_answer: z.string().describe('Clear statement about the financial metric'),
  financial_data: z.object({
    amount: z.string().optional().describe('Financial amount or metric'),
    currency: z.string().optional().describe('Currency (typically USD)'),
    period: z.string().optional().describe('Time period for the data'),
    table_reference: z.string().optional().describe('Reference to specific table containing the data')
  }),
  supporting_evidence: z.array(CitationSchema).describe('Supporting evidence with citations'),
  analysis: z.string().describe('Expert interpretation of the financial data'),
  confidence_level: z.enum(['High', 'Medium', 'Low']).describe('Confidence level based on evidence quality')
});

// Risk analysis response schema
export const RiskQuerySchema = z.object({
  direct_answer: z.string().describe('Clear statement about the identified risks'),
  risk_factors: z.array(z.object({
    risk_category: z.string().describe('Category of risk (operational, financial, regulatory, etc.)'),
    description: z.string().describe('Description of the risk factor'),
    severity: z.enum(['High', 'Medium', 'Low']).optional().describe('Assessed severity of the risk')
  })),
  supporting_evidence: z.array(CitationSchema).describe('Supporting evidence with citations'),
  analysis: z.string().describe('Expert interpretation of risk factors'),
  confidence_level: z.enum(['High', 'Medium', 'Low']).describe('Confidence level based on evidence quality')
});

// Business operations response schema
export const BusinessQuerySchema = z.object({
  direct_answer: z.string().describe('Clear statement about the business aspect'),
  business_details: z.object({
    category: z.string().optional().describe('Business category or aspect'),
    key_points: z.array(z.string()).optional().describe('Key points about the business aspect'),
    metrics: z.string().optional().describe('Relevant business metrics if available')
  }),
  supporting_evidence: z.array(CitationSchema).describe('Supporting evidence with citations'),
  analysis: z.string().describe('Expert interpretation of business information'),
  confidence_level: z.enum(['High', 'Medium', 'Low']).describe('Confidence level based on evidence quality')
});

// Export all schemas for use in agents
export const S1QuerySchemas = {
  base: BaseS1ResponseSchema,
  ownership: OwnershipQuerySchema,
  financial: FinancialQuerySchema,
  risk: RiskQuerySchema,
  business: BusinessQuerySchema
};

// Helper function to determine which schema to use based on query
export function getSchemaForQuery(query: string): z.ZodType<any> {
  const lowerQuery = query.toLowerCase();
  
  if (lowerQuery.includes('ownership') || lowerQuery.includes('shares') || lowerQuery.includes('equity') || lowerQuery.includes('voting')) {
    return OwnershipQuerySchema;
  }
  
  if (lowerQuery.includes('revenue') || lowerQuery.includes('income') || lowerQuery.includes('financial') || lowerQuery.includes('earnings') || lowerQuery.includes('loss')) {
    return FinancialQuerySchema;
  }
  
  if (lowerQuery.includes('risk') || lowerQuery.includes('factor') || lowerQuery.includes('threat') || lowerQuery.includes('challenge')) {
    return RiskQuerySchema;
  }
  
  if (lowerQuery.includes('business') || lowerQuery.includes('operations') || lowerQuery.includes('model') || lowerQuery.includes('strategy')) {
    return BusinessQuerySchema;
  }
  
  return BaseS1ResponseSchema;
}