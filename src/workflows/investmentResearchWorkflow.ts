import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { access, readFile, readdir } from 'fs/promises';
import { getActiveFilingContext } from '../config/filing.js';
import { 
  ExecutiveSummarySchema, 
  FinancialAnalysisSchema, 
  BusinessStrategySchema, 
  RiskAssessmentSchema, 
  ValuationSchema,
  InvestmentResearchReportSchema,
} from '../schemas/investmentAnalysisSchemas.js';
import { financialAnalysisAgent } from '../agents/financialAnalysisAgent.js';
import { businessStrategyAgent } from '../agents/businessStrategyAgent.js';
import { riskAssessmentAgent } from '../agents/riskAssessmentAgent.js';
import { valuationAgent } from '../agents/valuationAgent.js';
import { executiveSummaryAgent } from '../agents/executiveSummaryAgent.js';
import { ResponseParser } from '../utils/responseParser.js';

type Citation = {
  section: string;
  quote: string;
  page?: number;
  table_number?: number;
};

type FinancialAnalysis = z.infer<typeof FinancialAnalysisSchema>;
type BusinessStrategy = z.infer<typeof BusinessStrategySchema>;
type Valuation = z.infer<typeof ValuationSchema>;
type ExecutiveSummary = z.infer<typeof ExecutiveSummarySchema>;

function agentResultText(result: unknown): string | undefined {
  const text = (result as any)?.text;
  return typeof text === 'string' ? text : undefined;
}

function citationsFromText(text: string): Citation[] {
  return ResponseParser.extractCitations(text).map(c => ({
    section: c.section,
    page: c.page,
    quote: c.quote,
    table_number: undefined,
  }));
}

function emptyFinancialAnalysis(overrides: Partial<FinancialAnalysis> = {}): FinancialAnalysis {
  return {
    revenue_analysis: {
      historical_performance: [],
      revenue_model: {
        primary_model: 'Not found in filing',
        revenue_streams: [],
        pricing_strategy: 'Not found in filing',
      },
      sustainability: {
        growth_drivers: [],
        headwinds: [],
        outlook: 'Not found in filing',
      },
    },
    profitability_analysis: {
      gross_margins: {
        current: 'Not found in filing',
        trend: 'Stable',
        drivers: [],
      },
      operating_metrics: {
        operating_margin: 'Not found in filing',
        ebitda_margin: 'Not found in filing',
        path_to_profitability: 'Not found in filing',
      },
      efficiency_metrics: [],
    },
    cash_flow_analysis: {
      operating_cash_flow: 'Not found in filing',
      free_cash_flow: 'Not found in filing',
      cash_generation: 'Not found in filing',
      capital_requirements: 'Not found in filing',
    },
    key_financial_metrics: [],
    confidence_level: 'Low',
    supporting_evidence: [],
    ...overrides,
  };
}

function emptyBusinessStrategy(overrides: Partial<BusinessStrategy> = {}): BusinessStrategy {
  return {
    market_opportunity: {
      total_addressable_market: 'Not found in filing',
      serviceable_addressable_market: 'Not found in filing',
      market_growth_rate: 'Not found in filing',
      penetration: 'Not found in filing',
    },
    competitive_positioning: {
      market_position: 'Not found in filing',
      key_competitors: [],
      competitive_moats: [],
    },
    business_model: {
      value_proposition: 'Not found in filing',
      customer_segments: [],
      distribution_strategy: 'Not found in filing',
      scalability: 'Not found in filing',
    },
    growth_strategy: {
      organic_growth: [],
      expansion_opportunities: [],
      strategic_initiatives: [],
    },
    customer_analysis: {
      customer_base: 'Not found in filing',
      retention_metrics: 'Not found in filing',
      customer_satisfaction: 'Not found in filing',
      customer_concentration: 'Not found in filing',
    },
    confidence_level: 'Low',
    supporting_evidence: [],
    ...overrides,
  };
}

function emptyValuation(overrides: Partial<Valuation> = {}): Valuation {
  return {
    valuation_methodologies: {
      dcf_analysis: {
        enterprise_value: 'Not found in filing',
        equity_value: 'Not found in filing',
        key_assumptions: [],
        discount_rate: 'Not found in filing',
      },
      peer_comparison: {
        comparable_companies: [],
        implied_valuation: 'Not found in filing',
        relative_positioning: 'Not found in filing',
      },
      asset_based: null,
    },
    price_target: {
      target_price: 'Not found in filing',
      price_range: {
        low: 'Not found in filing',
        high: 'Not found in filing',
        base: 'Not found in filing',
      },
      methodology_weights: [],
    },
    sensitivity_analysis: [],
    investment_thesis: {
      bull_case_thesis: 'Not found in filing',
      bear_case_thesis: 'Not found in filing',
      base_case_thesis: 'Not found in filing',
      key_value_drivers: [],
    },
    confidence_level: 'Low',
    supporting_evidence: [],
    ...overrides,
  };
}

