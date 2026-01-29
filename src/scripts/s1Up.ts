#!/usr/bin/env tsx

import dotenv from 'dotenv';
import { writeFile } from 'fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'path';

import { S1Processor } from '../processor/S1Processor.js';
import { EmbeddingGenerator } from '../embeddings/generate-embeddings.js';
import { extractFactsForFiling } from '../facts/extractFacts.js';
import { getFilingContext } from '../config/filing.js';
import {
  buildFilingUrls,
  fetchTextCached,
  parseIndexHtmlForDocuments,
  selectPrimaryS1Document,
} from '../ingest/edgar/edgar.js';
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

function requireEnv(name: string): string {
  const val = process.env[name]?.trim();
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

async function runMastraDev(filingId: string): Promise<void> {
  const child = spawn('npx', ['mastra', 'dev'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      S1_FILING_ID: filingId,
    },
  });

  await new Promise<void>((resolve, reject) => {
    child.on('exit', code => {
      if (code === 0) resolve();
      reject(new Error(`mastra dev exited with code ${code ?? 'unknown'}`));
    });
    child.on('error', reject);
  });
}

async function main() {
  const cik = getFlag('cik');
  const accession = getFlag('accession');
  const filingIdFlag = getFlag('filing-id');

  if (!cik || !accession) {
    console.error('Usage:');
    console.error('  npm run s1:up -- --cik 0000000000 --accession 0000000000-00-000000 [--filing-id my_s1] [--force] [--skip-facts] [--skip-embed] [--skip-ui]');
    process.exit(1);
  }

  const forceDownload = hasFlag('force');
  const skipFacts = hasFlag('skip-facts');
  const skipEmbed = hasFlag('skip-embed');
  const skipUi = hasFlag('skip-ui');
  const noProcess = hasFlag('no-process');

  const secUserAgent = process.env.SEC_USER_AGENT?.trim() || requireEnv('SEC_USER_AGENT');
  const inferredFilingId = filingIdFlag?.trim() || `${cik.replace(/\D/g, '').padStart(10, '0')}-${accession}`;

  // Keep "one filing at a time" UX: set active filing for everything that follows.
  process.env.S1_FILING_ID = inferredFilingId;

  const filing = getFilingContext(inferredFilingId);
  const urls = buildFilingUrls({ cik, accession });

  console.log('S-1 Up (ingest -> process -> embed -> UI)');
  console.log('----------------------------------------');
  console.log(`Filing ID: ${filing.filingId}`);
  console.log(`Index: ${urls.indexHtmlUrl}`);
  console.log('');

  const indexHtmlPath = join(filing.rawDir, 'index.html');
  const indexHtml = await fetchTextCached(urls.indexHtmlUrl, indexHtmlPath, {
    userAgent: secUserAgent,
    forceDownload,
  });

  const docs = parseIndexHtmlForDocuments(indexHtml, urls.baseDirUrl);
  const primary = selectPrimaryS1Document(docs);

  console.log(`Primary document: ${primary.filename} (${primary.type})`);
  console.log(`Primary URL: ${primary.url}`);
  console.log('');

  const primaryHtmlPath = join(filing.rawDir, primary.filename);
  const primaryHtml = await fetchTextCached(primary.url, primaryHtmlPath, {
    userAgent: secUserAgent,
    forceDownload,
  });

  const elements = extractContentElementsFromHtml(primaryHtml, { sourceUrl: primary.url });
  await writeFile(filing.contentListPath, JSON.stringify(elements, null, 2), 'utf-8');
  console.log(`Extracted elements: ${elements.length}`);
  console.log(`Saved content list: ${filing.contentListPath}`);

  if (!noProcess) {
    console.log('\nProcessing into chunks + tables...');
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
  } else {
    console.log('\nSkipping chunking/processing (flag: --no-process).');
  }

  if (!skipFacts) {
    console.log('\nExtracting citation-backed facts...');
    const facts = await extractFactsForFiling(filing);
    console.log(`✓ Extracted ${facts.length} facts (${filing.factsPath})`);
  } else {
    console.log('\nSkipping fact extraction (flag: --skip-facts).');
  }

  if (!skipEmbed) {
    requireEnv('OPENAI_API_KEY');
    requireEnv('POSTGRES_CONNECTION_STRING');
    console.log('\nGenerating embeddings...');
    const generator = new EmbeddingGenerator();
    await generator.processAllChunks();
  } else {
    console.log('\nSkipping embeddings (flag: --skip-embed).');
  }

  if (!skipUi) {
    requireEnv('POSTGRES_CONNECTION_STRING');
    console.log('\nStarting Mastra dev UI...');
    await runMastraDev(filing.filingId);
  } else {
    console.log('\nSkipping UI (flag: --skip-ui).');
    console.log('To start UI later:');
    console.log(`  S1_FILING_ID=${filing.filingId} npx mastra dev`);
  }
}

main().catch(err => {
  console.error('s1:up failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
