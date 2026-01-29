import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import * as cheerio from 'cheerio';
import type { EdgarDocument, EdgarFilingRef } from './types.js';

const SEC_HOST = 'https://www.sec.gov';
const ARCHIVES_BASE = `${SEC_HOST}/Archives/edgar/data`;

export interface EdgarFetchOptions {
  userAgent: string;
  forceDownload?: boolean;
  maxRetries?: number;
}

export interface EdgarFilingUrls {
  baseDirUrl: string;
  indexHtmlUrl: string;
  indexJsonUrl: string;
}

export function normalizeCik(cik: string): { cik10: string; cikPath: string } {
  const digits = cik.replace(/\D/g, '');
  if (digits.length === 0) {
    throw new Error(`Invalid CIK "${cik}"`);
  }

  const cik10 = digits.padStart(10, '0');
  const cikPath = String(parseInt(digits, 10)); // SEC paths omit leading zeros.
  return { cik10, cikPath };
}

export function normalizeAccession(accession: string): { accession: string; accessionNoDashes: string } {
  const trimmed = accession.trim();
  const accessionNoDashes = trimmed.replace(/-/g, '');

  if (!/^\d{18}$/.test(accessionNoDashes)) {
    throw new Error(
      `Invalid accession "${accession}". Expected format like 0000000000-00-000000 (18 digits total).`
    );
  }

  // Preserve dashed format if provided, else reconstruct.
  const accessionDashed =
    trimmed.includes('-') ? trimmed : `${accessionNoDashes.slice(0, 10)}-${accessionNoDashes.slice(10, 12)}-${accessionNoDashes.slice(12)}`;

  return { accession: accessionDashed, accessionNoDashes };
}

export function buildFilingUrls(ref: EdgarFilingRef): EdgarFilingUrls {
  const { cikPath } = normalizeCik(ref.cik);
  const { accession, accessionNoDashes } = normalizeAccession(ref.accession);

  const baseDirUrl = `${ARCHIVES_BASE}/${cikPath}/${accessionNoDashes}/`;
  return {
    baseDirUrl,
    indexHtmlUrl: `${baseDirUrl}${accession}-index.html`,
    indexJsonUrl: `${baseDirUrl}index.json`,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchTextWithRetry(url: string, options: EdgarFetchOptions): Promise<string> {
  const maxRetries = options.maxRetries ?? 4;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': options.userAgent,
          'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8',
        },
      });

      if (res.status === 429 || res.status === 503) {
        const retryAfter = res.headers.get('retry-after');
        const backoffMs = retryAfter ? Number(retryAfter) * 1000 : 500 * Math.pow(2, attempt);
        await sleep(Math.min(backoffMs, 8000));
        continue;
      }

      if (!res.ok) {
        throw new Error(`SEC fetch failed: ${res.status} ${res.statusText}`);
      }

      return await res.text();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await sleep(250 * Math.pow(2, attempt));
        continue;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${url}`);
}

export async function fetchTextCached(
  url: string,
  cachePath: string,
  options: EdgarFetchOptions
): Promise<string> {
  if (!options.forceDownload) {
    try {
      return await readFile(cachePath, 'utf-8');
    } catch {
      // Cache miss; fetch below.
    }
  }

  await mkdir(dirname(cachePath), { recursive: true });
  const text = await fetchTextWithRetry(url, options);
  await writeFile(cachePath, text, 'utf-8');
  return text;
}

export function parseIndexHtmlForDocuments(indexHtml: string, baseDirUrl: string): EdgarDocument[] {
  const $ = cheerio.load(indexHtml);
  const tables = $('table');

  const docTable = tables
    .toArray()
    .map(t => $(t))
    .find($t => {
      const headers = $t
        .find('tr')
        .first()
        .find('th')
        .toArray()
        .map(th => $(th).text().trim().toLowerCase());
      return headers.includes('document') && headers.includes('type');
    });

  if (!docTable) {
    throw new Error('Could not find "Document Format Files" table in SEC index page.');
  }

  const documents: EdgarDocument[] = [];
  docTable
    .find('tr')
    .slice(1)
    .toArray()
    .forEach(tr => {
      const $tr = $(tr);
      const tds = $tr.find('td').toArray().map(td => $(td));
      if (tds.length < 2) return;

      const link = tds[0].find('a').first();
      const href = link.attr('href')?.trim();
      const filename = (href ? (href.split('/').pop() ?? '') : link.text()).trim();
      const type = tds[1].text().trim();
      const description = tds.length >= 3 ? tds[2].text().trim() : undefined;

      if (!filename || !type) return;

      const url = href
        ? href.startsWith('http')
          ? href
          : href.startsWith('/')
            ? `${SEC_HOST}${href}`
            : `${baseDirUrl}${href}`
        : `${baseDirUrl}${filename}`;

      documents.push({ filename, type, description, url });
    });

  return documents;
}

export function selectPrimaryS1Document(documents: EdgarDocument[]): EdgarDocument {
  const preferred = documents.find(d => /^S-1(\/A)?$/i.test(d.type.trim()));
  if (preferred) return preferred;

  const anyS1 = documents.find(d => /^S-1/i.test(d.type.trim()));
  if (anyS1) return anyS1;

  const byDescription = documents.find(d => (d.description || '').toLowerCase().includes('form s-1'));
  if (byDescription) return byDescription;

  const htmlish = documents.find(d => /\.html?$/i.test(d.filename));
  if (htmlish) return htmlish;

  throw new Error('Could not identify a primary S-1 HTML document from the SEC index listing.');
}
