/**
 * Investment Research Suite - Specialized Agents
 * 
 * This file exports all specialized investment analysis agents for the 
 * professional investment research workflow.
 */

export { financialAnalysisAgent } from './financialAnalysisAgent.js';
export { businessStrategyAgent } from './businessStrategyAgent.js';
export { riskAssessmentAgent } from './riskAssessmentAgent.js';
export { valuationAgent } from './valuationAgent.js';
export { executiveSummaryAgent } from './executiveSummaryAgent.js';

// Legacy agents for compatibility
export { s1QueryAgent, s1BasicAgent } from './s1QueryAgent.js';

/**
 * Agent Descriptions:
 * 
 * - financialAnalysisAgent: Deep financial modeling and performance analysis
 * - businessStrategyAgent: Market positioning and competitive analysis
 * - riskAssessmentAgent: Systematic risk evaluation and scenario modeling
 * - valuationAgent: DCF modeling, peer comparison, and price target derivation
 * - executiveSummaryAgent: Investment thesis synthesis and recommendation
 * 
 * Each agent specializes in a specific aspect of investment analysis and
 * uses the enhanced S-1 search tools to extract relevant information from
 * the document for professional-grade analysis.
 */