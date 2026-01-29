#!/usr/bin/env node

import dotenv from 'dotenv';
dotenv.config();

import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';

import { mastra } from '../mastra/index.js';
import { ResponseParser } from '../utils/responseParser.js';

type QueryIntent = 'fact' | 'table' | 'narrative' | 'mixed';

type EvalQuery = {
  id: string;
  filingId: string;
  query: string;
  intent: QueryIntent;
  expected?: Record<string, unknown>;
  notes?: string;
};

function nowStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function containsNumericClaim(text: string): boolean {
  // Heuristic gate: if the answer contains explicit numeric tokens, it must have citations.
  // This intentionally errs on the side of caution.
  return /\$|%|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+(?:\.\d+)?\b/.test(text);
}

async function loadQueries(jsonlPath: string): Promise<EvalQuery[]> {
  const raw = await readFile(jsonlPath, 'utf-8');
  const lines = raw.split('\n').filter(l => l.trim().length > 0);
  return lines.map(line => JSON.parse(line) as EvalQuery);
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
  const strict = hasFlag('strict') || process.env.EVAL_STRICT === 'true';

  const outPathDefault = resolve(process.cwd(), `eval/results/${nowStamp()}-answers.json`);
  const outPath = resolve(process.cwd(), getFlag('out') || outPathDefault);

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('Missing OPENAI_API_KEY (required for eval:answers).');
  }
  if (!process.env.POSTGRES_CONNECTION_STRING) {
    throw new Error('Missing POSTGRES_CONNECTION_STRING (required for eval:answers).');
  }

  const workflow = mastra.getWorkflow('s1QueryWorkflow');
  const queries = await loadQueries(queriesPath);

  const results: any[] = [];
  let failures = 0;

  for (const q of queries) {
    // One filing at a time: ensure tools/agents read from the correct output folder.
    process.env.S1_FILING_ID = q.filingId;

    const issues: string[] = [];

    const run = await workflow.createRunAsync();
    const execStart = process.hrtime.bigint();
    const res = await run.start({ inputData: { query: q.query } });
    const execEnd = process.hrtime.bigint();
    const latencyMs = Number(execEnd - execStart) / 1e6;

    if (res.status !== 'success') {
      failures += 1;
      issues.push(`workflow_status:${res.status}`);
      results.push({
        id: q.id,
        filingId: q.filingId,
        query: q.query,
        intent: q.intent,
        latency_ms: latencyMs,
        status: res.status,
        issues,
      });
      continue;
    }

    const answer = res.result.answer || '';
    const citations = Array.isArray(res.result.citations) ? res.result.citations : [];

    if (!answer.trim()) {
      issues.push('empty_answer');
    }

    if (ResponseParser.isPlaceholder(answer)) {
      issues.push('placeholder_answer');
    }

    const numeric = containsNumericClaim(answer);
    if (numeric && citations.length === 0) {
      issues.push('uncited_numeric_answer');
    }

    const citationsWithSource = citations.filter((c: any) => typeof c?.source_url === 'string' && c.source_url.trim().length > 0);
    const citationsWithAnchor = citations.filter((c: any) => typeof c?.anchor === 'string' && c.anchor.trim().length > 0);

    if (citations.length === 0) {
      issues.push('no_citations');
    }

    // Optional strict gate: require at least one anchor-bearing citation.
    const requireAnchor = process.env.EVAL_REQUIRE_ANCHOR === 'true';
    if (requireAnchor && citationsWithAnchor.length === 0) {
      issues.push('no_anchor_citations');
    }

    if (issues.length > 0) failures += 1;

    results.push({
      id: q.id,
      filingId: q.filingId,
      query: q.query,
      intent: q.intent,
      latency_ms: latencyMs,
      status: 'success',
      metrics: {
        answer_chars: answer.length,
        citations_total: citations.length,
        citations_with_source_url: citationsWithSource.length,
        citations_with_anchor: citationsWithAnchor.length,
        numeric_answer: numeric,
      },
      issues,
    });
  }

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(
    outPath,
    JSON.stringify({ generated_at: new Date().toISOString(), queries_path: queriesPath, failures, results }, null, 2),
    'utf-8'
  );

  console.log('Eval (answers) complete');
  console.log(`- Queries: ${queries.length}`);
  console.log(`- Failures: ${failures}`);
  console.log(`- Output: ${outPath}`);

  if (strict && failures > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('eval:answers failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});

