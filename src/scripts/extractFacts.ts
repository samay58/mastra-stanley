#!/usr/bin/env tsx

import dotenv from 'dotenv';
dotenv.config();

import { extractFactsForFiling } from '../facts/extractFacts.js';
import { getActiveFilingContext } from '../config/filing.js';

async function main() {
  const filing = getActiveFilingContext();

  console.log('Extracting facts (one filing at a time)');
  console.log('-------------------------------------');
  console.log(`Active filing: ${filing.filingId}`);
  console.log(`Chunks: ${filing.chunksPath}`);
  console.log(`Tables: ${filing.tablesManifestPath}`);
  console.log(`Output: ${filing.factsPath}`);
  console.log('');

  const facts = await extractFactsForFiling(filing);
  console.log(`✓ Wrote ${facts.length} facts to ${filing.factsPath}`);
}

main().catch(err => {
  console.error('Fact extraction failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});

