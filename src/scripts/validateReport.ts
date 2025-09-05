#!/usr/bin/env tsx

/**
 * Report Quality Validation Script
 * 
 * Validates the quality of generated investment research reports,
 * checking for placeholder content, data completeness, and citation accuracy.
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ResponseParser } from '../utils/responseParser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ValidationResult {
  isValid: boolean;
  score: number;
  sections: {
    [key: string]: {
      score: number;
      issues: string[];
      dataPoints: number;
      placeholders: number;
      citations: number;
    };
  };
  overallIssues: string[];
  recommendations: string[];
}

/**
 * Validates a section of the report
 */
function validateSection(sectionName: string, sectionData: any): ValidationResult['sections'][string] {
  const result = {
    score: 100,
    issues: [] as string[],
    dataPoints: 0,
    placeholders: 0,
    citations: 0
  };
  
  // Use ResponseParser validation
  const validation = ResponseParser.validateQuality(sectionData);
  result.dataPoints = validation.dataPoints;
  result.issues = validation.issues;
  
  // Count placeholders
  function countPlaceholders(obj: any, path: string = ''): void {
    if (typeof obj === 'string' && ResponseParser.isPlaceholder(obj)) {
      result.placeholders++;
      result.issues.push(`Placeholder at ${path}: "${obj}"`);
    } else if (Array.isArray(obj)) {
      obj.forEach((item, index) => countPlaceholders(item, `${path}[${index}]`));
    } else if (obj && typeof obj === 'object') {
      Object.entries(obj).forEach(([key, value]) => {
        countPlaceholders(value, path ? `${path}.${key}` : key);
      });
    }
  }
  
  countPlaceholders(sectionData);
  
  // Count citations
  if (sectionData.supporting_evidence && Array.isArray(sectionData.supporting_evidence)) {
    result.citations = sectionData.supporting_evidence.length;
  }
  
  // Calculate section score
  result.score = 100;
  
  // Deduct for placeholders
  result.score -= result.placeholders * 10;
  
  // Deduct for lack of data points
  if (result.dataPoints < 5) {
    result.score -= 20;
  } else if (result.dataPoints < 10) {
    result.score -= 10;
  }
  
  // Deduct for no citations
  if (result.citations === 0) {
    result.score -= 15;
  }
  
  // Ensure score doesn't go below 0
  result.score = Math.max(0, result.score);
  
  return result;
}

/**
 * Main validation function
 */
