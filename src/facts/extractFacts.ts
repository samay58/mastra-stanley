import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'fs/promises';

import type { FilingContext } from '../config/filing.js';
import type { Chunk, TableData } from '../types/index.js';
import type { Fact, FactEvidence } from './types.js';

function isoNow(): string {
  return new Date().toISOString();
}

function stableHash(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 12);
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeRowLabel(label: string): string {
  return normalizeWhitespace(label)
    .replace(/\.\.\.+/g, ' ') // dot leaders
    .replace(/\(\s*\d+\s*\)/g, '') // (1) footnotes
    .replace(/\s+/g, ' ')
    .trim();
}

function extractNumericLikeTokens(cellRaw: string): string[] {
  const cell = normalizeWhitespace(cellRaw)
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')');

  // Pull out number-ish tokens; keep punctuation for evidence but ensure at least one digit.
  const matches = cell.match(/(?:\(|-)?\s*\$?\s*\d[\d,\.]*%?\s*\)?/g) || [];
  return matches.map(t => normalizeWhitespace(t)).filter(t => /\d/.test(t));
}

function pickSingleNumericToken(cellRaw: string): string | null {
  const tokens = extractNumericLikeTokens(cellRaw);
  if (tokens.length !== 1) return null;
  return tokens[0];
}

function inferUnitAndScale(table: TableData): { unit?: string; scale?: string } {
  const haystack = [
    table.title,
    table.caption,
    ...(Array.isArray(table.header) ? table.header : []),
    ...table.data.slice(0, Math.min(6, table.data.length)).flatMap(r => (Array.isArray(r) ? r : [])),
  ]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join(' ')
    .toLowerCase();

  const unit = /\$|dollars?|usd/i.test(haystack) ? '$' : undefined;
  const scale = /in thousands/i.test(haystack)
    ? 'thousands'
    : /in millions/i.test(haystack)
      ? 'millions'
      : /in billions/i.test(haystack)
        ? 'billions'
        : undefined;
  return { unit, scale };
}

function buildFactId(filingId: string, canonicalKey: string, value: string, period?: string, dims?: Record<string, string>): string {
  const payload = JSON.stringify({ filingId, canonicalKey, value, period, dims: dims || {} });
  return `${filingId}:${canonicalKey}:${stableHash(payload)}`;
}

function dedupeFacts(facts: Fact[]): Fact[] {
  const seen = new Set<string>();
  const out: Fact[] = [];
  for (const fact of facts) {
    const key = JSON.stringify({
      filing_id: fact.filing_id,
      fact_type: fact.fact_type,
      canonical_key: fact.canonical_key,
      value: fact.value,
      unit: fact.unit,
      period: fact.period,
      dimensions: fact.dimensions || {},
      // Evidence can differ; dedupe on claim, keep the first.
    });
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fact);
  }
  return out;
}

export async function loadChunksFromJsonl(path: string): Promise<Chunk[]> {
  const raw = await readFile(path, 'utf-8');
  const lines = raw.split('\n').filter(line => line.trim().length > 0);
  const chunks: Chunk[] = [];
  for (const line of lines) {
    try {
      chunks.push(JSON.parse(line) as Chunk);
    } catch {
      // Skip malformed lines.
    }
  }
  return chunks;
}

