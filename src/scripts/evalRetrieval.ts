#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';

import type { Chunk } from '../types/index.js';
import { createBM25Index } from '../search/bm25.js';
import { getFilingContext } from '../config/filing.js';

type QueryIntent = 'fact' | 'table' | 'narrative' | 'mixed';

type EvalQuery = {
  id: string;
  filingId: string;
  query: string;
  intent: QueryIntent;
  expected?: {
    sections?: string[];
    chunkTypes?: string[];
    facts?: Array<{ canonicalKey: string; period?: string }>;
  };
  notes?: string;
};

type Retrieved = {
  rank: number;
  chunk_id: string;
  score: number;
  chunk_type?: string;
  section_hierarchy?: string;
  section_path?: string[];
  anchor?: string;
  source_url?: string;
};

function nowStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function normalizeToken(input: string): string {
  return input.trim().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').toUpperCase();
}

function parseExpectedSection(spec: string): string[] {
  // Supports:
  // - "RISK FACTORS" (major only)
  // - "RISK FACTORS > Some Subsection" (path prefix)
  const raw = spec
    .split('>')
    .map(part => normalizeToken(part))
    .filter(Boolean);
  return raw;
}

function chunkMatchesSection(chunk: Chunk, expectedSection: string[]): boolean {
  const chunkPath = (chunk.metadata.section_path || []).map(p => normalizeToken(p));
  if (expectedSection.length === 0) return false;
  if (chunkPath.length < expectedSection.length) return false;

  for (let i = 0; i < expectedSection.length; i++) {
    if (chunkPath[i] !== expectedSection[i]) return false;
  }
  return true;
}

async function loadQueries(jsonlPath: string): Promise<EvalQuery[]> {
  const raw = await readFile(jsonlPath, 'utf-8');
  const lines = raw.split('\n').filter(l => l.trim().length > 0);
  const out: EvalQuery[] = [];

  for (const line of lines) {
    const parsed = JSON.parse(line) as EvalQuery;
    if (!parsed?.id || !parsed?.filingId || !parsed?.query || !parsed?.intent) {
      throw new Error(`Invalid query line (missing required fields): ${line.slice(0, 120)}...`);
    }
    out.push(parsed);
  }

  return out;
}

async function loadChunks(filingId: string): Promise<Chunk[]> {
  const filing = getFilingContext(filingId);
  const raw = await readFile(filing.chunksPath, 'utf-8');
  return raw
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as Chunk);
}