function emptyExecutiveSummary(overrides: Partial<ExecutiveSummary> = {}): ExecutiveSummary {
  return {
    investment_recommendation: 'Hold',
    price_target: {
      target_price: 'Not found in filing',
      current_valuation: 'Not found in filing',
      upside_potential: 'Not found in filing',
    },
    key_investment_highlights: [],
    financial_snapshot: {
      revenue_current: 'Not found in filing',
      revenue_growth: 'Not found in filing',
      profitability: 'Not found in filing',
      cash_position: 'Not found in filing',
      market_opportunity: 'Not found in filing',
    },
    top_risks: [],
    catalysts: [],
    confidence_level: 'Low',
    supporting_evidence: [],
    ...overrides,
  };
}

/**
 * Investment Research Workflow
 * 
 * Multi-step Mastra workflow that orchestrates comprehensive S-1 analysis
 * to generate professional Goldman Sachs-style investment research reports.
 * 
 * Workflow Steps:
 * 1. Initialize Research Context
 * 2. Parallel Analysis Phase (Financial, Business, Risk)  
 * 3. Valuation Analysis (depends on previous analyses)
 * 4. Executive Summary Synthesis (depends on all analyses)
 * 5. Report Compilation and Formatting
 */

// Input schema for the entire workflow
const InvestmentResearchInputSchema = z.object({
  company_name: z.string().describe('Company name for analysis'),
  analysis_type: z.enum(['comprehensive', 'financial_focus', 'risk_focus', 'quick_overview']).default('comprehensive').describe('Type of analysis to perform'),
  request_id: z.string().optional().describe('Unique request identifier for tracking'),
  user_preferences: z.object({
    include_peer_comparison: z.boolean().default(true).describe('Include peer comparison in valuation'),
    focus_areas: z.array(z.enum(['growth', 'profitability', 'market_opportunity', 'risks', 'valuation'])).optional().describe('Specific areas to emphasize'),
    report_format: z.enum(['full_report', 'executive_summary', 'modular']).default('full_report').describe('Desired output format')
  }).optional().describe('User preferences for analysis')
}).describe('Input parameters for investment research workflow');

const ResearchContextSchema = z.object({
  document_available: z.boolean().describe('Whether S-1 document is available for analysis'),
  chunk_count: z.number().describe('Number of document chunks available'),
  table_count: z.number().describe('Number of financial tables available'),
  analysis_scope: z.array(z.string()).describe('Confirmed analysis scope based on document availability'),
});