export async function loadTablesManifest(path: string): Promise<TableData[]> {
  const raw = await readFile(path, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed as TableData[];
}

function extractFinancialFactsFromTables(filingId: string, tables: TableData[]): Fact[] {
  const facts: Fact[] = [];

  const metricMatchers: Array<{
    canonical_key: string;
    rowMatch: (rowLabel: string) => boolean;
  }> = [
    {
      canonical_key: 'revenue',
      rowMatch: row => /\brevenue\b/i.test(row) && !/\bcost\b/i.test(row),
    },
    {
      canonical_key: 'gross_profit',
      rowMatch: row => /\bgross profit\b/i.test(row),
    },
    {
      canonical_key: 'total_operating_expenses',
      rowMatch: row => /\btotal operating expenses\b/i.test(row),
    },
    {
      canonical_key: 'net_income_loss',
      rowMatch: row => /\bnet (income|loss)\b/i.test(row),
    },
    {
      canonical_key: 'cash_and_cash_equivalents',
      rowMatch: row => /\bcash and cash equivalents\b/i.test(row),
    },
  ];

  for (const table of tables) {
    const header = Array.isArray(table.header) ? table.header : undefined;
    if (!header || header.length < 3) continue;

    const { unit, scale } = inferUnitAndScale(table);
    const dataStart = Number.isFinite(table.data_start_row) ? (table.data_start_row as number) : 0;
    const dataRows = table.data.slice(dataStart).filter((row): row is string[] => Array.isArray(row));

    // Skip clearly percentage-only tables for currency facts.
    const sampleCell = dataRows.find(r => r.length > 2)?.[1];
    const sampleTokens = sampleCell ? extractNumericLikeTokens(sampleCell) : [];
    const sampleLooksPercent = sampleTokens.some(t => t.includes('%'));

    for (const metric of metricMatchers) {
      if (metric.canonical_key !== 'net_income_loss' && metric.canonical_key !== 'cash_and_cash_equivalents') {
        // allow for balance sheet / cash flow tables too; we just want to skip percent-only tables.
        if (sampleLooksPercent && metric.canonical_key !== 'net_income_loss') {
          // Net income/loss might legitimately be shown as a percent in MD&A; we still avoid it here.
        }
      }

      const row = dataRows.find(r => metric.rowMatch(normalizeRowLabel(String(r[0] || ''))));
      if (!row) continue;

      for (let col = 1; col < Math.min(row.length, header.length); col++) {
        const periodLabel = normalizeWhitespace(String(header[col] || ''));
        if (!periodLabel) continue;

        const cellValue = String(row[col] || '').trim();
        if (!cellValue) continue;

        const token = pickSingleNumericToken(cellValue);
        if (!token) continue;

        // Avoid misclassifying percent tables as currency.
        if (token.includes('%') && metric.canonical_key !== 'net_income_loss') continue;

        const evidence: FactEvidence = {
          type: 'table_cell',
          source_url: table.source_url,
          anchor: table.anchor,
          table_filename: table.filename,
          table_caption: table.caption,
          row_index: dataStart + dataRows.indexOf(row),
          col_index: col,
          row_label: normalizeRowLabel(String(row[0] || '')),
          column_label: periodLabel,
          quote: `${normalizeRowLabel(String(row[0] || ''))} | ${periodLabel}: ${token}`,
        };

        const dimensions: Record<string, string> = {};
        if (scale) dimensions.scale = scale;

        const value = token;
        const period = periodLabel;

        facts.push({
          fact_id: buildFactId(filingId, metric.canonical_key, value, period, dimensions),
          filing_id: filingId,
          fact_type: 'financial_metric',
          canonical_key: metric.canonical_key,
          value,
          unit,
          period,
          dimensions: Object.keys(dimensions).length > 0 ? dimensions : undefined,
          evidence: [evidence],
          created_at: isoNow(),
        });
      }
    }
  }

  return facts;
}

function quoteSnippet(text: string, matchIndex: number, matchLength: number): string {
  const radius = 180;
  const start = Math.max(0, matchIndex - radius);
  const end = Math.min(text.length, matchIndex + matchLength + radius);
  return normalizeWhitespace(text.slice(start, end));
}

function extractOfferingTermsFromChunks(filingId: string, chunks: Chunk[]): Fact[] {
  const facts: Fact[] = [];

  const patterns: Array<{
    canonical_key: string;
    fact_type: 'offering_terms';
    regex: RegExp;
    unit?: string;
    valueFromMatch: (m: RegExpMatchArray) => string | null;
    period?: string;
  }> = [
    {
      canonical_key: 'ipo_price_range',
      fact_type: 'offering_terms',
      regex: /expected to be between\s*\$\s*([\d,.]+)\s*and\s*\$\s*([\d,.]+)/i,
      unit: '$',
      valueFromMatch: m => `between $${m[1]} and $${m[2]}`,
    },
    {
      canonical_key: 'primary_shares_offered',
      fact_type: 'offering_terms',
      regex: /we are offering\s*([\d,]+)\s*shares/i,
      unit: 'shares',
      valueFromMatch: m => m[1] || null,
    },
    {
      canonical_key: 'secondary_shares_offered',
      fact_type: 'offering_terms',
      regex: /selling stockholders are offering\s*([\d,]+)\s*shares/i,
      unit: 'shares',
      valueFromMatch: m => m[1] || null,
    },
    {
      canonical_key: 'greenshoe_shares',
      fact_type: 'offering_terms',
      regex: /underwriters[^.]{0,400}option[^.]{0,400}purchase[^.]{0,400}up to\s*([\d,]+)\s*additional shares/i,
      unit: 'shares',
      valueFromMatch: m => m[1] || null,
    },
  ];

  for (const chunk of chunks) {
    const text = chunk.content || '';
    if (!text) continue;

    for (const p of patterns) {
      const m = text.match(p.regex);
      if (!m) continue;

      const value = p.valueFromMatch(m);
      if (!value) continue;

      const idx = m.index ?? text.toLowerCase().indexOf(String(m[0] || '').toLowerCase());
      const evidence: FactEvidence = {
        type: 'text_quote',
        chunk_id: chunk.id,
        source_url: chunk.metadata?.source_url,
        anchor: chunk.metadata?.anchor,
        section_hierarchy: chunk.metadata?.section_hierarchy,
        quote: quoteSnippet(text, Math.max(0, idx), String(m[0] || '').length),
      };

      facts.push({
        fact_id: buildFactId(filingId, p.canonical_key, value, p.period),
        filing_id: filingId,
        fact_type: p.fact_type,
        canonical_key: p.canonical_key,
        value,
        unit: p.unit,
        period: p.period,
        evidence: [evidence],
        created_at: isoNow(),
      });
    }
  }

  return facts;
}

function extractOwnershipFactsFromTables(_filingId: string, _tables: TableData[]): Fact[] {
  // Ownership tables vary dramatically by issuer and are often the messiest HTML in filings.
  // We intentionally keep v1 conservative: build the framework first, then add a high-precision
  // extractor once we have cleaner, real EDGAR examples to validate against.
  return [];
}

export async function extractFactsForFiling(filing: FilingContext): Promise<Fact[]> {
  const [chunks, tables] = await Promise.all([
    loadChunksFromJsonl(filing.chunksPath),
    loadTablesManifest(filing.tablesManifestPath),
  ]);

  const facts = dedupeFacts([
    ...extractFinancialFactsFromTables(filing.filingId, tables),
    ...extractOfferingTermsFromChunks(filing.filingId, chunks),
    ...extractOwnershipFactsFromTables(filing.filingId, tables),
  ]);

  await writeFile(filing.factsPath, JSON.stringify(facts, null, 2), 'utf-8');
  return facts;
}