async function validateReport(reportPath: string): Promise<ValidationResult> {
  console.log('🔍 Investment Report Quality Validation');
  console.log('======================================\n');
  
  try {
    // Load the report
    const reportContent = await readFile(reportPath, 'utf-8');
    const report = JSON.parse(reportContent);
    
    const result: ValidationResult = {
      isValid: true,
      score: 0,
      sections: {},
      overallIssues: [],
      recommendations: []
    };
    
    // Extract the main report data
    const reportData = report.investment_research_report || report.final_report || report;
    
    if (!reportData) {
      result.isValid = false;
      result.overallIssues.push('Report structure not found');
      return result;
    }
    
    // Validate each major section
    const sections = [
      { name: 'Executive Summary', data: reportData.executive_summary },
      { name: 'Financial Analysis', data: reportData.financial_analysis },
      { name: 'Business Strategy', data: reportData.business_strategy },
      { name: 'Risk Assessment', data: reportData.risk_assessment },
      { name: 'Valuation', data: reportData.valuation }
    ];
    
    console.log('📊 Section Analysis:');
    console.log('-------------------\n');
    
    for (const section of sections) {
      if (section.data) {
        const sectionResult = validateSection(section.name, section.data);
        result.sections[section.name] = sectionResult;
        
        console.log(`${section.name}:`);
        console.log(`  Score: ${sectionResult.score}/100`);
        console.log(`  Data Points: ${sectionResult.dataPoints}`);
        console.log(`  Placeholders: ${sectionResult.placeholders}`);
        console.log(`  Citations: ${sectionResult.citations}`);
        
        if (sectionResult.issues.length > 0) {
          console.log(`  Issues: ${sectionResult.issues.length}`);
          // Show first 3 issues
          sectionResult.issues.slice(0, 3).forEach(issue => {
            console.log(`    - ${issue}`);
          });
          if (sectionResult.issues.length > 3) {
            console.log(`    ... and ${sectionResult.issues.length - 3} more`);
          }
        }
        console.log('');
      } else {
        result.overallIssues.push(`Section missing: ${section.name}`);
      }
    }
    
    // Calculate overall score
    const sectionScores = Object.values(result.sections).map(s => s.score);
    result.score = sectionScores.length > 0 
      ? Math.round(sectionScores.reduce((a, b) => a + b, 0) / sectionScores.length)
      : 0;
    
    // Determine validity
    result.isValid = result.score >= 60 && result.overallIssues.length === 0;
    
    // Overall statistics
    console.log('📈 Overall Statistics:');
    console.log('---------------------');
    
    const totalDataPoints = Object.values(result.sections).reduce((sum, s) => sum + s.dataPoints, 0);
    const totalPlaceholders = Object.values(result.sections).reduce((sum, s) => sum + s.placeholders, 0);
    const totalCitations = Object.values(result.sections).reduce((sum, s) => sum + s.citations, 0);
    const totalIssues = Object.values(result.sections).reduce((sum, s) => sum + s.issues.length, 0);
    
    console.log(`Total Data Points: ${totalDataPoints}`);
    console.log(`Total Placeholders: ${totalPlaceholders}`);
    console.log(`Total Citations: ${totalCitations}`);
    console.log(`Total Issues: ${totalIssues}`);
    console.log(`Overall Score: ${result.score}/100`);
    console.log(`Report Valid: ${result.isValid ? '✅ Yes' : '❌ No'}\n`);
    
    // Generate recommendations
    if (totalPlaceholders > 0) {
      result.recommendations.push(`Remove ${totalPlaceholders} placeholder values by ensuring agents search and extract real data`);
    }
    
    if (totalDataPoints < 50) {
      result.recommendations.push('Increase data extraction by improving agent search queries and tool usage');
    }
    
    if (totalCitations < 20) {
      result.recommendations.push('Add more citations by extracting page numbers and quotes from S-1 document');
    }
    
    const lowScoreSections = Object.entries(result.sections)
      .filter(([_, section]) => section.score < 60)
      .map(([name, _]) => name);
    
    if (lowScoreSections.length > 0) {
      result.recommendations.push(`Focus on improving: ${lowScoreSections.join(', ')}`);
    }
    
    // Check for specific data quality issues
    if (reportData.executive_summary?.price_target?.target_price?.includes('Error')) {
      result.recommendations.push('Fix valuation agent to generate proper price targets');
    }
    
    if (reportData.financial_analysis?.revenue_analysis?.current_revenue?.includes('Error')) {
      result.recommendations.push('Fix financial analysis agent to extract revenue data from S-1');
    }
    
    // Display recommendations
    if (result.recommendations.length > 0) {
      console.log('💡 Recommendations:');
      console.log('------------------');
      result.recommendations.forEach((rec, index) => {
        console.log(`${index + 1}. ${rec}`);
      });
      console.log('');
    }
    
    // Check confidence levels
    console.log('🎯 Confidence Levels:');
    console.log('--------------------');
    
    const confidenceLevels: Record<string, string> = {};
    for (const section of sections) {
      if (section.data?.confidence_level) {
        confidenceLevels[section.name] = section.data.confidence_level;
      }
    }
    
    Object.entries(confidenceLevels).forEach(([section, confidence]) => {
      const emoji = confidence === 'High' ? '🟢' : confidence === 'Medium' ? '🟡' : '🔴';
      console.log(`${emoji} ${section}: ${confidence}`);
    });
    
    console.log(`\nOverall Confidence: ${reportData.overall_confidence || 'Not specified'}\n`);
    
    // Final summary
    console.log('📋 Summary:');
    console.log('-----------');
    
    if (result.isValid) {
      console.log('✅ Report meets minimum quality standards');
      
      if (result.score >= 90) {
        console.log('🌟 Excellent report quality!');
      } else if (result.score >= 75) {
        console.log('👍 Good report quality with room for improvement');
      } else {
        console.log('⚠️  Report is valid but needs significant improvement');
      }
    } else {
      console.log('❌ Report does not meet quality standards');
      console.log('🔧 Major improvements needed before production use');
    }
    
    return result;
    
  } catch (error) {
    console.error('❌ Error validating report:', error);
    
    return {
      isValid: false,
      score: 0,
      sections: {},
      overallIssues: [`Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`],
      recommendations: ['Fix report structure or generation errors']
    };
  }
}

/**
 * Compare two reports to track improvements
 */
async function compareReports(oldReportPath: string, newReportPath: string): Promise<void> {
  console.log('\n📊 Report Comparison');
  console.log('===================\n');
  
  const oldResult = await validateReport(oldReportPath);
  const newResult = await validateReport(newReportPath);
  
  console.log('\n🔄 Score Changes:');
  console.log('-----------------');
  
  const scoreDiff = newResult.score - oldResult.score;
  const scoreEmoji = scoreDiff > 0 ? '📈' : scoreDiff < 0 ? '📉' : '➡️';
  
  console.log(`Overall: ${oldResult.score} → ${newResult.score} (${scoreEmoji} ${scoreDiff > 0 ? '+' : ''}${scoreDiff})`);
  
  // Section-by-section comparison
  for (const section of Object.keys(newResult.sections)) {
    if (oldResult.sections[section]) {
      const oldScore = oldResult.sections[section].score;
      const newScore = newResult.sections[section].score;
      const diff = newScore - oldScore;
      const emoji = diff > 0 ? '📈' : diff < 0 ? '📉' : '➡️';
      
      console.log(`${section}: ${oldScore} → ${newScore} (${emoji} ${diff > 0 ? '+' : ''}${diff})`);
    }
  }
  
  console.log('\n✨ Improvements made in the new report!');
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    // Default to the latest report
    const defaultPath = join(__dirname, '../../output/figma_investment_research_report.json');
    await validateReport(defaultPath);
  } else if (args[0] === '--compare' && args.length === 3) {
    // Compare two reports
    await compareReports(args[1], args[2]);
  } else if (args.length === 1) {
    // Validate specific report
    await validateReport(args[0]);
  } else {
    console.log('Usage:');
    console.log('  npm run validate-report                    # Validate latest report');
    console.log('  npm run validate-report <report-path>      # Validate specific report');
    console.log('  npm run validate-report --compare <old> <new>  # Compare two reports');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { validateReport, compareReports };