// Step 1: Initialize Research Context
const initializeResearchStep = createStep({
  id: 'initialize_research',
  description: 'Initialize research context and validate S-1 document availability',
  inputSchema: InvestmentResearchInputSchema,
  outputSchema: z.object({
    company_name: z.string(),
    analysis_type: z.string(),
    research_context: ResearchContextSchema,
    workflow_id: z.string().describe('Unique workflow execution ID'),
    estimated_duration: z.string().describe('Estimated completion time')
  }),
  execute: async ({ inputData }) => {
    const workflowId = `research_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const filing = getActiveFilingContext();
    let documentAvailable = true;
    let chunkCount = 0;
    let tableCount = 0;

    try {
      await access(filing.chunksPath);
      const content = await readFile(filing.chunksPath, 'utf-8');
      chunkCount = content.split('\n').filter(line => line.trim().length > 0).length;
    } catch {
      documentAvailable = false;
    }

    try {
      // Prefer the manifest (includes anchors/captions) over directory scanning.
      await access(filing.tablesManifestPath);
      const tables = JSON.parse(await readFile(filing.tablesManifestPath, 'utf-8'));
      tableCount = Array.isArray(tables) ? tables.length : 0;
    } catch {
      try {
        await access(filing.tablesDir);
        const files = await readdir(filing.tablesDir);
        tableCount = files.filter(f => f.endsWith('.csv')).length;
      } catch {
        tableCount = 0;
      }
    }

    const analysisScope =
      inputData.analysis_type === 'comprehensive'
        ? ['financial_analysis', 'business_strategy', 'risk_assessment', 'valuation', 'executive_summary']
        : ['financial_analysis', 'executive_summary'];

    const researchContext = {
      document_available: documentAvailable,
      chunk_count: chunkCount,
      table_count: tableCount,
      analysis_scope: analysisScope,
    };

    return {
      company_name: inputData.company_name,
      analysis_type: inputData.analysis_type,
      research_context: researchContext,
      workflow_id: workflowId,
      estimated_duration: inputData.analysis_type === 'comprehensive' ? '18-22 minutes' : '8-12 minutes'
    };
  }
});

// Step 2a: Financial Analysis
const financialAnalysisStep = createStep({
  id: 'financial_analysis',
  description: 'Comprehensive financial performance analysis',
  inputSchema: z.object({
    company_name: z.string(),
    analysis_type: z.string(),
    research_context: ResearchContextSchema,
    workflow_id: z.string(),
    estimated_duration: z.string()
  }),
  outputSchema: z.object({
    company_name: z.string(),
    analysis_type: z.string(),
    research_context: ResearchContextSchema,
    workflow_id: z.string(),
    estimated_duration: z.string(),
    financial_analysis: FinancialAnalysisSchema,
    processing_time: z.string(),
    data_quality: z.enum(['High', 'Medium', 'Low']).optional(),
    analysis_notes: z.array(z.string()).optional()
  }),
  execute: async ({ inputData }) => {
    const startTime = Date.now();
    
    // Execute Financial Analysis Agent with enhanced prompt
    const prompt = `You are performing comprehensive financial analysis for ${inputData.company_name} based on their S-1 filing. 
    
Workflow ID: ${inputData.workflow_id}

IMPORTANT: You must search the S-1 document using your tools to find actual financial data. Do NOT provide placeholder responses.

Required Analysis:
1. Revenue Analysis:
   - Search for revenue numbers, growth rates, and trends in "Management's Discussion and Analysis" and "Selected Financial Data"
   - Find specific dollar amounts and percentages
   - Identify revenue streams and geographic breakdown

2. Profitability Metrics:
   - Search for gross margin, operating margin data
   - Find unit economics and cost structure information
   - Look for path to profitability discussion

3. Cash Flow Analysis:
   - Search "Consolidated Statements of Cash Flows" for operating and free cash flow
   - Find working capital metrics
   - Identify cash burn rate and runway

4. Key Metrics and Projections:
   - Extract key performance indicators (KPIs)
   - Find management guidance or growth projections
   - Identify financial targets

For each data point, provide:
- The specific number or metric
- The page number where it was found
- A brief quote from the source
- Your confidence level in the data

Use your enhancedS1Search and tableSearch tools extensively to find this information.

Return your analysis in a structured format that matches the FinancialAnalysisSchema.`;

    try {
      // Generate structured response
      const agentResult = await financialAnalysisAgent.generate(prompt, {
        output: FinancialAnalysisSchema,
        maxSteps: 10 // Allow multiple search steps
      });

      const rawText = agentResultText(agentResult);
      
      const processingTime = `${Date.now() - startTime}ms`;
      
      // Parse the agent's response
      const parsedAnalysis = await ResponseParser.parse(
        agentResult,
        FinancialAnalysisSchema,
        { validateFields: true, removeEmptyFields: true }
      );
      
      // Validate response quality
      const validation = ResponseParser.validateQuality(parsedAnalysis);
      
      if (!parsedAnalysis || !validation.isValid) {
        console.warn(`Financial analysis quality issues: ${validation.issues.join(', ')}`);
        console.warn(`Data points found: ${validation.dataPoints}`);
      }

      const supportingEvidence =
        parsedAnalysis?.supporting_evidence?.length
          ? parsedAnalysis.supporting_evidence
          : rawText
            ? citationsFromText(rawText)
            : [];

      const financial_analysis: FinancialAnalysis =
        parsedAnalysis && validation.isValid
          ? parsedAnalysis
          : emptyFinancialAnalysis({ supporting_evidence: supportingEvidence });

      const data_quality: 'High' | 'Medium' | 'Low' =
        validation.isValid ? "High" : validation.dataPoints > 10 ? "Medium" : "Low";

      return {
        company_name: inputData.company_name,
        analysis_type: inputData.analysis_type,
        research_context: inputData.research_context,
        workflow_id: inputData.workflow_id,
        estimated_duration: inputData.estimated_duration,
        financial_analysis,
        processing_time: processingTime,
        data_quality,
        analysis_notes:
          validation.issues.length > 0
            ? validation.issues
            : validation.isValid
              ? ["Analysis completed successfully"]
              : ["Unable to validate structured output; returned a minimal schema-compliant stub."]
      };
      
    } catch (error) {
      console.error('Financial analysis step failed:', error);
      const processingTime = `${Date.now() - startTime}ms`;
      
      // Return error state that still matches schema
      return {
        company_name: inputData.company_name,
        analysis_type: inputData.analysis_type,
        research_context: inputData.research_context,
        workflow_id: inputData.workflow_id,
        estimated_duration: inputData.estimated_duration,
        financial_analysis: emptyFinancialAnalysis(),
        processing_time: processingTime,
        data_quality: "Low" as const,
        analysis_notes: [`Error: ${error instanceof Error ? error.message : 'Unknown error'}`]
      };
    }
  }
});

// Step 2b: Business Strategy Analysis  
const businessStrategyStep = createStep({
  id: 'business_strategy',
  description: 'Business model and competitive positioning analysis',
  inputSchema: z.object({
    company_name: z.string(),
    analysis_type: z.string(),
    research_context: ResearchContextSchema,
    workflow_id: z.string(),
    estimated_duration: z.string(),
    financial_analysis: FinancialAnalysisSchema,
    processing_time: z.string(),
    data_quality: z.enum(['High', 'Medium', 'Low']).optional(),
    analysis_notes: z.array(z.string()).optional()
  }),
  outputSchema: z.object({
    company_name: z.string(),
    analysis_type: z.string(),
    research_context: ResearchContextSchema,
    workflow_id: z.string(),
    estimated_duration: z.string(),
    financial_analysis: FinancialAnalysisSchema,
    business_strategy: BusinessStrategySchema,
    processing_time: z.string(),
    strategic_confidence: z.enum(['High', 'Medium', 'Low']).optional(),
    market_intelligence_gaps: z.array(z.string()).optional()
  }),
  execute: async ({ inputData }) => {
    const startTime = Date.now();
    
    // Execute Business Strategy Agent with enhanced prompt
    const prompt = `You are performing comprehensive business strategy analysis for ${inputData.company_name} based on their S-1 filing.
    
Workflow ID: ${inputData.workflow_id}

IMPORTANT: You must search the S-1 document using your tools to find actual business data. Do NOT provide placeholder responses.

Required Analysis:
1. Market Opportunity:
   - Search for TAM (Total Addressable Market) size and growth rate
   - Find SAM (Serviceable Addressable Market) data
   - Identify geographic markets and expansion plans
   - Extract market drivers and trends

2. Competitive Positioning:
   - Search "Competition" and "Industry" sections for competitor analysis
   - Find market share data and competitive advantages
   - Identify key competitors by name
   - Extract competitive threats and moats

3. Business Model:
   - Search for revenue model and pricing strategy
   - Find customer segments and value proposition
   - Identify go-to-market strategy and distribution channels
   - Extract revenue streams breakdown

4. Growth Strategy:
   - Search for growth initiatives and expansion plans
   - Find strategic partnerships and acquisition strategy
   - Identify product roadmap and innovation plans

5. Customer Analysis:
   - Search for customer metrics (count, concentration, retention)
   - Find customer acquisition cost and lifetime value
   - Extract customer growth trends

For each data point, provide:
- The specific information found
- The page number where it was found
- A brief quote from the source
- Your confidence level in the data

Use your enhancedS1Search and tableSearch tools extensively to find this information.

Return your analysis in a structured format that matches the BusinessStrategySchema.`;

    try {
      // Generate structured response
      const agentResult = await businessStrategyAgent.generate(prompt, {
        output: BusinessStrategySchema,
        maxSteps: 10 // Allow multiple search steps
      });

      const rawText = agentResultText(agentResult);
      
      const processingTime = `${Date.now() - startTime}ms`;
      
      // Parse the agent's response
      const parsedAnalysis = await ResponseParser.parse(
        agentResult,
        BusinessStrategySchema,
        { validateFields: true, removeEmptyFields: true }
      );
      
      // Validate response quality
      const validation = ResponseParser.validateQuality(parsedAnalysis);
      
      if (!parsedAnalysis || !validation.isValid) {
        console.warn(`Business strategy quality issues: ${validation.issues.join(', ')}`);
        console.warn(`Data points found: ${validation.dataPoints}`);
      }

      const supportingEvidence =
        parsedAnalysis?.supporting_evidence?.length
          ? parsedAnalysis.supporting_evidence
          : rawText
            ? citationsFromText(rawText)
            : [];

      const business_strategy: BusinessStrategy =
        parsedAnalysis && validation.isValid
          ? parsedAnalysis
          : emptyBusinessStrategy({ supporting_evidence: supportingEvidence });

      const strategic_confidence: 'High' | 'Medium' | 'Low' =
        validation.isValid ? "High" : validation.dataPoints > 10 ? "Medium" : "Low";
      
      return {
        company_name: inputData.company_name,
        analysis_type: inputData.analysis_type,
        research_context: inputData.research_context,
        workflow_id: inputData.workflow_id,
        estimated_duration: inputData.estimated_duration,
        financial_analysis: inputData.financial_analysis,
        business_strategy,
        processing_time: processingTime,
        strategic_confidence,
        market_intelligence_gaps: validation.issues.length > 0 ? validation.issues : ["Analysis completed successfully"]
      };
      
    } catch (error) {
      console.error('Business strategy step failed:', error);
      const processingTime = `${Date.now() - startTime}ms`;
      
      // Return error state that still matches schema
      return {
        company_name: inputData.company_name,
        analysis_type: inputData.analysis_type,
        research_context: inputData.research_context,
        workflow_id: inputData.workflow_id,
        estimated_duration: inputData.estimated_duration,
        financial_analysis: inputData.financial_analysis,
        business_strategy: emptyBusinessStrategy(),
        processing_time: processingTime,
        strategic_confidence: "Low" as const,
        market_intelligence_gaps: [`Error: ${error instanceof Error ? error.message : 'Unknown error'}`]
      };
    }
  }
});

// Step 2c: Risk Assessment
const riskAssessmentStep = createStep({
  id: 'risk_assessment', 
  description: 'Systematic risk evaluation and scenario analysis',
  inputSchema: z.object({
    company_name: z.string(),
    analysis_type: z.string(),
    research_context: ResearchContextSchema,
    workflow_id: z.string(),
    estimated_duration: z.string(),
    financial_analysis: FinancialAnalysisSchema,
    business_strategy: BusinessStrategySchema,
    processing_time: z.string(),
    strategic_confidence: z.enum(['High', 'Medium', 'Low']).optional(),
    market_intelligence_gaps: z.array(z.string()).optional()
  }),
  outputSchema: z.object({
    company_name: z.string(),
    analysis_type: z.string(),
    research_context: ResearchContextSchema,
    workflow_id: z.string(),
    estimated_duration: z.string(),
    financial_analysis: FinancialAnalysisSchema,
    business_strategy: BusinessStrategySchema,
    risk_assessment: RiskAssessmentSchema,
    processing_time: z.string(),
    risk_disclosure_quality: z.enum(['Comprehensive', 'Adequate', 'Limited']).optional(),
    assessment_limitations: z.array(z.string()).optional()
  }),
  execute: async ({ inputData }) => {
    const startTime = Date.now();
    
    // Execute Risk Assessment Agent with enhanced prompt
    const prompt = `You are performing comprehensive risk assessment for ${inputData.company_name} based on their S-1 filing.
    
Workflow ID: ${inputData.workflow_id}

IMPORTANT: You must search the S-1 document using your tools to find actual risk data and return a COMPLETE response with ALL required fields.

Your response MUST include ALL of these sections:

1. risk_categories (REQUIRED):
   - market_risks: Array of market/industry risks with probability, impact, and mitigation
   - operational_risks: Array of operational/execution risks  
   - financial_risks: Array of financial/liquidity risks
   - regulatory_risks: Array of regulatory/compliance risks
   
   For EACH risk include:
   - risk: Specific risk description
   - probability: "High", "Medium", or "Low"
   - impact: "High", "Medium", or "Low"
   - mitigation: Company's mitigation strategy

2. risk_matrix (OPTIONAL - will be generated if missing):
   - high_impact_high_probability: List of critical risk descriptions
   - high_impact_medium_probability: List of important risk descriptions
   - medium_impact_high_probability: List of operational risk descriptions
   - overall_risk_profile: "Conservative", "Moderate", "Aggressive", or "High Risk"

3. scenario_analysis (OPTIONAL - will be generated if missing):
   - base_case: {scenario, probability, key_assumptions[]}
   - bull_case: {scenario, probability, key_drivers[]}
   - bear_case: {scenario, probability, key_risks[]}

4. confidence_level (REQUIRED): "High", "Medium", or "Low"

5. supporting_evidence (REQUIRED): Array of citations with section, page, and quote

Search Strategy:
- Use enhancedS1Search to find "Risk Factors" section
- Search for specific risk keywords: "risk", "uncertainty", "depend", "may", "could"
- Extract at least 3-5 risks per category where available

Return a complete JSON response matching the RiskAssessmentSchema structure.`;

    try {
      // Generate structured response
      const agentResult = await riskAssessmentAgent.generate(prompt, {
        output: RiskAssessmentSchema,
        maxSteps: 10 // Allow multiple search steps
      });
      
      const processingTime = `${Date.now() - startTime}ms`;
      
      // Parse the agent's response
      let parsedAnalysis = await ResponseParser.parse(
        agentResult,
        RiskAssessmentSchema,
        { validateFields: true, removeEmptyFields: true }
      );
      
      // Complete partial responses if needed
      if (parsedAnalysis && (!parsedAnalysis.risk_matrix || !parsedAnalysis.scenario_analysis)) {
        parsedAnalysis = ResponseParser.completePartial(parsedAnalysis, 'RiskAssessmentSchema');
      }
      
      // Validate response quality
      const validation = ResponseParser.validateQuality(parsedAnalysis);
      
      if (!parsedAnalysis || !validation.isValid) {
        console.warn(`Risk assessment quality issues: ${validation.issues.join(', ')}`);
        console.warn(`Data points found: ${validation.dataPoints}`);
      }

      const risk_disclosure_quality: 'Comprehensive' | 'Adequate' | 'Limited' =
        validation.isValid ? "Comprehensive" : validation.dataPoints > 10 ? "Adequate" : "Limited";
      
      return {
        company_name: inputData.company_name,
        analysis_type: inputData.analysis_type,
        research_context: inputData.research_context,
        workflow_id: inputData.workflow_id,
        estimated_duration: inputData.estimated_duration,
        financial_analysis: inputData.financial_analysis,
        business_strategy: inputData.business_strategy,
        risk_assessment: parsedAnalysis || {
          risk_categories: {
            market_risks: [],
            operational_risks: [],
            financial_risks: [],
            regulatory_risks: []
          },
          risk_matrix: {
            high_impact_high_probability: [],
            high_impact_medium_probability: [],
            medium_impact_high_probability: [],
            overall_risk_profile: 'Moderate' as const
          },
          scenario_analysis: {
            base_case: {
              scenario: "Error: Unable to extract scenario data",
              probability: "Medium",
              key_assumptions: []
            },
            bull_case: {
              scenario: "Error: Unable to extract scenario data",
              probability: "Low",
              key_drivers: []
            },
            bear_case: {
              scenario: "Error: Unable to extract scenario data",
              probability: "Low",
              key_risks: []
            }
          },
          confidence_level: "Low" as const,
          supporting_evidence: []
        },
        processing_time: processingTime,
        risk_disclosure_quality,
        assessment_limitations: validation.issues.length > 0 ? validation.issues : ["Analysis completed successfully"]
      };
      
    } catch (error) {
      console.error('Risk assessment step failed:', error);
      const processingTime = `${Date.now() - startTime}ms`;
      
      // Return error state that still matches schema
      return {
        company_name: inputData.company_name,
        analysis_type: inputData.analysis_type,
        research_context: inputData.research_context,
        workflow_id: inputData.workflow_id,
        estimated_duration: inputData.estimated_duration,
        financial_analysis: inputData.financial_analysis,
        business_strategy: inputData.business_strategy,
        risk_assessment: {
          risk_categories: {
            market_risks: [],
            operational_risks: [],
            financial_risks: [],
            regulatory_risks: []
          },
          risk_matrix: {
            high_impact_high_probability: [],
            high_impact_medium_probability: [],
            medium_impact_high_probability: [],
            overall_risk_profile: 'Moderate' as const
          },
          scenario_analysis: {
            base_case: {
              scenario: "Error: Agent failed",
              probability: "Medium",
              key_assumptions: []
            },
            bull_case: {
              scenario: "Error: Agent failed",
              probability: "Low",
              key_drivers: []
            },
            bear_case: {
              scenario: "Error: Agent failed",
              probability: "Low",
              key_risks: []
            }
          },
          confidence_level: "Low" as const,
          supporting_evidence: []
        },
        processing_time: processingTime,
        risk_disclosure_quality: "Limited" as const,
        assessment_limitations: [`Error: ${error instanceof Error ? error.message : 'Unknown error'}`]
      };
    }
  }
});

// Step 3: Valuation Analysis (depends on previous analyses)
const valuationStep = createStep({
  id: 'valuation_analysis',
  description: 'Financial modeling and investment valuation',
  inputSchema: z.object({
    company_name: z.string(),
    analysis_type: z.string(),
    research_context: ResearchContextSchema,
    workflow_id: z.string(),
    estimated_duration: z.string(),
    financial_analysis: FinancialAnalysisSchema,
    business_strategy: BusinessStrategySchema,
    risk_assessment: RiskAssessmentSchema,
    processing_time: z.string(),
    risk_disclosure_quality: z.enum(['Comprehensive', 'Adequate', 'Limited']).optional(),
    assessment_limitations: z.array(z.string()).optional()
  }),
  outputSchema: z.object({
    company_name: z.string(),
    analysis_type: z.string(),
    research_context: ResearchContextSchema,
    workflow_id: z.string(),
    estimated_duration: z.string(),
    financial_analysis: FinancialAnalysisSchema,
    business_strategy: BusinessStrategySchema,
    risk_assessment: RiskAssessmentSchema,
    valuation: ValuationSchema,
    processing_time: z.string(),
    model_confidence: z.enum(['High', 'Medium', 'Low']).optional(),
    key_sensitivities: z.array(z.string()).optional(),
    valuation_limitations: z.array(z.string()).optional()
  }),
  execute: async ({ inputData }) => {
    const startTime = Date.now();
    
    // Execute Valuation Agent with context from previous analyses
    const priorContext = {
      financial_analysis: inputData.financial_analysis,
      business_strategy: inputData.business_strategy,
      risk_assessment: inputData.risk_assessment,
    };

    const prompt = `You are performing valuation analysis for ${inputData.company_name} based on their S-1 filing and prior analyses.

Workflow ID: ${inputData.workflow_id}

Hard rules:
- Do NOT invent numbers, multiples, peer comps, or ranges.
- If required inputs are missing from the filing, write "Not found in filing" and set confidence_level to "Low".
- Every material numeric claim should be supported by supporting_evidence (section + quote; include page/table if known).

Prior structured context (from earlier workflow steps):
\`\`\`json
${JSON.stringify(priorContext, null, 2)}
\`\`\`

Return a JSON object that matches ValuationSchema exactly, including:
- valuation_methodologies.dcf_analysis (enterprise_value, equity_value, key_assumptions[], discount_rate)
- valuation_methodologies.peer_comparison (comparable_companies[], implied_valuation, relative_positioning)
- price_target (target_price, price_range, methodology_weights[])
- sensitivity_analysis[]
- investment_thesis (bull/base/bear + key_value_drivers[])
- confidence_level + supporting_evidence[]`;

    try {
      // Generate structured response
      const agentResult = await valuationAgent.generate(prompt, {
        output: ValuationSchema,
        maxSteps: 8 // Allow multiple search steps
      });

      const rawText = agentResultText(agentResult);
      
      const processingTime = `${Date.now() - startTime}ms`;
      
      // Parse the agent's response
      const parsedAnalysis = await ResponseParser.parse(
        agentResult,
        ValuationSchema,
        { validateFields: true, removeEmptyFields: true }
      );
      
      // Validate response quality
      const validation = ResponseParser.validateQuality(parsedAnalysis);
      
      if (!parsedAnalysis || !validation.isValid) {
        console.warn(`Valuation analysis quality issues: ${validation.issues.join(', ')}`);
        console.warn(`Data points found: ${validation.dataPoints}`);
      }

      const supportingEvidence =
        parsedAnalysis?.supporting_evidence?.length
          ? parsedAnalysis.supporting_evidence
          : rawText
            ? citationsFromText(rawText)
            : [];

      const valuation: Valuation =
        parsedAnalysis && validation.isValid
          ? parsedAnalysis
          : emptyValuation({ supporting_evidence: supportingEvidence });

      const sensitivityVars =
        valuation.sensitivity_analysis?.map(s => s.variable).filter(Boolean) ?? [];

      const model_confidence: 'High' | 'Medium' | 'Low' =
        validation.isValid ? "High" : validation.dataPoints > 10 ? "Medium" : "Low";
      
      return {
        company_name: inputData.company_name,
        analysis_type: inputData.analysis_type,
        research_context: inputData.research_context,
        workflow_id: inputData.workflow_id,
        estimated_duration: inputData.estimated_duration,
        financial_analysis: inputData.financial_analysis,
        business_strategy: inputData.business_strategy,
        risk_assessment: inputData.risk_assessment,
        valuation,
        processing_time: processingTime,
        model_confidence,
        key_sensitivities: sensitivityVars.slice(0, 3),
        valuation_limitations: validation.issues.length > 0 ? validation.issues : ["Analysis completed successfully"]
      };
      
    } catch (error) {
      console.error('Valuation step failed:', error);
      const processingTime = `${Date.now() - startTime}ms`;
      
      // Return error state that still matches schema
      return {
        company_name: inputData.company_name,
        analysis_type: inputData.analysis_type,
        research_context: inputData.research_context,
        workflow_id: inputData.workflow_id,
        estimated_duration: inputData.estimated_duration,
        financial_analysis: inputData.financial_analysis,
        business_strategy: inputData.business_strategy,
        risk_assessment: inputData.risk_assessment,
        valuation: emptyValuation(),
        processing_time: processingTime,
        model_confidence: "Low" as const,
        key_sensitivities: ["Unable to determine"],
        valuation_limitations: [`Error: ${error instanceof Error ? error.message : 'Unknown error'}`]
      };
    }
  }
});

