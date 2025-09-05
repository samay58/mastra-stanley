import { z } from 'zod';

/**
 * Response Parser Utility
 * 
 * Robust parser for extracting structured data from agent responses.
 * Handles both structured JSON responses and natural language formats.
 * Includes validation and fallback mechanisms.
 */

interface ParserOptions {
  throwOnError?: boolean;
  validateFields?: boolean;
  removeEmptyFields?: boolean;
}

/**
 * Attempts to extract JSON from a text response
 * Handles various formats including markdown code blocks
 */
function extractJSON(text: string): any | null {
  if (!text) return null;
  
  // Try direct JSON parse first
  try {
    return JSON.parse(text);
  } catch {
    // Continue to other extraction methods
  }
  
  // Try to extract from markdown code blocks
  const jsonBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonBlockMatch) {
    try {
      return JSON.parse(jsonBlockMatch[1].trim());
    } catch {
      // Continue to other methods
    }
  }
  
  // Try to find JSON-like structure in the text
  const jsonLikeMatch = text.match(/\{[\s\S]*\}/);
  if (jsonLikeMatch) {
    try {
      return JSON.parse(jsonLikeMatch[0]);
    } catch {
      // Continue to other methods
    }
  }
  
  return null;
}

/**
 * Validates that a value is not a placeholder
 */
function isPlaceholder(value: any): boolean {
  if (typeof value !== 'string') return false;
  
  const placeholderPatterns = [
    /from agent/i,
    /agent analysis/i,
    /placeholder/i,
    /todo/i,
    /tbd/i,
    /\[.*\]/,  // Brackets like [VALUE]
    /^Driver \d+$/,  // Generic "Driver 1", "Driver 2"
    /^Risk \d+$/,    // Generic "Risk 1", "Risk 2"
  ];
  
  return placeholderPatterns.some(pattern => pattern.test(value));
}

/**
 * Recursively removes placeholder values from an object
 */
function removePlaceholders(obj: any): any {
  if (Array.isArray(obj)) {
    return obj
      .filter(item => !isPlaceholder(item))
      .map(item => removePlaceholders(item));
  }
  
  if (obj && typeof obj === 'object') {
    const cleaned: any = {};
    for (const [key, value] of Object.entries(obj)) {
      const cleanedValue = removePlaceholders(value);
      if (cleanedValue !== null && cleanedValue !== undefined) {
        // Skip empty arrays and objects
        if (Array.isArray(cleanedValue) && cleanedValue.length === 0) continue;
        if (typeof cleanedValue === 'object' && Object.keys(cleanedValue).length === 0) continue;
        cleaned[key] = cleanedValue;
      }
    }
    return cleaned;
  }
  
  return isPlaceholder(obj) ? null : obj;
}

/**
 * Preprocesses object to convert null values to undefined for optional fields
 * This helps with Zod schema validation where .optional() expects undefined, not null
 */
function preprocessNullToUndefined(obj: any): any {
  if (obj === null) return undefined;
  
  if (Array.isArray(obj)) {
    return obj.map(item => preprocessNullToUndefined(item));
  }
  
  if (obj && typeof obj === 'object') {
    const processed: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value === null) {
        // Don't include null values - let them be undefined
        continue;
      }
      processed[key] = preprocessNullToUndefined(value);
    }
    return processed;
  }
  
  return obj;
}

/**
 * Extracts specific fields from natural language text using patterns
 */
function extractFieldsFromText(text: string, fieldPatterns: Record<string, RegExp>): Record<string, any> {
  const extracted: Record<string, any> = {};
  
  for (const [field, pattern] of Object.entries(fieldPatterns)) {
    const match = text.match(pattern);
    if (match) {
      extracted[field] = match[1]?.trim();
    }
  }
  
  return extracted;
}

/**
 * Main parser function for agent responses
 */
