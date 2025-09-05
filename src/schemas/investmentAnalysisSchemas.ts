import { z } from 'zod';

/**
 * Investment Research Suite - Structured Output Schemas
 * 
 * These schemas define the structured output format for each specialized agent
 * in the investment research workflow, ensuring type safety and consistent
 * professional report generation.
 */

// Common schemas used across multiple analysis sections
const ConfidenceLevelSchema = z.enum(['High', 'Medium', 'Low']).describe('Confidence level of the analysis');

const CitationSchema = z.object({
  section: z.string().describe('S-1 section where information was found'),
  page: z.number().optional().describe('Page number in the S-1 document'),
  quote: z.string().describe('Direct quote from the document'),
  table_number: z.number().optional().describe('Table number if referencing a table')
}).describe('Citation with specific document reference');

const KeyMetricSchema = z.object({
  name: z.string().describe('Name of the metric'),
  value: z.string().describe('Value of the metric with units'),
  period: z.string().describe('Time period for the metric'),
  trend: z.enum(['Improving', 'Declining', 'Stable', 'Unknown']).describe('Trend direction')
}).describe('Key financial or business metric');

// Executive Summary Schema
export const ExecutiveSummarySchema = z.object({
  investment_recommendation: z.enum(['Strong Buy', 'Buy', 'Hold', 'Sell', 'Strong Sell']).describe('Overall investment recommendation'),
  price_target: z.object({
    target_price: z.string().describe('12-month price target'),
    current_valuation: z.string().describe('Current valuation estimate'),
    upside_potential: z.string().describe('Upside potential percentage')
  }).describe('Price target and valuation summary'),
  
  key_investment_highlights: z.array(z.object({
    title: z.string().describe('Highlight title'),
    description: z.string().describe('Brief description of the highlight'),
    impact: z.enum(['Positive', 'Negative', 'Neutral']).describe('Impact on investment thesis')
  })).max(5).describe('Top 3-5 investment highlights'),
  
  financial_snapshot: z.object({
    revenue_current: z.string().describe('Most recent annual revenue'),
    revenue_growth: z.string().describe('Revenue growth rate'),
    profitability: z.string().describe('Profitability status (profitable/path to profitability)'),
    cash_position: z.string().describe('Cash and cash equivalents'),
    market_opportunity: z.string().describe('Total addressable market size')
  }).describe('Key financial metrics summary'),
  
  top_risks: z.array(z.object({
    risk: z.string().describe('Risk description'),
    impact: z.enum(['High', 'Medium', 'Low']).describe('Potential impact level'),
    mitigation: z.string().describe('Mitigation factors or management response')
  })).max(3).describe('Top 3 risks to investment thesis'),
  
  catalysts: z.array(z.object({
    catalyst: z.string().describe('Potential catalyst description'),
    timeline: z.string().describe('Expected timeline for catalyst'),
    impact: z.enum(['High', 'Medium', 'Low']).describe('Potential positive impact')
  })).max(3).describe('Top 3 potential catalysts'),
  
  confidence_level: ConfidenceLevelSchema,
  supporting_evidence: z.array(CitationSchema).describe('Key citations supporting the executive summary')
}).describe('Executive summary with investment recommendation and key findings');