// Step 4: Executive Summary Synthesis (depends on all analyses)
const executiveSummaryStep = createStep({
  id: 'executive_summary',
  description: 'Synthesize findings into executive summary with investment recommendation',
  inputSchema: z.object({
    company_name: z.string(),
    analysis_type: z.string(),
    research_context: ResearchContextSchema,
    workflow_id: z.string(),
    estimated_duration: z.string(),
    financial_analysis: FinancialAnalysisSchema,
    business_strategy: BusinessStrategySchema,
    risk_assessment: RiskAssessmentSchema,
    valuation: ValuationSchema,
    processing_time: z.string(),
    model_confidence: z.enum(['High', 'Medium', 'Low']).optional(),
    key_sensitivities: z.array(z.string()).optional(),
    valuation_limitations: z.array(z.string()).optional()
  }),
  outputSchema: z.object({
    company_name: z.string(),
    analysis_type: z.string(),
    research_context: ResearchContextSchema,
    workflow_id: z.string(),
    estimated_duration: z.string(),
    financial_analysis: FinancialAnalysisSchema,
    business_strategy: BusinessStrategySchema,
    risk_assessment: RiskAssessmentSchema,
    valuation: ValuationSchema,
    executive_summary: ExecutiveSummarySchema,
    processing_time: z.string(),
    synthesis_confidence: z.enum(['High', 'Medium', 'Low']).optional(),
    analysis_gaps: z.array(z.string()).optional()
  }),
  execute: async ({ inputData }) => {
    const startTime = Date.now();
    
    // Execute Executive Summary Agent with all context
    const synthesisContext = {
      financial_analysis: inputData.financial_analysis,
      business_strategy: inputData.business_strategy,
      risk_assessment: inputData.risk_assessment,
      valuation: inputData.valuation,
    };

    const prompt = `You are synthesizing an executive summary for ${inputData.company_name} based on completed analyses of the S-1 filing.

Workflow ID: ${inputData.workflow_id}

Hard rules:
- Do NOT invent numbers, recommendations, or catalysts.
- If something is not supported by the S-1 (or is missing from the structured context), write "Not found in filing" and keep confidence_level "Low".
- Provide supporting_evidence citations (section + quote; include page/table if known) for each material claim.

Structured context (from earlier workflow steps):
\`\`\`json
${JSON.stringify(synthesisContext, null, 2)}
\`\`\`

Return a JSON object that matches ExecutiveSummarySchema exactly.`;

    try {
      // Generate structured response with all context
      const agentResult = await executiveSummaryAgent.generate(prompt, {
        output: ExecutiveSummarySchema,
        maxSteps: 5
      });

      const rawText = agentResultText(agentResult);
      
      const processingTime = `${Date.now() - startTime}ms`;
      
      // Parse the agent's response
      const parsedSummary = await ResponseParser.parse(
        agentResult,
        ExecutiveSummarySchema,
        { validateFields: true, removeEmptyFields: true }
      );
      
      // Validate response quality
      const validation = ResponseParser.validateQuality(parsedSummary);
      
      if (!parsedSummary || !validation.isValid) {
        console.warn(`Executive summary quality issues: ${validation.issues.join(', ')}`);
        console.warn(`Data points found: ${validation.dataPoints}`);
      }

      const supportingEvidence =
        parsedSummary?.supporting_evidence?.length
          ? parsedSummary.supporting_evidence
          : rawText
            ? citationsFromText(rawText)
            : [];

      const executive_summary: ExecutiveSummary =
        parsedSummary && validation.isValid
          ? parsedSummary
          : emptyExecutiveSummary({ supporting_evidence: supportingEvidence });

      const synthesis_confidence: 'High' | 'Medium' | 'Low' =
        validation.isValid ? "High" : validation.dataPoints > 10 ? "Medium" : "Low";
      
      return {
        company_name: inputData.company_name,
        analysis_type: inputData.analysis_type,
        research_context: inputData.research_context,
        workflow_id: inputData.workflow_id,
        estimated_duration: inputData.estimated_duration,
        financial_analysis: inputData.financial_analysis,
        business_strategy: inputData.business_strategy,
        risk_assessment: inputData.risk_assessment,
        valuation: inputData.valuation,
        executive_summary,
        processing_time: processingTime,
        synthesis_confidence,
        analysis_gaps: validation.issues.length > 0 ? validation.issues : ["Synthesis completed successfully"]
      };
      
    } catch (error) {
      console.error('Executive summary step failed:', error);
      const processingTime = `${Date.now() - startTime}ms`;
      
      // Return error state that still matches schema
      return {
        company_name: inputData.company_name,
        analysis_type: inputData.analysis_type,
        research_context: inputData.research_context,
        workflow_id: inputData.workflow_id,
        estimated_duration: inputData.estimated_duration,
        financial_analysis: inputData.financial_analysis,
        business_strategy: inputData.business_strategy,
        risk_assessment: inputData.risk_assessment,
        valuation: inputData.valuation,
        executive_summary: emptyExecutiveSummary(),
        processing_time: processingTime,
        synthesis_confidence: "Low" as const,
        analysis_gaps: [`Error: ${error instanceof Error ? error.message : 'Unknown error'}`]
      };
    }
  }
});