export async function parseAgentResponse<T>(
  response: any,
  schema: z.ZodSchema<T>,
  options: ParserOptions = {}
): Promise<T | null> {
  const { throwOnError = false, validateFields = true, removeEmptyFields = true } = options;
  
  try {
    let parsed: any = null;
    
    // If response has structured output, use it directly
    if (response?.object) {
      parsed = response.object;
    } 
    // If response is already an object (structured response)
    else if (typeof response === 'object' && !response.text) {
      parsed = response;
    }
    // If response has text field, try to extract JSON
    else if (response?.text) {
      parsed = extractJSON(response.text);
      
      // If no JSON found, try to extract fields from natural language
      if (!parsed && schema) {
        // This would need to be customized per schema
        // For now, we'll return null and let the caller handle it
        if (throwOnError) {
          throw new Error('Could not extract structured data from text response');
        }
        return null;
      }
    }
    // If response is a string, try to parse it
    else if (typeof response === 'string') {
      parsed = extractJSON(response);
    }
    
    if (!parsed) {
      if (throwOnError) {
        throw new Error('No parseable data found in response');
      }
      return null;
    }
    
    // Remove placeholder values if requested
    if (validateFields || removeEmptyFields) {
      parsed = removePlaceholders(parsed);
    }
    
    // Preprocess null values to undefined for better Zod compatibility
    parsed = preprocessNullToUndefined(parsed);
    
    // Validate against schema
    const validated = schema.safeParse(parsed);
    if (!validated.success) {
      if (throwOnError) {
        throw new Error(`Schema validation failed: ${validated.error.message}`);
      }
      
      // Try partial validation - return what we can
      // This is useful when agents return partial data
      return parsed as T;
    }
    
    return validated.data;
  } catch (error) {
    if (throwOnError) {
      throw error;
    }
    console.warn('Error parsing agent response:', error);
    return null;
  }
}

/**
 * Specific parser for financial data responses
 */
export function parseFinancialData(text: string): Record<string, any> {
  const patterns = {
    revenue: /(?:revenue|sales).*?\$?([\d,]+\.?\d*)\s*(?:million|billion|M|B)/i,
    growth_rate: /(?:growth|grew|increased).*?([\d.]+)%/i,
    gross_margin: /gross margin.*?([\d.]+)%/i,
    operating_margin: /operating margin.*?([\d.]+)%/i,
    cash_position: /cash.*?\$?([\d,]+\.?\d*)\s*(?:million|billion|M|B)/i,
  };
  
  return extractFieldsFromText(text, patterns);
}

/**
 * Specific parser for extracting citations from text
 */
export function extractCitations(text: string): Array<{section: string, page: number, quote: string}> {
  const citations: Array<{section: string, page: number, quote: string}> = [];
  
  // Pattern for citations like (Section Name, p. 123)
  const citationPattern = /\(([^,]+),\s*p\.?\s*(\d+)\)/g;
  
  // Pattern for quoted text
  const quotePattern = /"([^"]+)"/g;
  
  let match;
  const quotes: string[] = [];
  
  // Extract all quotes first
  while ((match = quotePattern.exec(text)) !== null) {
    quotes.push(match[1]);
  }
  
  // Extract citations and match with nearby quotes
  let citationIndex = 0;
  while ((match = citationPattern.exec(text)) !== null) {
    citations.push({
      section: match[1].trim(),
      page: parseInt(match[2]),
      quote: quotes[citationIndex] || ''
    });
    citationIndex++;
  }
  
  return citations;
}

/**
 * Validates that a response contains actual data (not placeholders)
 */
export function validateResponseQuality(data: any): {
  isValid: boolean;
  issues: string[];
  dataPoints: number;
} {
  const issues: string[] = [];
  let dataPoints = 0;
  
  function checkValue(value: any, path: string = ''): void {
    if (isPlaceholder(value)) {
      issues.push(`Placeholder found at ${path}: "${value}"`);
    } else if (typeof value === 'string' && value.trim().length > 10) {
      dataPoints++;
    } else if (typeof value === 'number') {
      dataPoints++;
    }
    
    if (Array.isArray(value)) {
      value.forEach((item, index) => checkValue(item, `${path}[${index}]`));
    } else if (value && typeof value === 'object') {
      Object.entries(value).forEach(([key, val]) => {
        checkValue(val, path ? `${path}.${key}` : key);
      });
    }
  }
  
  checkValue(data);
  
  return {
    isValid: issues.length === 0 && dataPoints > 5,
    issues,
    dataPoints
  };
}

/**
 * Completes partial responses by filling in missing required fields
 * This is especially useful for complex schemas where agents may return incomplete data
 */