// Financial Analysis Schema
export const FinancialAnalysisSchema = z.object({
  revenue_analysis: z.object({
    historical_performance: z.array(z.object({
      period: z.string().describe('Time period (e.g., "2024", "Q1 2025")'),
      revenue: z.string().describe('Revenue amount'),
      growth_rate: z.string().describe('Year-over-year growth rate'),
      key_drivers: z.array(z.string()).describe('Key revenue growth drivers')
    })).describe('Historical revenue performance'),
    
    revenue_model: z.object({
      primary_model: z.string().describe('Primary revenue model (subscription, transaction, etc.)'),
      revenue_streams: z.array(z.object({
        stream: z.string().describe('Revenue stream name'),
        contribution: z.string().describe('Percentage contribution to total revenue'),
        growth_trajectory: z.enum(['Accelerating', 'Stable', 'Decelerating']).describe('Growth trajectory')
      })).describe('Breakdown of revenue streams'),
      pricing_strategy: z.string().describe('Pricing strategy and model')
    }).describe('Revenue model breakdown'),
    
    sustainability: z.object({
      growth_drivers: z.array(z.string()).describe('Factors driving revenue growth'),
      headwinds: z.array(z.string()).describe('Potential challenges to growth'),
      outlook: z.string().describe('Revenue growth outlook and projections')
    }).describe('Revenue sustainability analysis')
  }).describe('Comprehensive revenue analysis'),
  
  profitability_analysis: z.object({
    gross_margins: z.object({
      current: z.string().describe('Current gross margin percentage'),
      trend: z.enum(['Improving', 'Declining', 'Stable']).describe('Margin trend'),
      drivers: z.array(z.string()).describe('Key margin drivers')
    }).describe('Gross margin analysis'),
    
    operating_metrics: z.object({
      operating_margin: z.string().describe('Operating margin percentage'),
      ebitda_margin: z.string().describe('EBITDA margin if available'),
      path_to_profitability: z.string().describe('Timeline and strategy for profitability')
    }).describe('Operating profitability metrics'),
    
    efficiency_metrics: z.array(KeyMetricSchema).describe('Key efficiency and profitability metrics')
  }).describe('Profitability and margin analysis'),
  
  cash_flow_analysis: z.object({
    operating_cash_flow: z.string().describe('Operating cash flow'),
    free_cash_flow: z.string().describe('Free cash flow'),
    cash_generation: z.string().describe('Cash generation capability and trends'),
    capital_requirements: z.string().describe('Capital requirements and investment needs')
  }).describe('Cash flow generation analysis'),
  
  key_financial_metrics: z.array(KeyMetricSchema).describe('Additional key financial metrics'),
  confidence_level: ConfidenceLevelSchema,
  supporting_evidence: z.array(CitationSchema).describe('Citations supporting financial analysis')
}).describe('Comprehensive financial performance analysis');

// Business Strategy Schema
export const BusinessStrategySchema = z.object({
  market_opportunity: z.object({
    total_addressable_market: z.string().describe('Total addressable market size'),
    serviceable_addressable_market: z.string().describe('Serviceable addressable market'),
    market_growth_rate: z.string().describe('Market growth rate'),
    penetration: z.string().describe('Current market penetration percentage')
  }).describe('Market opportunity and sizing'),
  
  competitive_positioning: z.object({
    market_position: z.string().describe('Current market position and ranking'),
    key_competitors: z.array(z.object({
      competitor: z.string().describe('Competitor name'),
      market_share: z.string().optional().describe('Estimated market share'),
      competitive_advantage: z.string().describe('Key differentiation vs this competitor')
    })).describe('Key competitors and positioning'),
    
    competitive_moats: z.array(z.object({
      moat: z.string().describe('Competitive advantage/moat'),
      strength: z.enum(['Strong', 'Moderate', 'Weak']).describe('Strength of the moat'),
      sustainability: z.string().describe('Sustainability of the advantage')
    })).describe('Competitive moats and barriers to entry')
  }).describe('Competitive landscape analysis'),
  
  business_model: z.object({
    value_proposition: z.string().describe('Core value proposition'),
    customer_segments: z.array(z.object({
      segment: z.string().describe('Customer segment'),
      size: z.string().describe('Segment size or contribution'),
      growth_potential: z.enum(['High', 'Medium', 'Low']).describe('Growth potential')
    })).describe('Key customer segments'),
    
    distribution_strategy: z.string().describe('Go-to-market and distribution strategy'),
    scalability: z.string().describe('Business model scalability and unit economics')
  }).describe('Business model analysis'),
  
  growth_strategy: z.object({
    organic_growth: z.array(z.string()).describe('Organic growth initiatives'),
    expansion_opportunities: z.array(z.string()).describe('Market expansion opportunities'),
    strategic_initiatives: z.array(z.string()).describe('Key strategic initiatives')
  }).describe('Growth strategy and expansion plans'),
  
  customer_analysis: z.object({
    customer_base: z.string().describe('Customer base size and composition'),
    retention_metrics: z.string().describe('Customer retention and churn metrics'),
    customer_satisfaction: z.string().describe('Customer satisfaction and NPS metrics'),
    customer_concentration: z.string().describe('Customer concentration risk')
  }).describe('Customer base analysis'),
  
  confidence_level: ConfidenceLevelSchema,
  supporting_evidence: z.array(CitationSchema).describe('Citations supporting business strategy analysis')
}).describe('Business strategy and market positioning analysis');