// Step 5: Report Compilation
const reportCompilationStep = createStep({
  id: 'report_compilation',
  description: 'Compile final investment research report with professional formatting',
  inputSchema: z.object({
    company_name: z.string(),
    analysis_type: z.string(),
    research_context: ResearchContextSchema,
    workflow_id: z.string(),
    estimated_duration: z.string(),
    financial_analysis: FinancialAnalysisSchema,
    business_strategy: BusinessStrategySchema,
    risk_assessment: RiskAssessmentSchema,
    valuation: ValuationSchema,
    executive_summary: ExecutiveSummarySchema,
    processing_time: z.string(),
    synthesis_confidence: z.enum(['High', 'Medium', 'Low']).optional(),
    analysis_gaps: z.array(z.string()).optional()
  }),
  outputSchema: z.object({
    final_report: InvestmentResearchReportSchema,
    report_metadata: z.object({
      total_processing_time: z.string(),
      report_length: z.string(),
      sections_completed: z.number(),
      confidence_score: z.string()
    }),
    workflow_metadata: z.object({
      workflow_id: z.string(),
      total_duration: z.string(),
      sections_completed: z.number(),
      overall_status: z.enum(['completed', 'partial', 'failed'])
    })
  }),
  execute: async ({ inputData }) => {
    // Calculate overall confidence based on individual section confidences
    const confidenceLevels = [
      inputData.financial_analysis.confidence_level,
      inputData.business_strategy.confidence_level,
      inputData.risk_assessment.confidence_level,
      inputData.valuation.confidence_level,
      inputData.executive_summary.confidence_level
    ];
    
    const highCount = confidenceLevels.filter(c => c === "High").length;
    const mediumCount = confidenceLevels.filter(c => c === "Medium").length;
    const overallConfidence = highCount >= 3 ? "High" : mediumCount >= 3 ? "Medium" : "Low";
    
    const final_report = {
      report_metadata: {
        company: inputData.company_name,
        report_date: new Date().toISOString().split('T')[0],
        analyst: "AI Investment Research Suite",
        report_type: "IPO Analysis" as const
      },
      executive_summary: inputData.executive_summary,
      financial_analysis: inputData.financial_analysis,
      business_strategy: inputData.business_strategy,
      risk_assessment: inputData.risk_assessment,
      valuation: inputData.valuation,
      overall_confidence: overallConfidence as "High" | "Medium" | "Low",
      report_limitations: [
        "Analysis based on publicly available S-1 filing information",
        "Market conditions and competitive landscape subject to change",
        "Forward-looking statements involve inherent risks and uncertainties"
      ]
    };
    
    // Determine overall status
    const hasErrors = JSON.stringify(final_report).includes("Error:");
    const overall_status: 'completed' | 'partial' = hasErrors ? 'partial' : 'completed';
    
    return {
      final_report,
      report_metadata: {
        total_processing_time: inputData.estimated_duration,
        report_length: "15-20 pages equivalent",
        sections_completed: 5,
        confidence_score: `${overallConfidence} confidence (${highCount} high, ${mediumCount} medium sections)`
      },
      workflow_metadata: {
        workflow_id: inputData.workflow_id,
        total_duration: inputData.estimated_duration,
        sections_completed: 5,
        overall_status
      }
    };
  }
});

