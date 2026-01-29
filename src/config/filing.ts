import { join, resolve } from 'path';

export interface FilingContext {
  filingId: string;
  outputRoot: string;
  outputDir: string;
  rawDir: string;
  chunksPath: string;
  tablesDir: string;
  tablesManifestPath: string;
  sectionsManifestPath: string;
  factsPath: string;
  contentListPath: string;
}

function sanitizeFilingId(filingId: string): string {
  // Keep filenames predictable across platforms.
  return filingId.trim().replace(/[^a-zA-Z0-9._-]/g, '-');
}

export function getOutputRoot(): string {
  return resolve(process.cwd(), process.env.S1_OUTPUT_ROOT?.trim() || 'output');
}

export function getActiveFilingId(): string {
  const raw = process.env.S1_FILING_ID?.trim();
  return sanitizeFilingId(raw && raw.length > 0 ? raw : 'figma');
}

export function getFilingContext(filingId: string): FilingContext {
  const safeId = sanitizeFilingId(filingId);
  const outputRoot = getOutputRoot();
  const outputDir = join(outputRoot, 'filings', safeId);

  return {
    filingId: safeId,
    outputRoot,
    outputDir,
    rawDir: join(outputDir, 'raw'),
    chunksPath: join(outputDir, 'text_chunks.jsonl'),
    tablesDir: join(outputDir, 'tables'),
    tablesManifestPath: join(outputDir, 'tables_manifest.json'),
    sectionsManifestPath: join(outputDir, 'sections_manifest.json'),
    factsPath: join(outputDir, 'facts.json'),
    contentListPath: join(outputDir, 'content_list.json'),
  };
}

export function getActiveFilingContext(): FilingContext {
  return getFilingContext(getActiveFilingId());
}
