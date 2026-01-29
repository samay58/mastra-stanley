import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import type { ContentElement } from '../../types/index.js';

export interface HtmlToContentOptions {
  sourceUrl: string;
}

const BLOCK_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'li',
  'center',
  'div',
]);

function normalizeText(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isAllCaps(text: string): boolean {
  // Ignore strings with no letters.
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length < 6) return false;
  return letters === letters.toUpperCase();
}

function looksLikeHeading(text: string): boolean {
  if (text.length === 0) return false;
  if (text.length > 120) return false;
  return isAllCaps(text) || /^[A-Z][A-Za-z0-9 ,.'()-]{3,}$/.test(text);
}

function hasBlockChildren(node: Element): boolean {
  const children = (node.children || []).filter((c): c is Element => c.type === 'tag');
  return children.some(c => BLOCK_TAGS.has((c.name || '').toLowerCase()));
}

function getNodeIdAnchor(node: Element): string | undefined {
  const id = node.attribs?.id?.trim();
  if (id && id.length > 0) return id;
  return undefined;
}

function getNamedAnchor(node: Element): string | undefined {
  if ((node.name || '').toLowerCase() !== 'a') return undefined;
  const nameAttr = node.attribs?.name?.trim();
  const idAttr = node.attribs?.id?.trim();
  return (nameAttr && nameAttr.length > 0 ? nameAttr : undefined) || (idAttr && idAttr.length > 0 ? idAttr : undefined);
}

function isDataTable($: cheerio.CheerioAPI, tableNode: Element): boolean {
  const $table = $(tableNode);
  const rows = $table.find('tr');
  if (rows.length < 3) return false;

  const cells = $table.find('td,th');
  const totalCells = cells.length;
  if (totalCells < 8) return false;

  const sampleSize = Math.min(totalCells, 200);
  let numericCells = 0;
  let maxCols = 0;
  let hasTh = false;

  rows
    .toArray()
    .slice(0, 20)
    .forEach(tr => {
      const cols = $(tr).find('td,th').length;
      if (cols > maxCols) maxCols = cols;
    });

  hasTh = $table.find('th').length > 0;

  for (let i = 0; i < sampleSize; i++) {
    const txt = normalizeText($(cells.get(i)).text());
    if (!txt) continue;
    if (/\d/.test(txt) && txt.length <= 32) numericCells++;
  }

  if (maxCols < 2) return false;

  const density = numericCells / sampleSize;
  if (density >= 0.2) return true;
  if (hasTh && density >= 0.12) return true;

  const caption = normalizeText($table.find('caption').first().text());
  if (/consolidated|unaudited|revenue|cash flows|balance sheets|operations/i.test(caption)) {
    return true;
  }

  return false;
}

export function extractContentElementsFromHtml(html: string, options: HtmlToContentOptions): ContentElement[] {
  const $ = cheerio.load(html);

  $('script,style,noscript').remove();

  const elements: ContentElement[] = [];
  const body = $('body').get(0);
  if (!body) {
    throw new Error('HTML has no <body>');
  }

  let currentAnchor: string | undefined;
  let lastText: string | undefined;

  function pushText(text: string, node: Element): void {
    const normalized = normalizeText(text);
    if (!normalized) return;
    if (normalized === lastText) return;
    lastText = normalized;

    const tag = (node.name || '').toLowerCase();
    const nodeAnchor = getNodeIdAnchor(node);
    const anchor = nodeAnchor || currentAnchor;

    let textLevel: number | undefined;
    if (/^h[1-6]$/.test(tag)) {
      textLevel = Number(tag.slice(1));
    } else if (looksLikeHeading(normalized)) {
      textLevel = 1;
    }

    elements.push({
      type: 'text',
      text: normalized,
      text_level: textLevel,
      anchor,
      source_url: options.sourceUrl,
      page_idx: 0,
    });
  }

  function pushTable(tableNode: Element): void {
    const $table = $(tableNode);
    const outer = $.html(tableNode);
    const caption = normalizeText($table.find('caption').first().text());

    const tableAnchor = getNodeIdAnchor(tableNode) || currentAnchor;

    elements.push({
      type: 'table',
      anchor: tableAnchor,
      source_url: options.sourceUrl,
      table_caption: caption ? [caption] : [],
      table_footnote: [],
      table_body: `<html><body>${outer}</body></html>`,
      page_idx: 0,
    });
  }

  function walk(node: AnyNode): void {
    if (node.type === 'tag') {
      const el = node as Element;
      const tag = (el.name || '').toLowerCase();

      const named = getNamedAnchor(el);
      if (named) {
        currentAnchor = named;
      }

      if (tag === 'table') {
        if (isDataTable($, el)) {
          pushTable(el);
          return; // Don’t double-extract table content as text.
        }
        // Layout table: traverse children for text.
      }

      if (BLOCK_TAGS.has(tag) && !hasBlockChildren(el)) {
        // Prefer direct block nodes to avoid duplicates from nested containers.
        pushText($(el).text(), el);
        return;
      }
    }

    // Depth-first traversal preserves doc order.
    const kids = (node as any).children as AnyNode[] | undefined;
    if (!kids) return;
    for (const child of kids) {
      walk(child);
    }
  }

  walk(body);

  return elements;
}