// Main Investment Research Workflow
export const investmentResearchWorkflow = createWorkflow({
  id: 'investment_research_workflow',
  description: 'Comprehensive S-1 investment research report generation',
  inputSchema: InvestmentResearchInputSchema,
  outputSchema: z.object({
    final_report: InvestmentResearchReportSchema,
    report_metadata: z.object({
      total_processing_time: z.string(),
      report_length: z.string(),
      sections_completed: z.number(),
      confidence_score: z.string()
    }),
    workflow_metadata: z.object({
      workflow_id: z.string(),
      total_duration: z.string(),
      sections_completed: z.number(),
      overall_status: z.enum(['completed', 'partial', 'failed'])
    })
  })
})
  // Step 1: Initialize
  .then(initializeResearchStep)
  
  // Step 2: Financial Analysis
  .then(financialAnalysisStep)
  
  // Step 3: Business Strategy Analysis
  .then(businessStrategyStep)
  
  // Step 4: Risk Assessment
  .then(riskAssessmentStep)
  
  // Step 5: Valuation Analysis
  .then(valuationStep)
  
  // Step 6: Executive Summary
  .then(executiveSummaryStep)
  
  // Step 7: Final Report Compilation
  .then(reportCompilationStep)
  .commit();

export { InvestmentResearchInputSchema };
