#!/usr/bin/env tsx

/**
 * Test script for the Investment Research Workflow
 * 
 * This script tests the fixed workflow execution to ensure it works
 * without getStepResult errors in Mastra 0.10.10
 */

import { mastra } from './mastra/index.js';

async function testWorkflow() {
  console.log('🚀 Testing Investment Research Workflow...');
  
  try {
    // Create a simple test input
    const testInput = {
      company_name: process.env.S1_COMPANY_NAME?.trim() || "Company",
      analysis_type: "comprehensive" as const,
      request_id: "test_run_001",
      user_preferences: {
        include_peer_comparison: true,
        focus_areas: ["growth", "profitability", "market_opportunity"] as (
          | "growth"
          | "profitability"
          | "market_opportunity"
          | "risks"
          | "valuation"
        )[],
        report_format: "full_report" as const
      }
    };

    console.log('📋 Test Input:', JSON.stringify(testInput, null, 2));

    // Execute the workflow using Mastra runtime
    const workflow = mastra.getWorkflow('investmentResearchWorkflow');
    const run = await workflow.createRunAsync();
    
    const runResult = await run.start({
      inputData: testInput
    });
    
    if (runResult.status !== 'success') {
      if (runResult.status === 'failed') {
        throw new Error(`Workflow execution failed: ${runResult.error}`);
      }
      throw new Error(`Workflow execution suspended: ${JSON.stringify(runResult.suspended)}`);
    }
    
    const result = runResult.result;
    
    console.log('✅ Workflow executed successfully!');
    console.log('📊 Result structure:', {
      final_report: result.final_report ? 'Present' : 'Missing',
      report_metadata: result.report_metadata ? 'Present' : 'Missing',
      workflow_metadata: result.workflow_metadata ? 'Present' : 'Missing'
    });

    // Log key results
    if (result.final_report) {
      console.log('\n📈 Report Summary:');
      console.log('- Company:', result.final_report.report_metadata.company);
      console.log('- Report Type:', result.final_report.report_metadata.report_type);
      console.log('- Investment Recommendation:', result.final_report.executive_summary.investment_recommendation);
      console.log('- Overall Confidence:', result.final_report.overall_confidence);
    }

    if (result.workflow_metadata) {
      console.log('\n⚙️  Workflow Metadata:');
      console.log('- Status:', result.workflow_metadata.overall_status);
      console.log('- Sections Completed:', result.workflow_metadata.sections_completed);
      console.log('- Total Duration:', result.workflow_metadata.total_duration);
    }

    console.log('\n🎉 Test completed successfully!');
    
    return result;
  } catch (error) {
    console.error('❌ Workflow execution failed:', error);
    
    // Log more details about the error
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    
    throw error;
  }
}

// Run the test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testWorkflow()
    .then(() => {
      console.log('\n✅ All tests passed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Test failed:', error);
      process.exit(1);
    });
}

export { testWorkflow };
