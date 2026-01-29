import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { S1Processor } from '../dist/processor/S1Processor.js';

test('S1Processor: semantic splitting does not emit tail-overlap chunks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mastra-stanley-test-'));
  try {
    const contentListPath = join(dir, 'content_list.json');
    const outputDir = join(dir, 'out');

    // A single long block with overlap configured would previously emit ~overlap
    // near-duplicate tail chunks. We keep this deterministic and small.
    const text = 'A'.repeat(250);
    await writeFile(
      contentListPath,
      JSON.stringify(
        [
          {
            type: 'text',
            text,
            page_idx: 0,
          },
        ],
        null,
        2
      ),
      'utf-8'
    );

    const processor = new S1Processor(
      contentListPath,
      outputDir,
      { chunkSize: 100, chunkOverlap: 50, extractMetadata: true },
      { filingId: 'test' }
    );

    const { chunks, tables } = await processor.processDocument();
    assert.equal(tables.length, 0);

    // Expected behavior: 4 chunks (0-100, 50-150, 100-200, 150-250).
    // This is the regression guard.
    assert.equal(chunks.length, 4);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('S1Processor: detects table title/header/data-start for a numeric table', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mastra-stanley-test-'));
  try {
    const contentListPath = join(dir, 'content_list.json');
    const outputDir = join(dir, 'out');

    const tableBody =
      '<html><body><table>' +
      '<tr><td colspan="3">Consolidated Statements of Operations</td></tr>' +
      '<tr><td></td><td>2023</td><td>2024</td></tr>' +
      '<tr><td>Revenue</td><td>$ 1,000</td><td>$ 2,000</td></tr>' +
      '<tr><td>Net loss</td><td>(100)</td><td>(200)</td></tr>' +
      '</table></body></html>';

    await writeFile(
      contentListPath,
      JSON.stringify(
        [
          {
            type: 'table',
            table_body: tableBody,
            table_caption: [],
            table_footnote: [],
            page_idx: 0,
          },
        ],
        null,
        2
      ),
      'utf-8'
    );

    const processor = new S1Processor(
      contentListPath,
      outputDir,
      { chunkSize: 500, chunkOverlap: 0, extractMetadata: true },
      { filingId: 'test' }
    );

    const { chunks, tables } = await processor.processDocument();
    assert.equal(tables.length, 1);

    const table = tables[0];
    assert.equal(table.title, 'Consolidated Statements of Operations');
    assert.deepEqual(table.header?.slice(0, 3), ['Row', '2023', '2024']);
    assert.equal(table.data_start_row, 2);

    const tableChunk = chunks.find(c => c.metadata.chunk_type === 'table_reference');
    assert.ok(tableChunk, 'expected a table_reference chunk to be created');
    assert.ok(
      tableChunk.content.includes('| Row | 2023 | 2024 |'),
      'expected table chunk markdown preview to use detected header row'
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('S1Processor: section_path metadata is not mutated by later headings', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mastra-stanley-test-'));
  try {
    const contentListPath = join(dir, 'content_list.json');
    const outputDir = join(dir, 'out');

    await writeFile(
      contentListPath,
      JSON.stringify(
        [
          { type: 'text', text: 'RISK FACTORS', text_level: 1, page_idx: 0 },
          { type: 'text', text: 'Intro paragraph.', page_idx: 0 },
          { type: 'text', text: 'We may not succeed.', text_level: 1, page_idx: 0 },
          { type: 'text', text: 'Body paragraph.', page_idx: 0 },
        ],
        null,
        2
      ),
      'utf-8'
    );

    const processor = new S1Processor(
      contentListPath,
      outputDir,
      { chunkSize: 500, chunkOverlap: 0, extractMetadata: true },
      { filingId: 'test' }
    );

    const { chunks } = await processor.processDocument();

    const introChunk = chunks.find(c => c.content.includes('Intro paragraph.'));
    assert.ok(introChunk, 'expected intro chunk');
    assert.deepEqual(introChunk.metadata.section_path, ['RISK FACTORS']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
