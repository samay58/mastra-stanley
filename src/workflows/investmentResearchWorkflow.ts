import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { 
  ExecutiveSummarySchema, 
  FinancialAnalysisSchema, 
  BusinessStrategySchema, 
  RiskAssessmentSchema, 
  ValuationSchema,
  InvestmentResearchReportSchema,
  WorkflowProgressSchema
} from '../schemas/investmentAnalysisSchemas.js';
import { financialAnalysisAgent } from '../agents/financialAnalysisAgent.js';
import { businessStrategyAgent } from '../agents/businessStrategyAgent.js';
import { riskAssessmentAgent } from '../agents/riskAssessmentAgent.js';
import { valuationAgent } from '../agents/valuationAgent.js';
import { executiveSummaryAgent } from '../agents/executiveSummaryAgent.js';
import { ResponseParser } from '../utils/responseParser.js';

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

// Step 1: Initialize Research Context
const initializeResearchStep = createStep({
  id: 'initialize_research',
  description: 'Initialize research context and validate S-1 document availability',
  inputSchema: InvestmentResearchInputSchema,
  outputSchema: z.object({
    company_name: z.string(),
    analysis_type: z.string(),
    research_context: z.object({
      document_available: z.boolean().describe('Whether S-1 document is available for analysis'),
      chunk_count: z.number().describe('Number of document chunks available'),
      table_count: z.number().describe('Number of financial tables available'),
      analysis_scope: z.array(z.string()).describe('Confirmed analysis scope based on document availability')
    }),
    workflow_id: z.string().describe('Unique workflow execution ID'),
    estimated_duration: z.string().describe('Estimated completion time')
  }),
  execute: async ({ inputData }) => {
    const workflowId = `research_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // In a real implementation, this would check S-1 document availability
    // For now, we'll simulate based on our known Figma S-1 data
    const researchContext = {
      document_available: true,
      chunk_count: 22707, // Our actual chunk count from text_chunks.jsonl
      table_count: 71,     // Our actual table count
      analysis_scope: inputData.analysis_type === 'comprehensive' 
        ? ['financial_analysis', 'business_strategy', 'risk_assessment', 'valuation', 'executive_summary']
        : ['financial_analysis', 'executive_summary'] // Simplified scope for other types
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
    research_context: z.any(),
    workflow_id: z.string(),
    estimated_duration: z.string()
  }),
  outputSchema: z.object({
    company_name: z.string(),
    analysis_type: z.string(),
    research_context: z.any(),
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
        
        // If parsing failed completely, try to extract from text
        if (!parsedAnalysis && agentResult.text) {
          const financialData = ResponseParser.parseFinancialData(agentResult.text);
          const citations = ResponseParser.extractCitations(agentResult.text);
          
          // Create a basic structure with extracted data
          return {
            company_name: inputData.company_name,
            analysis_type: inputData.analysis_type,
            research_context: inputData.research_context,
            workflow_id: inputData.workflow_id,
            estimated_duration: inputData.estimated_duration,
            financial_analysis: {
              revenue_analysis: {
                current_revenue: financialData.revenue || "Unable to extract",
                growth_rate: financialData.growth_rate || "Unable to extract",
                revenue_drivers: [],
                geographic_breakdown: {},
                segment_performance: []
              },
              profitability_metrics: {
                gross_margin: financialData.gross_margin || "Unable to extract",
                operating_margin: financialData.operating_margin || "Unable to extract",
                unit_economics: "Unable to extract",
                cost_structure: []
              },
              cash_flow_analysis: {
                operating_cash_flow: "Unable to extract",
                free_cash_flow: "Unable to extract",
                cash_conversion: "Unable to extract",
                working_capital_dynamics: "Unable to extract"
              },
              financial_projections: {
                revenue_forecast: "Unable to extract",
                margin_outlook: "Unable to extract",
                growth_sustainability: "Unable to extract"
              },
              key_financial_metrics: [],
              supporting_evidence: citations.map(c => ({
                section: c.section,
                page: c.page,
                quote: c.quote,
                table_number: undefined
              })),
              confidence_level: "Low"
            },
            processing_time: processingTime,
            data_quality: "Low",
            analysis_notes: ["Partial extraction from unstructured response"]
          };
        }
      }
      
      return {
        company_name: inputData.company_name,
        analysis_type: inputData.analysis_type,
        research_context: inputData.research_context,
        workflow_id: inputData.workflow_id,
        estimated_duration: inputData.estimated_duration,
        financial_analysis: parsedAnalysis || {
          revenue_analysis: {
            current_revenue: "Error: Unable to extract financial data",
            growth_rate: "Error: Unable to extract financial data",
            revenue_drivers: [],
            geographic_breakdown: {},
            segment_performance: []
          },
          profitability_metrics: {
            gross_margin: "Error: Unable to extract",
            operating_margin: "Error: Unable to extract",
            unit_economics: "Error: Unable to extract",
            cost_structure: []
          },
          cash_flow_analysis: {
            operating_cash_flow: "Error: Unable to extract",
            free_cash_flow: "Error: Unable to extract",
            cash_conversion: "Error: Unable to extract",
            working_capital_dynamics: "Error: Unable to extract"
          },
          financial_projections: {
            revenue_forecast: "Error: Unable to extract",
            margin_outlook: "Error: Unable to extract",
            growth_sustainability: "Error: Unable to extract"
          },
          key_financial_metrics: [],
          supporting_evidence: [],
          confidence_level: "Low"
        },
        processing_time: processingTime,
        data_quality: validation.isValid ? "High" : validation.dataPoints > 10 ? "Medium" : "Low",
        analysis_notes: validation.issues.length > 0 ? validation.issues : ["Analysis completed successfully"]
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
        financial_analysis: {
          revenue_analysis: {
            current_revenue: "Error: Agent failed to respond",
            growth_rate: "Error: Agent failed to respond",
            revenue_drivers: [],
            geographic_breakdown: {},
            segment_performance: []
          },
          profitability_metrics: {
            gross_margin: "Error: Agent failed",
            operating_margin: "Error: Agent failed",
            unit_economics: "Error: Agent failed",
            cost_structure: []
          },
          cash_flow_analysis: {
            operating_cash_flow: "Error: Agent failed",
            free_cash_flow: "Error: Agent failed",
            cash_conversion: "Error: Agent failed",
            working_capital_dynamics: "Error: Agent failed"
          },
          financial_projections: {
            revenue_forecast: "Error: Agent failed",
            margin_outlook: "Error: Agent failed",
            growth_sustainability: "Error: Agent failed"
          },
          key_financial_metrics: [],
          supporting_evidence: [],
          confidence_level: "Low"
        },
        processing_time: processingTime,
        data_quality: "Low",
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
    research_context: z.any(),
    workflow_id: z.string(),
    estimated_duration: z.string(),
    financial_analysis: FinancialAnalysisSchema,
    processing_time: z.string().optional(),
    data_quality: z.enum(['High', 'Medium', 'Low']).optional(),
    analysis_notes: z.array(z.string()).optional()
  }),
  outputSchema: z.object({
    company_name: z.string(),
    analysis_type: z.string(),
    research_context: z.any(),
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
      
      return {
        company_name: inputData.company_name,
        analysis_type: inputData.analysis_type,
        research_context: inputData.research_context,
        workflow_id: inputData.workflow_id,
        estimated_duration: inputData.estimated_duration,
        financial_analysis: inputData.financial_analysis,
        business_strategy: parsedAnalysis || {
          market_opportunity: {
            tam_size: "Error: Unable to extract market data",
            sam_size: "Error: Unable to extract market data",
            market_growth_rate: "Error: Unable to extract",
            geographic_markets: [],
            market_drivers: []
          },
          competitive_positioning: {
            market_position: "Error: Unable to extract",
            key_competitors: [],
            competitive_advantages: [],
            market_share: "Error: Unable to extract",
            competitive_threats: []
          },
          business_model: {
            value_proposition: "Error: Unable to extract",
            customer_segments: [],
            revenue_streams: [],
            go_to_market_strategy: "Error: Unable to extract",
            distribution_channels: []
          },
          growth_strategy: {
            organic_growth_initiatives: [],
            expansion_plans: [],
            strategic_partnerships: [],
            m_and_a_strategy: "Error: Unable to extract"
          },
          customer_analysis: {
            customer_base_size: "Error: Unable to extract",
            customer_concentration: "Error: Unable to extract",
            customer_retention_metrics: "Error: Unable to extract",
            customer_acquisition_strategy: "Error: Unable to extract"
          },
          supporting_evidence: [],
          confidence_level: "Low"
        },
        processing_time: processingTime,
        strategic_confidence: validation.isValid ? "High" : validation.dataPoints > 10 ? "Medium" : "Low",
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
        business_strategy: {
          market_opportunity: {
            tam_size: "Error: Agent failed",
            sam_size: "Error: Agent failed",
            market_growth_rate: "Error: Agent failed",
            geographic_markets: [],
            market_drivers: []
          },
          competitive_positioning: {
            market_position: "Error: Agent failed",
            key_competitors: [],
            competitive_advantages: [],
            market_share: "Error: Agent failed",
            competitive_threats: []
          },
          business_model: {
            value_proposition: "Error: Agent failed",
            customer_segments: [],
            revenue_streams: [],
            go_to_market_strategy: "Error: Agent failed",
            distribution_channels: []
          },
          growth_strategy: {
            organic_growth_initiatives: [],
            expansion_plans: [],
            strategic_partnerships: [],
            m_and_a_strategy: "Error: Agent failed"
          },
          customer_analysis: {
            customer_base_size: "Error: Agent failed",
            customer_concentration: "Error: Agent failed",
            customer_retention_metrics: "Error: Agent failed",
            customer_acquisition_strategy: "Error: Agent failed"
          },
          supporting_evidence: [],
          confidence_level: "Low"
        },
        processing_time: processingTime,
        strategic_confidence: "Low",
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
    research_context: z.any(),
    workflow_id: z.string(),
    estimated_duration: z.string(),
    financial_analysis: FinancialAnalysisSchema,
    business_strategy: BusinessStrategySchema,
    processing_time: z.string().optional(),
    strategic_confidence: z.enum(['High', 'Medium', 'Low']).optional(),
    market_intelligence_gaps: z.array(z.string()).optional()
  }),
  outputSchema: z.object({
    company_name: z.string(),
    analysis_type: z.string(),
    research_context: z.any(),
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
            overall_risk_profile: 'Moderate'
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
          confidence_level: "Low",
          supporting_evidence: []
        },
        processing_time: processingTime,
        risk_disclosure_quality: validation.isValid ? "Comprehensive" : validation.dataPoints > 10 ? "Adequate" : "Limited",
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
            overall_risk_profile: 'Moderate'
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
          confidence_level: "Low",
          supporting_evidence: []
        },
        processing_time: processingTime,
        risk_disclosure_quality: "Limited",
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
    research_context: z.any(),
    workflow_id: z.string(),
    estimated_duration: z.string(),
    financial_analysis: FinancialAnalysisSchema,
    business_strategy: BusinessStrategySchema,
    risk_assessment: RiskAssessmentSchema,
    processing_time: z.string().optional(),
    risk_disclosure_quality: z.enum(['Comprehensive', 'Adequate', 'Limited']).optional(),
    assessment_limitations: z.array(z.string()).optional()
  }),
  outputSchema: z.object({
    company_name: z.string(),
    analysis_type: z.string(),
    research_context: z.any(),
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
    const prompt = `You are performing comprehensive valuation analysis for ${inputData.company_name} based on their S-1 filing and previous analysis.
    
Workflow ID: ${inputData.workflow_id}

IMPORTANT: Use the financial data from previous analyses AND search for additional valuation-relevant information.

Context from Previous Analyses:
Financial Analysis Summary:
- Revenue: ${inputData.financial_analysis.revenue_analysis?.current_revenue || 'Not available'}
- Growth Rate: ${inputData.financial_analysis.revenue_analysis?.growth_rate || 'Not available'}
- Gross Margin: ${inputData.financial_analysis.profitability_metrics?.gross_margin || 'Not available'}
- Operating Margin: ${inputData.financial_analysis.profitability_metrics?.operating_margin || 'Not available'}

Business Strategy Summary:
- TAM: ${inputData.business_strategy.market_opportunity?.tam_size || 'Not available'}
- SAM: ${inputData.business_strategy.market_opportunity?.sam_size || 'Not available'}
- Market Growth: ${inputData.business_strategy.market_opportunity?.market_growth_rate || 'Not available'}
- Market Position: ${inputData.business_strategy.competitive_positioning?.market_position || 'Not available'}

Risk Assessment Summary:
- Overall Risk Profile: ${inputData.risk_assessment.overall_risk_profile || 'Not available'}
- High Impact Risks: ${inputData.risk_assessment.risk_matrix?.high_probability_high_impact?.length || 0} identified

Required Valuation Analysis:
1. DCF Analysis:
   - Use revenue and margin data from financial analysis
   - Apply appropriate discount rate based on risk profile
   - Project cash flows based on growth trends
   - Calculate terminal value

2. Comparable Company Analysis:
   - Search for mentioned competitors or comparable companies
   - Find relevant valuation multiples (P/S, EV/Revenue, etc.)
   - Position company relative to peers

3. Price Target Derivation:
   - Weight different valuation methodologies
   - Provide price target range (low, base, high)
   - Justify target with supporting data

4. Investment Recommendation:
   - Synthesize all analyses into Buy/Hold/Sell recommendation
   - Identify key value drivers
   - Assess risk-adjusted returns

Use your tools to find:
- Industry valuation benchmarks
- Comparable company metrics
- Market multiples for similar businesses

Return your analysis in a structured format that matches the ValuationSchema.`;

    try {
      // Generate structured response
      const agentResult = await valuationAgent.generate(prompt, {
        output: ValuationSchema,
        maxSteps: 8 // Allow multiple search steps
      });
      
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
      
      return {
        company_name: inputData.company_name,
        analysis_type: inputData.analysis_type,
        research_context: inputData.research_context,
        workflow_id: inputData.workflow_id,
        estimated_duration: inputData.estimated_duration,
        financial_analysis: inputData.financial_analysis,
        business_strategy: inputData.business_strategy,
        risk_assessment: inputData.risk_assessment,
        valuation: parsedAnalysis || {
          dcf_analysis: {
            terminal_value: "Error: Unable to calculate",
            discount_rate: "Error: Unable to determine",
            cash_flow_projections: [],
            dcf_price_target: "Error: Unable to calculate",
            key_assumptions: []
          },
          peer_comparison: {
            comparable_companies: [],
            trading_multiples: {},
            peer_analysis_price_target: "Error: Unable to calculate",
            relative_positioning: "Error: Unable to determine"
          },
          price_target_derivation: {
            methodology_weighting: {
              dcf_weight: "50%",
              peer_comparison_weight: "50%",
              other_methods_weight: "0%"
            },
            price_target_range: {
              low_target: "Error: Unable to calculate",
              base_target: "Error: Unable to calculate",
              high_target: "Error: Unable to calculate"
            },
            target_timeframe: "12 months",
            target_rationale: "Error: Unable to determine"
          },
          investment_thesis: {
            value_creation_drivers: [],
            investment_recommendation: "Hold",
            recommendation_rationale: "Error: Unable to determine",
            risk_adjusted_return: "Error: Unable to calculate"
          },
          scenario_valuation: {
            base_case_valuation: "Error: Unable to calculate",
            bull_case_valuation: "Error: Unable to calculate",
            bear_case_valuation: "Error: Unable to calculate"
          },
          valuation_sensitivities: [],
          supporting_evidence: [],
          confidence_level: "Low"
        },
        processing_time: processingTime,
        model_confidence: validation.isValid ? "High" : validation.dataPoints > 10 ? "Medium" : "Low",
        key_sensitivities: ["Revenue growth rate", "Discount rate", "Terminal growth rate"],
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
        valuation: {
          dcf_analysis: {
            terminal_value: "Error: Agent failed",
            discount_rate: "Error: Agent failed",
            cash_flow_projections: [],
            dcf_price_target: "Error: Agent failed",
            key_assumptions: []
          },
          peer_comparison: {
            comparable_companies: [],
            trading_multiples: {},
            peer_analysis_price_target: "Error: Agent failed",
            relative_positioning: "Error: Agent failed"
          },
          price_target_derivation: {
            methodology_weighting: {
              dcf_weight: "50%",
              peer_comparison_weight: "50%",
              other_methods_weight: "0%"
            },
            price_target_range: {
              low_target: "Error: Agent failed",
              base_target: "Error: Agent failed",
              high_target: "Error: Agent failed"
            },
            target_timeframe: "12 months",
            target_rationale: "Error: Agent failed"
          },
          investment_thesis: {
            value_creation_drivers: [],
            investment_recommendation: "Hold",
            recommendation_rationale: "Error: Agent failed",
            risk_adjusted_return: "Error: Agent failed"
          },
          scenario_valuation: {
            base_case_valuation: "Error: Agent failed",
            bull_case_valuation: "Error: Agent failed",
            bear_case_valuation: "Error: Agent failed"
          },
          valuation_sensitivities: [],
          supporting_evidence: [],
          confidence_level: "Low"
        },
        processing_time: processingTime,
        model_confidence: "Low",
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
    research_context: z.any(),
    workflow_id: z.string(),
    estimated_duration: z.string(),
    financial_analysis: FinancialAnalysisSchema,
    business_strategy: BusinessStrategySchema,
    risk_assessment: RiskAssessmentSchema,
    valuation: ValuationSchema,
    processing_time: z.string().optional(),
    model_confidence: z.enum(['High', 'Medium', 'Low']).optional(),
    key_sensitivities: z.array(z.string()).optional(),
    valuation_limitations: z.array(z.string()).optional()
  }),
  outputSchema: z.object({
    company_name: z.string(),
    analysis_type: z.string(),
    research_context: z.any(),
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
    const prompt = `You are synthesizing a comprehensive executive summary for ${inputData.company_name} based on all completed analyses.
    
Workflow ID: ${inputData.workflow_id}

Complete Analysis Results:

FINANCIAL ANALYSIS:
- Revenue: ${inputData.financial_analysis.revenue_analysis?.current_revenue || 'Not available'}
- Growth Rate: ${inputData.financial_analysis.revenue_analysis?.growth_rate || 'Not available'}
- Gross Margin: ${inputData.financial_analysis.profitability_metrics?.gross_margin || 'Not available'}
- Operating Cash Flow: ${inputData.financial_analysis.cash_flow_analysis?.operating_cash_flow || 'Not available'}
- Confidence: ${inputData.financial_analysis.confidence_level || 'Not available'}

BUSINESS STRATEGY:
- TAM: ${inputData.business_strategy.market_opportunity?.tam_size || 'Not available'}
- Market Position: ${inputData.business_strategy.competitive_positioning?.market_position || 'Not available'}
- Key Competitors: ${inputData.business_strategy.competitive_positioning?.key_competitors?.length || 0} identified
- Growth Strategy: ${inputData.business_strategy.growth_strategy?.organic_growth_initiatives?.length || 0} initiatives

RISK ASSESSMENT:
- Overall Risk: ${inputData.risk_assessment.overall_risk_profile || 'Not available'}
- Total Risks: ${
  (inputData.risk_assessment.market_risks?.length || 0) +
  (inputData.risk_assessment.operational_risks?.length || 0) +
  (inputData.risk_assessment.financial_risks?.length || 0) +
  (inputData.risk_assessment.regulatory_risks?.length || 0)
} identified
- High Impact Risks: ${inputData.risk_assessment.risk_matrix?.high_probability_high_impact?.length || 0}

VALUATION:
- Investment Recommendation: ${inputData.valuation.investment_thesis?.investment_recommendation || 'Not available'}
- Price Target (Base): ${inputData.valuation.price_target_derivation?.price_target_range?.base_target || 'Not available'}
- DCF Target: ${inputData.valuation.dcf_analysis?.dcf_price_target || 'Not available'}
- Confidence: ${inputData.valuation.confidence_level || 'Not available'}

Create an executive summary that:
1. Investment Recommendation:
   - Clear Buy/Hold/Sell recommendation
   - Compelling rationale based on all analyses
   - Price target with upside/downside potential

2. Key Investment Highlights (3-5 points):
   - Most compelling investment positives
   - Quantify with specific metrics where possible
   - Prioritize by impact on investment thesis

3. Financial Snapshot:
   - Current revenue and growth rate
   - Profitability status and trajectory
   - Cash position and burn rate
   - Market opportunity size

4. Top Risks (3 most critical):
   - Highest impact risks from assessment
   - Potential mitigation strategies
   - Impact on investment thesis

5. Catalysts (2-3 key events):
   - Near-term value drivers
   - Timeline and probability
   - Expected impact

Synthesize the data into a cohesive investment narrative. Be specific with numbers and avoid generic statements.

Return your summary in a structured format that matches the ExecutiveSummarySchema.`;

    try {
      // Generate structured response with all context
      const agentResult = await executiveSummaryAgent.generate(prompt, {
        output: ExecutiveSummarySchema,
        maxSteps: 5
      });
      
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
        executive_summary: parsedSummary || {
          investment_recommendation: "Hold",
          recommendation_rationale: "Unable to synthesize recommendation from analyses",
          price_target: {
            target_price: "Unable to determine",
            upside_potential: "Unable to calculate",
            timeframe: "12 months"
          },
          key_investment_highlights: [
            {
              title: "Analysis Error",
              description: "Unable to extract investment highlights",
              impact: "Unknown"
            }
          ],
          financial_snapshot: {
            revenue_current: "See financial analysis section",
            revenue_growth: "See financial analysis section",
            profitability: "See financial analysis section",
            cash_position: "See financial analysis section",
            market_opportunity: "See business strategy section"
          },
          top_risks: [
            {
              risk: "Analysis Error",
              impact: "Unknown",
              mitigation: "Unable to determine"
            }
          ],
          catalysts: [
            {
              catalyst: "Unable to identify",
              timeline: "Unknown",
              impact: "Unknown"
            }
          ],
          supporting_evidence: [],
          confidence_level: "Low"
        },
        processing_time: processingTime,
        synthesis_confidence: validation.isValid ? "High" : validation.dataPoints > 10 ? "Medium" : "Low",
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
        executive_summary: {
          investment_recommendation: "Hold",
          recommendation_rationale: "Error: Agent failed to synthesize",
          price_target: {
            target_price: "Error: Agent failed",
            upside_potential: "Error: Agent failed",
            timeframe: "12 months"
          },
          key_investment_highlights: [
            {
              title: "Error",
              description: "Agent failed to generate highlights",
              impact: "Unknown"
            }
          ],
          financial_snapshot: {
            revenue_current: "Error: Agent failed",
            revenue_growth: "Error: Agent failed",
            profitability: "Error: Agent failed",
            cash_position: "Error: Agent failed",
            market_opportunity: "Error: Agent failed"
          },
          top_risks: [
            {
              risk: "Error: Agent failed",
              impact: "Unknown",
              mitigation: "Error: Agent failed"
            }
          ],
          catalysts: [
            {
              catalyst: "Error: Agent failed",
              timeline: "Unknown",
              impact: "Unknown"
            }
          ],
          supporting_evidence: [],
          confidence_level: "Low"
        },
        processing_time: processingTime,
        synthesis_confidence: "Low",
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
    research_context: z.any(),
    workflow_id: z.string(),
    estimated_duration: z.string(),
    financial_analysis: FinancialAnalysisSchema,
    business_strategy: BusinessStrategySchema,
    risk_assessment: RiskAssessmentSchema,
    valuation: ValuationSchema,
    executive_summary: ExecutiveSummarySchema,
    processing_time: z.string().optional(),
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
    const startTime = Date.now();
    
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
        ticker: "FIGMA", // Would be extracted from S-1 in real implementation
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

    const processingTime = `${Date.now() - startTime}ms`;
    
    // Determine overall status
    const hasErrors = JSON.stringify(final_report).includes("Error:");
    const overall_status = hasErrors ? 'partial' : 'completed';
    
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