export function completePartialResponse(partialData: any, schemaName: string): any {
  if (!partialData || typeof partialData !== 'object') {
    return partialData;
  }

  // Deep clone the partial data to avoid mutations
  const completed = JSON.parse(JSON.stringify(partialData));

  // Handle RiskAssessmentSchema specifically
  if (schemaName === 'RiskAssessmentSchema') {
    // Ensure risk_categories exists and has the correct structure
    if (!completed.risk_categories) {
      completed.risk_categories = {
        market_risks: [],
        operational_risks: [],
        financial_risks: [],
        regulatory_risks: []
      };
    }

    // Generate risk_matrix from risk_categories if missing
    if (!completed.risk_matrix) {
      const risks = [
        ...(completed.risk_categories.market_risks || []),
        ...(completed.risk_categories.operational_risks || []),
        ...(completed.risk_categories.financial_risks || []),
        ...(completed.risk_categories.regulatory_risks || [])
      ];

      completed.risk_matrix = {
        high_impact_high_probability: risks
          .filter(r => r.impact === 'High' && r.probability === 'High')
          .map(r => r.risk),
        high_impact_medium_probability: risks
          .filter(r => r.impact === 'High' && r.probability === 'Medium')
          .map(r => r.risk),
        medium_impact_high_probability: risks
          .filter(r => r.impact === 'Medium' && r.probability === 'High')
          .map(r => r.risk),
        overall_risk_profile: determineOverallRiskProfile(risks)
      };
    }

    // Add default scenario_analysis if missing
    if (!completed.scenario_analysis) {
      completed.scenario_analysis = {
        base_case: {
          scenario: "Moderate growth with balanced risk realization",
          probability: "60%",
          key_assumptions: ["Current market conditions persist", "Management executes on strategy"]
        },
        bull_case: {
          scenario: "Strong growth with favorable market conditions",
          probability: "20%",
          key_drivers: ["Market expansion", "Successful product launches"]
        },
        bear_case: {
          scenario: "Challenging environment with multiple risk factors",
          probability: "20%",
          key_risks: ["Economic downturn", "Increased competition"]
        }
      };
    }

    // Add default confidence_level if missing
    if (!completed.confidence_level) {
      completed.confidence_level = completed.risk_categories && 
        Object.values(completed.risk_categories).some((risks: any) => risks.length > 0) 
        ? "Medium" : "Low";
    }

    // Add empty supporting_evidence if missing
    if (!completed.supporting_evidence) {
      completed.supporting_evidence = [];
    }
  }

  return completed;
}

/**
 * Determines overall risk profile based on risk distribution
 */
function determineOverallRiskProfile(risks: any[]): string {
  const highImpactHighProb = risks.filter(r => r.impact === 'High' && r.probability === 'High').length;
  const highImpact = risks.filter(r => r.impact === 'High').length;
  
  if (highImpactHighProb >= 3) return 'High Risk';
  if (highImpactHighProb >= 1 || highImpact >= 5) return 'Aggressive';
  if (highImpact >= 2) return 'Moderate';
  return 'Conservative';
}

/**
 * Merges multiple partial responses into a complete response
 * Useful when agents provide data across multiple messages
 */
export function mergeResponses<T>(responses: Array<Partial<T>>): T {
  const merged: any = {};
  
  for (const response of responses) {
    for (const [key, value] of Object.entries(response)) {
      if (value !== null && value !== undefined && !isPlaceholder(value)) {
        if (Array.isArray(value) && Array.isArray(merged[key])) {
          // Merge arrays, removing duplicates
          merged[key] = [...new Set([...merged[key], ...value])];
        } else if (typeof value === 'object' && typeof merged[key] === 'object') {
          // Recursively merge objects
          merged[key] = mergeResponses([merged[key], value]);
        } else {
          // Overwrite with new value
          merged[key] = value;
        }
      }
    }
  }
  
  return merged as T;
}

// Export utility functions
export const ResponseParser = {
  parse: parseAgentResponse,
  extractJSON,
  parseFinancialData,
  extractCitations,
  validateQuality: validateResponseQuality,
  mergeResponses,
  isPlaceholder,
  removePlaceholders,
  completePartial: completePartialResponse
};