#!/usr/bin/env tsx

import dotenv from 'dotenv';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { S1Processor } from '../processor/S1Processor.js';
import { getFilingContext } from '../config/filing.js';
import { buildFilingUrls, fetchTextCached, parseIndexHtmlForDocuments, selectPrimaryS1Document } from '../ingest/edgar/edgar.js';
import { extractContentElementsFromHtml } from '../ingest/edgar/htmlToContent.js';

dotenv.config();

function getFlag(name: string): string | undefined {
  const idx = process.argv.findIndex(arg => arg === `--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function requiredEnv(name: string): string {
  const val = process.env[name]?.trim();
  if (!val) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return val;
}

async function main() {
  const cik = getFlag('cik');
  const accession = getFlag('accession');
  const filingId = getFlag('filing-id');

  if (!cik || !accession) {
    console.error('Usage:');
    console.error('  npm run ingest:edgar -- --cik 0000000000 --accession 0000000000-00-000000 [--filing-id my_filing]');
    process.exit(1);
  }

  const userAgent = process.env.SEC_USER_AGENT?.trim() || requiredEnv('SEC_USER_AGENT');
  const forceDownload = hasFlag('force');

  const inferredFilingId = filingId?.trim() || `${cik.replace(/\\D/g, '').padStart(10, '0')}-${accession}`;
  const filing = getFilingContext(inferredFilingId);

  const urls = buildFilingUrls({ cik, accession });

  console.log('SEC EDGAR ingestion');
  console.log('-------------------');
  console.log(`Filing ID: ${filing.filingId}`);
  console.log(`Index: ${urls.indexHtmlUrl}`);
  console.log('');

  const indexHtmlPath = join(filing.rawDir, 'index.html');
  const indexHtml = await fetchTextCached(urls.indexHtmlUrl, indexHtmlPath, { userAgent, forceDownload });

  const docs = parseIndexHtmlForDocuments(indexHtml, urls.baseDirUrl);
  const primary = selectPrimaryS1Document(docs);

  console.log(`Primary document: ${primary.filename} (${primary.type})`);
  console.log(`Primary URL: ${primary.url}`);
  console.log('');

  const primaryHtmlPath = join(filing.rawDir, primary.filename);
  const primaryHtml = await fetchTextCached(primary.url, primaryHtmlPath, { userAgent, forceDownload });

  const elements = extractContentElementsFromHtml(primaryHtml, { sourceUrl: primary.url });
  await writeFile(filing.contentListPath, JSON.stringify(elements, null, 2), 'utf-8');

  console.log(`Extracted elements: ${elements.length}`);
  console.log(`Saved content list: ${filing.contentListPath}`);
  console.log('');

  if (hasFlag('no-process')) {
    console.log('Skipping chunking/processing (flag: --no-process).');
    return;
  }

  const processor = new S1Processor(
    filing.contentListPath,
    filing.outputDir,
    {
      chunkSize: process.env.S1_CHUNK_SIZE ? Number(process.env.S1_CHUNK_SIZE) : 1800,
      chunkOverlap: process.env.S1_CHUNK_OVERLAP ? Number(process.env.S1_CHUNK_OVERLAP) : 300,
      extractMetadata: true,
    },
    { filingId: filing.filingId, sourceUrl: primary.url }
  );

  const { chunks, tables } = await processor.processDocument();
  await processor.saveOutputs(chunks, tables);

  console.log('\nNext steps:');
  console.log(`  1) Set S1_FILING_ID=${filing.filingId}`);
  console.log('  2) Generate embeddings: npm run embed');
  console.log('  3) Start UI: npx mastra dev');
}

main().catch(err => {
  console.error('Ingestion failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});

