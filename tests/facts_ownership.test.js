import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extractFactsForFiling } from '../dist/facts/extractFacts.js';

test('Facts: ownership extraction emits percent + 5% holder + voting power facts (when table is clean)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mastra-stanley-test-'));
  try {
    const outputDir = join(dir, 'filings', 'test');
    const chunksPath = join(outputDir, 'text_chunks.jsonl');
    const tablesManifestPath = join(outputDir, 'tables_manifest.json');
    const factsPath = join(outputDir, 'facts.json');

    await mkdir(outputDir, { recursive: true });
    await writeFile(chunksPath, '', 'utf-8');

    const tables = [
      {
        filename: 'table_001_ownership.csv',
        section: 'Principal and Selling Stockholders',
        anchor: 'own',
        source_url: 'https://example.com/s1.html',
        header: [
          'Name of Beneficial Owner',
          'Shares Beneficially Owned Before Offering',
          '% of Class',
          'Shares Beneficially Owned After Offering',
          '% of Class',
          '% of Voting Power',
        ],
        data_start_row: 1,
        rows: 3,
        cols: 6,
        data: [
          [
            'Name of Beneficial Owner',
            'Shares Beneficially Owned Before Offering',
            '% of Class',
            'Shares Beneficially Owned After Offering',
            '% of Class',
            '% of Voting Power',
          ],
          ['Alice', '1,000,000', '10.0%', '900,000', '9.0%', '20.0%'],
          ['Bob', '100,000', '1.0%', '100,000', '1.0%', '2.0%'],
        ],
      },
    ];

    await writeFile(tablesManifestPath, JSON.stringify(tables, null, 2), 'utf-8');

    const filing = {
      filingId: 'test',
      outputRoot: dir,
      outputDir,
      rawDir: join(outputDir, 'raw'),
      chunksPath,
      tablesDir: join(outputDir, 'tables'),
      tablesManifestPath,
      factsPath,
      contentListPath: join(outputDir, 'content_list.json'),
    };

    const facts = await extractFactsForFiling(filing);

    const find = (key, holder) =>
      facts.filter(f => f.canonical_key === key && f.dimensions?.holder === holder);

    assert.ok(find('ownership_percent', 'Alice').some(f => f.value === '10.0%'));
    assert.ok(find('five_percent_holder', 'Alice').some(f => f.value === '10.0%'));
    assert.ok(find('voting_power_percent', 'Alice').some(f => f.value === '20.0%'));

    assert.equal(find('five_percent_holder', 'Bob').length, 0);

    const persisted = JSON.parse(await readFile(factsPath, 'utf-8'));
    assert.ok(Array.isArray(persisted));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
