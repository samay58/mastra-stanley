import dotenv from 'dotenv';
dotenv.config();

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { readFile } from 'fs/promises';
import { getActiveFilingContext } from '../config/filing.js';

const FactEvidenceSchema = z.object({
  type: z.enum(['table_cell', 'table_row', 'text_quote']),
  source_url: z.string().optional(),
  anchor: z.string().optional(),
  section_hierarchy: z.string().optional(),
  chunk_id: z.string().optional(),
  table_filename: z.string().optional(),
  table_caption: z.string().optional(),
  row_index: z.number().optional(),
  col_index: z.number().optional(),
  row_label: z.string().optional(),
  column_label: z.string().optional(),
  quote: z.string(),
});

const FactSchema = z.object({
  fact_id: z.string(),
  filing_id: z.string(),
  fact_type: z.enum(['financial_metric', 'offering_terms', 'ownership']),
  canonical_key: z.string(),
  value: z.string(),
  unit: z.string().optional(),
  period: z.string().optional(),
  dimensions: z.record(z.string()).optional(),
  evidence: z.array(FactEvidenceSchema),
  created_at: z.string(),
});

type Fact = z.infer<typeof FactSchema>;

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function scoreFact(fact: Fact, query: string): number {
  const q = normalize(query);
  const hay = [
    fact.canonical_key,
    fact.fact_type,
    fact.period || '',
    fact.unit || '',
    ...Object.values(fact.dimensions || {}),
    ...fact.evidence.map(e => e.quote),
    ...fact.evidence.map(e => e.row_label || ''),
    ...fact.evidence.map(e => e.column_label || ''),
  ]
    .join(' ')
    .toLowerCase();

  let score = 0;
  for (const token of q.split(' ').filter(t => t.length > 2)) {
    if (hay.includes(token)) score += 1;
  }
  return score;
}

export const s1FactsLookupTool = createTool({
  id: 'lookupS1Facts',
  description: 'Look up extracted, citation-backed facts for the active S-1 filing (fast path for numeric/offering questions).',
  inputSchema: z.object({
    query: z.string().optional().describe('Free-text query (e.g., "revenue 2024", "cash and cash equivalents")'),
    canonicalKey: z.string().optional().describe('Exact canonical key (e.g., "revenue", "cash_and_cash_equivalents")'),
    period: z.string().optional().describe('Optional period filter (matches substring)'),
    topK: z.number().default(8).describe('Max number of facts to return'),
  }),
  outputSchema: z.object({
    facts: z.array(FactSchema),
    summary: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const { query, canonicalKey, period, topK } = context;
    const filing = getActiveFilingContext();

    let facts: Fact[] = [];
    try {
      const raw = await readFile(filing.factsPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        facts = parsed as Fact[];
      }
    } catch {
      return {
        facts: [],
        summary: `No facts file found for active filing (${filing.filingId}). Run: npm run facts`,
      };
    }

    let filtered = facts;
    if (canonicalKey) {
      const key = normalize(canonicalKey);
      filtered = filtered.filter(f => normalize(f.canonical_key) === key);
    }
    if (period) {
      const p = normalize(period);
      filtered = filtered.filter(f => normalize(f.period || '').includes(p));
    }

    if (query && !canonicalKey) {
      const scored = filtered
        .map(f => ({ fact: f, score: scoreFact(f, query) }))
        .filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
      return { facts: scored.map(r => r.fact) };
    }

    return { facts: filtered.slice(0, topK) };
  },
});

