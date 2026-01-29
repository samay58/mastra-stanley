#!/usr/bin/env node

/**
 * Investment Research Report Generator
 * 
 * Script to execute the complete investment research workflow and generate
 * a professional Goldman Sachs-style research report for the active S-1 filing.
 */

import dotenv from 'dotenv';
import { join } from 'path';
import { mastra } from '../mastra/index.js';
import { getActiveFilingContext } from '../config/filing.js';

// Load environment variables
dotenv.config();

async function generateInvestmentReport() {
  console.log('🚀 Investment Research Suite - Professional S-1 Analysis');
  console.log('====================================================\n');

  try {
    // Workflow input
    const workflowInput = {
      company_name: process.env.S1_COMPANY_NAME?.trim() || "Company",
      analysis_type: "comprehensive" as const,
      request_id: `research_${Date.now()}`,
      user_preferences: {
        include_peer_comparison: true,
        focus_areas: ["growth", "profitability", "market_opportunity", "risks", "valuation"] as (
          | "growth"
          | "profitability"
          | "market_opportunity"
          | "risks"
          | "valuation"
        )[],
        report_format: "full_report" as const
      }
    };

    console.log('📊 Initiating comprehensive S-1 analysis...');
    console.log(`Company: ${workflowInput.company_name}`);
    console.log(`Analysis Type: ${workflowInput.analysis_type}`);
    console.log(`Request ID: ${workflowInput.request_id}\n`);

    const startTime = Date.now();

    // Execute the investment research workflow
    console.log('⏳ Executing investment research workflow...');
    console.log('This will take approximately 15-20 minutes for comprehensive analysis\n');

    const workflow = mastra.getWorkflow('investmentResearchWorkflow');
    const run = await workflow.createRunAsync();
    
    const runResult = await run.start({
      inputData: workflowInput
    });
    
    if (runResult.status !== 'success') {
      if (runResult.status === 'failed') {
        throw new Error(`Workflow execution failed: ${runResult.error}`);
      }
      throw new Error(`Workflow execution suspended: ${JSON.stringify(runResult.suspended)}`);
    }
    
    const result = runResult.result;

    const totalTime = Date.now() - startTime;
    const minutes = Math.floor(totalTime / 60000);
    const seconds = Math.floor((totalTime % 60000) / 1000);

    console.log('✅ Investment research workflow completed successfully!');
    console.log(`⏱️  Total execution time: ${minutes}m ${seconds}s\n`);

    // Display workflow results
    console.log('📈 WORKFLOW RESULTS SUMMARY');
    console.log('============================');
    console.log(`Workflow ID: ${result.workflow_metadata.workflow_id}`);
    console.log(`Total Duration: ${result.workflow_metadata.total_duration}`);
    console.log(`Sections Completed: ${result.workflow_metadata.sections_completed}`);
    console.log(`Overall Status: ${result.workflow_metadata.overall_status}\n`);

    // Display executive summary highlights
    const execSummary = result.final_report.executive_summary;
    console.log('🎯 EXECUTIVE SUMMARY HIGHLIGHTS');
    console.log('================================');
    console.log(`Investment Recommendation: ${execSummary.investment_recommendation}`);
    console.log(`Price Target: ${execSummary.price_target.target_price}`);
    console.log(`Upside Potential: ${execSummary.price_target.upside_potential}`);
    console.log(`Confidence Level: ${execSummary.confidence_level}\n`);

    // Display key investment highlights
    console.log('💡 KEY INVESTMENT HIGHLIGHTS');
    console.log('=============================');
    execSummary.key_investment_highlights.forEach((highlight, index) => {
      console.log(`${index + 1}. ${highlight.title}`);
      console.log(`   ${highlight.description}`);
      console.log(`   Impact: ${highlight.impact}\n`);
    });

    // Display financial snapshot
    console.log('💰 FINANCIAL SNAPSHOT');
    console.log('======================');
    const financial = execSummary.financial_snapshot;
    console.log(`Current Revenue: ${financial.revenue_current}`);
    console.log(`Revenue Growth: ${financial.revenue_growth}`);
    console.log(`Profitability: ${financial.profitability}`);
    console.log(`Cash Position: ${financial.cash_position}`);
    console.log(`Market Opportunity: ${financial.market_opportunity}\n`);

    // Display top risks
    console.log('⚠️  TOP INVESTMENT RISKS');
    console.log('========================');
    execSummary.top_risks.forEach((risk, index) => {
      console.log(`${index + 1}. ${risk.risk}`);
      console.log(`   Impact Level: ${risk.impact}`);
      console.log(`   Mitigation: ${risk.mitigation}\n`);
    });

    // Display catalysts
    console.log('🚀 POTENTIAL CATALYSTS');
    console.log('======================');
    execSummary.catalysts.forEach((catalyst, index) => {
      console.log(`${index + 1}. ${catalyst.catalyst}`);
      console.log(`   Timeline: ${catalyst.timeline}`);
      console.log(`   Impact: ${catalyst.impact}\n`);
    });

    // Save full report to file
    const reportData = {
      generated_at: new Date().toISOString(),
      execution_time_minutes: minutes + (seconds / 60),
      workflow_metadata: result.workflow_metadata,
      investment_research_report: result.final_report
    };

    const fs = await import('fs/promises');
    const filing = getActiveFilingContext();
    const outputPath = join(filing.outputDir, 'investment_research_report.json');
    await fs.writeFile(outputPath, JSON.stringify(reportData, null, 2));

    console.log('💾 REPORT SAVED');
    console.log('================');
    console.log(`Full research report saved to: ${outputPath}`);
    console.log(`Report size: ${Math.round(JSON.stringify(reportData).length / 1024)} KB`);
    console.log(`Professional analysis sections: ${result.workflow_metadata.sections_completed}\n`);

    console.log('🎉 Investment Research Suite execution completed successfully!');
    console.log('The professional S-1 analysis is now available for review.');

  } catch (error) {
    console.error('❌ Investment research workflow failed:');
    console.error(error);
    
    if (error instanceof Error) {
      console.error(`Error message: ${error.message}`);
      console.error(`Stack trace: ${error.stack}`);
    }
    
    process.exit(1);
  }
}

// Execute if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  generateInvestmentReport().catch(console.error);
}

export { generateInvestmentReport };