// Risk Assessment Schema
export const RiskAssessmentSchema = z.object({
  risk_categories: z.object({
    market_risks: z.array(z.object({
      risk: z.string().describe('Market risk description'),
      probability: z.enum(['High', 'Medium', 'Low']).describe('Probability of occurrence'),
      impact: z.enum(['High', 'Medium', 'Low']).describe('Potential impact if occurs'),
      mitigation: z.string().describe('Mitigation strategies')
    })).describe('Market and industry risks'),
    
    operational_risks: z.array(z.object({
      risk: z.string().describe('Operational risk description'),
      probability: z.enum(['High', 'Medium', 'Low']).describe('Probability of occurrence'),
      impact: z.enum(['High', 'Medium', 'Low']).describe('Potential impact if occurs'),
      mitigation: z.string().describe('Mitigation strategies')
    })).describe('Operational and execution risks'),
    
    financial_risks: z.array(z.object({
      risk: z.string().describe('Financial risk description'),
      probability: z.enum(['High', 'Medium', 'Low']).describe('Probability of occurrence'),
      impact: z.enum(['High', 'Medium', 'Low']).describe('Potential impact if occurs'),
      mitigation: z.string().describe('Mitigation strategies')
    })).describe('Financial and liquidity risks'),
    
    regulatory_risks: z.array(z.object({
      risk: z.string().describe('Regulatory risk description'),
      probability: z.enum(['High', 'Medium', 'Low']).describe('Probability of occurrence'),
      impact: z.enum(['High', 'Medium', 'Low']).describe('Potential impact if occurs'),
      mitigation: z.string().describe('Mitigation strategies')
    })).describe('Regulatory and compliance risks')
  }).describe('Systematic risk categorization'),
  
  risk_matrix: z.object({
    high_impact_high_probability: z.array(z.string()).describe('Critical risks requiring immediate attention'),
    high_impact_medium_probability: z.array(z.string()).describe('Important risks to monitor'),
    medium_impact_high_probability: z.array(z.string()).describe('Operational risks to manage'),
    overall_risk_profile: z.enum(['Conservative', 'Moderate', 'Aggressive', 'High Risk']).describe('Overall investment risk profile')
  }).optional().describe('Risk prioritization matrix'),
  
  scenario_analysis: z.object({
    base_case: z.object({
      scenario: z.string().describe('Base case scenario description'),
      probability: z.string().describe('Probability of base case'),
      key_assumptions: z.array(z.string()).describe('Key assumptions for base case')
    }).describe('Base case scenario'),
    
    bull_case: z.object({
      scenario: z.string().describe('Bull case scenario description'),
      probability: z.string().describe('Probability of bull case'),
      key_drivers: z.array(z.string()).describe('Key drivers for bull case')
    }).describe('Optimistic scenario'),
    
    bear_case: z.object({
      scenario: z.string().describe('Bear case scenario description'),
      probability: z.string().describe('Probability of bear case'),
      key_risks: z.array(z.string()).describe('Key risks triggering bear case')
    }).describe('Pessimistic scenario')
  }).optional().describe('Scenario-based analysis'),
  
  confidence_level: ConfidenceLevelSchema,
  supporting_evidence: z.array(CitationSchema).describe('Citations supporting risk assessment')
}).describe('Comprehensive risk assessment and scenario analysis');