function percentile(sortedAsc: number[], pct: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((pct / 100) * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

function hasExpectedSections(query: EvalQuery): boolean {
  return Array.isArray(query.expected?.sections) && query.expected!.sections!.length > 0;
}

function hasExpectedChunkTypes(query: EvalQuery): boolean {
  return Array.isArray(query.expected?.chunkTypes) && query.expected!.chunkTypes!.length > 0;
}

async function main() {
  const args = process.argv.slice(2);
  const getFlag = (name: string): string | undefined => {
    const idx = args.findIndex(a => a === `--${name}`);
    if (idx === -1) return undefined;
    return args[idx + 1];
  };
  const hasFlag = (name: string): boolean => args.includes(`--${name}`);

  const queriesPath = resolve(process.cwd(), getFlag('file') || 'eval/queries.jsonl');
  const topK = Number(getFlag('topK') || '10');
  const strict = hasFlag('strict') || process.env.EVAL_STRICT === 'true';

  const outPathDefault = resolve(process.cwd(), `eval/results/${nowStamp()}-retrieval.json`);
  const outPath = resolve(process.cwd(), getFlag('out') || outPathDefault);

  const queries = await loadQueries(queriesPath);
  const byFiling = new Map<string, EvalQuery[]>();
  for (const q of queries) {
    const list = byFiling.get(q.filingId) || [];
    list.push(q);
    byFiling.set(q.filingId, list);
  }

  const results: any[] = [];
  const latenciesMs: number[] = [];

  let sectionEligible = 0;
  let sectionHits = 0;

  let mrrEligible = 0;
  let mrrSum = 0;

  for (const [filingId, filingQueries] of byFiling.entries()) {
    const chunks = await loadChunks(filingId);
    const scorer = await createBM25Index(chunks);

    for (const q of filingQueries) {
      const t0 = process.hrtime.bigint();
      const scored = scorer.search(q.query, chunks, topK);
      const t1 = process.hrtime.bigint();
      const latencyMs = Number(t1 - t0) / 1e6;
      latenciesMs.push(latencyMs);

      const retrieved: Retrieved[] = scored.map((r, idx) => ({
        rank: idx + 1,
        chunk_id: r.chunk.id,
        score: r.score,
        chunk_type: r.chunk.metadata.chunk_type,
        section_hierarchy: r.chunk.metadata.section_hierarchy,
        section_path: r.chunk.metadata.section_path,
        anchor: r.chunk.metadata.anchor,
        source_url: r.chunk.metadata.source_url,
      }));

      let sectionHit: boolean | null = null;
      if (hasExpectedSections(q)) {
        sectionEligible += 1;
        const expectedSpecs = q.expected!.sections!.map(parseExpectedSection);
        sectionHit = retrieved.some(r => {
          const chunk = chunks.find(c => c.id === r.chunk_id);
          if (!chunk) return false;
          return expectedSpecs.some(spec => chunkMatchesSection(chunk, spec));
        });
        if (sectionHit) sectionHits += 1;
      }

      let chunkTypeRR: number | null = null;
      if (hasExpectedChunkTypes(q)) {
        mrrEligible += 1;
        const expected = new Set(q.expected!.chunkTypes!.map(t => normalizeToken(t)));
        const idx = retrieved.findIndex(r => expected.has(normalizeToken(r.chunk_type || '')));
        if (idx >= 0) {
          chunkTypeRR = 1 / (idx + 1);
          mrrSum += chunkTypeRR;
        } else {
          chunkTypeRR = 0;
        }
      }

      results.push({
        id: q.id,
        filingId: q.filingId,
        intent: q.intent,
        query: q.query,
        expected: q.expected || {},
        metrics: {
          latency_ms: latencyMs,
          section_hit: sectionHit,
          chunk_type_rr: chunkTypeRR,
        },
        retrieved,
      });
    }
  }

  latenciesMs.sort((a, b) => a - b);

  const summary = {
    queries: queries.length,
    by_filing: Array.from(byFiling.keys()),
    latency_ms: {
      p50: percentile(latenciesMs, 50),
      p95: percentile(latenciesMs, 95),
      max: latenciesMs.length > 0 ? latenciesMs[latenciesMs.length - 1] : 0,
    },
    section_recall_at_k: sectionEligible > 0 ? sectionHits / sectionEligible : null,
    chunk_type_mrr: mrrEligible > 0 ? mrrSum / mrrEligible : null,
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(
    outPath,
    JSON.stringify({ generated_at: new Date().toISOString(), queries_path: queriesPath, topK, summary, results }, null, 2),
    'utf-8'
  );

  console.log('Eval (retrieval) complete');
  console.log(`- Queries: ${summary.queries}`);
  console.log(`- Filings: ${summary.by_filing.join(', ')}`);
  console.log(`- Latency (ms) p50=${summary.latency_ms.p50.toFixed(1)} p95=${summary.latency_ms.p95.toFixed(1)} max=${summary.latency_ms.max.toFixed(1)}`);
  if (summary.section_recall_at_k !== null) console.log(`- Section Recall@${topK}: ${(summary.section_recall_at_k * 100).toFixed(1)}%`);
  if (summary.chunk_type_mrr !== null) console.log(`- ChunkType MRR: ${summary.chunk_type_mrr.toFixed(3)}`);
  console.log(`- Output: ${outPath}`);

  if (strict) {
    const minRecall = Number(process.env.EVAL_MIN_SECTION_RECALL_AT_K || '0');
    const minMrr = Number(process.env.EVAL_MIN_CHUNK_TYPE_MRR || '0');

    const recallOk = summary.section_recall_at_k === null || summary.section_recall_at_k >= minRecall;
    const mrrOk = summary.chunk_type_mrr === null || summary.chunk_type_mrr >= minMrr;

    if (!recallOk || !mrrOk) {
      console.error('Eval thresholds failed.');
      console.error(`- min section recall@k: ${minRecall}`);
      console.error(`- min chunk-type mrr: ${minMrr}`);
      process.exit(1);
    }
  }
}

main().catch(err => {
  console.error('eval:retrieval failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});