// Valuation Schema
export const ValuationSchema = z.object({
  valuation_methodologies: z.object({
    dcf_analysis: z.object({
      enterprise_value: z.string().describe('Discounted cash flow enterprise value'),
      equity_value: z.string().describe('Equity value from DCF'),
      key_assumptions: z.array(z.object({
        assumption: z.string().describe('Key assumption description'),
        value: z.string().describe('Assumed value or range'),
        sensitivity: z.string().describe('Sensitivity to changes in this assumption')
      })).describe('Key DCF assumptions'),
      discount_rate: z.string().describe('Weighted average cost of capital used')
    }).describe('Discounted cash flow analysis'),
    
    peer_comparison: z.object({
      comparable_companies: z.array(z.object({
        company: z.string().describe('Comparable company name'),
        metric: z.string().describe('Key valuation metric (EV/Revenue, P/E, etc.)'),
        multiple: z.string().describe('Trading multiple'),
        rationale: z.string().describe('Why this company is comparable')
      })).describe('Peer comparison analysis'),
      
      implied_valuation: z.string().describe('Implied valuation based on peer multiples'),
      relative_positioning: z.string().describe('Positioning vs peers (premium/discount)')
    }).describe('Peer comparison valuation'),
    
    asset_based: z.object({
      book_value: z.string().describe('Book value per share'),
      tangible_book_value: z.string().describe('Tangible book value'),
      asset_quality: z.string().describe('Quality and composition of assets')
    }).nullable().optional().describe('Asset-based valuation if applicable')
  }).describe('Multiple valuation methodologies'),
  
  price_target: z.object({
    target_price: z.string().describe('12-month price target'),
    price_range: z.object({
      low: z.string().describe('Low end of price range'),
      high: z.string().describe('High end of price range'),
      base: z.string().describe('Base case price target')
    }).describe('Price target range'),
    methodology_weights: z.array(z.object({
      method: z.string().describe('Valuation methodology'),
      weight: z.string().describe('Weight in final price target'),
      implied_value: z.string().describe('Implied value from this method')
    })).describe('Methodology weighting in price target')
  }).describe('Price target derivation'),
  
  sensitivity_analysis: z.array(z.object({
    variable: z.string().describe('Key sensitivity variable'),
    impact: z.string().describe('Impact on valuation'),
    range: z.string().describe('Range of possible outcomes')
  })).describe('Key sensitivity factors'),
  
  investment_thesis: z.object({
    bull_case_thesis: z.string().describe('Bull case investment thesis'),
    bear_case_thesis: z.string().describe('Bear case investment thesis'),
    base_case_thesis: z.string().describe('Base case investment thesis'),
    key_value_drivers: z.array(z.string()).describe('Key factors driving value creation')
  }).describe('Investment thesis summary'),
  
  confidence_level: ConfidenceLevelSchema,
  supporting_evidence: z.array(CitationSchema).describe('Citations supporting valuation analysis')
}).describe('Comprehensive valuation analysis and price target');

// Complete Investment Research Report Schema
export const InvestmentResearchReportSchema = z.object({
  report_metadata: z.object({
    company: z.string().describe('Company name'),
    ticker: z.string().optional().describe('Stock ticker symbol'),
    report_date: z.string().describe('Report generation date'),
    analyst: z.string().default('AI Investment Research Suite').describe('Analyst name'),
    report_type: z.enum(['IPO Analysis', 'Initiation', 'Update']).describe('Type of research report')
  }).describe('Report metadata and identifiers'),
  
  executive_summary: ExecutiveSummarySchema,
  financial_analysis: FinancialAnalysisSchema,
  business_strategy: BusinessStrategySchema,
  risk_assessment: RiskAssessmentSchema,
  valuation: ValuationSchema,
  
  overall_confidence: ConfidenceLevelSchema.describe('Overall confidence in the analysis'),
  report_limitations: z.array(z.string()).describe('Limitations and disclaimers for the analysis')
}).describe('Complete professional investment research report');

// Workflow step schemas for internal processing
export const WorkflowStepSchema = z.object({
  step_name: z.string().describe('Name of the workflow step'),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed']).describe('Step execution status'),
  start_time: z.string().optional().describe('Step start timestamp'),
  end_time: z.string().optional().describe('Step completion timestamp'),
  output: z.any().optional().describe('Step output data'),
  error: z.string().optional().describe('Error message if step failed')
}).describe('Individual workflow step status');

export const WorkflowProgressSchema = z.object({
  workflow_id: z.string().describe('Unique workflow execution ID'),
  overall_status: z.enum(['initializing', 'running', 'completed', 'failed']).describe('Overall workflow status'),
  progress_percentage: z.number().min(0).max(100).describe('Completion percentage'),
  current_step: z.string().describe('Currently executing step'),
  steps: z.array(WorkflowStepSchema).describe('Individual step statuses'),
  estimated_completion: z.string().optional().describe('Estimated completion time'),
  total_duration: z.string().optional().describe('Total execution time')
}).describe('Workflow execution progress tracking');