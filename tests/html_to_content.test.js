import test from 'node:test';
import assert from 'node:assert/strict';

import { extractContentElementsFromHtml } from '../dist/ingest/edgar/htmlToContent.js';

test('extractContentElementsFromHtml: propagates named anchors and prefers node id anchors', () => {
  const html =
    '<html><body>' +
    '<a name="sec1"></a>' +
    '<h1>PROSPECTUS SUMMARY</h1>' +
    '<p>Intro paragraph.</p>' +
    '<p id="p1">Node id wins.</p>' +
    '<a name="tbl1"></a>' +
    '<table>' +
    '<tr><th>Item</th><th>2023</th><th>2024</th><th>2025</th></tr>' +
    '<tr><td>Revenue</td><td>$1</td><td>$2</td><td>$3</td></tr>' +
    '<tr><td>Net loss</td><td>(1)</td><td>(2)</td><td>(3)</td></tr>' +
    '</table>' +
    '<a name="sec2"></a>' +
    '<p>RISK FACTORS</p>' +
    '<p>We may not succeed.</p>' +
    '</body></html>';

  const elements = extractContentElementsFromHtml(html, { sourceUrl: 'https://example.com/s1.html' });

  const prospectus = elements.find(e => e.type === 'text' && e.text === 'PROSPECTUS SUMMARY');
  assert.ok(prospectus, 'expected a Prospectus Summary text element');
  assert.equal(prospectus.anchor, 'sec1');

  const intro = elements.find(e => e.type === 'text' && e.text === 'Intro paragraph.');
  assert.ok(intro, 'expected an intro paragraph element');
  assert.equal(intro.anchor, 'sec1');

  const nodeId = elements.find(e => e.type === 'text' && e.text === 'Node id wins.');
  assert.ok(nodeId, 'expected a node id paragraph element');
  assert.equal(nodeId.anchor, 'p1');

  const table = elements.find(e => e.type === 'table');
  assert.ok(table, 'expected a table element');
  assert.equal(table.anchor, 'tbl1');

  const riskFactors = elements.find(e => e.type === 'text' && e.text === 'RISK FACTORS');
  assert.ok(riskFactors, 'expected a Risk Factors heading element');
  assert.equal(riskFactors.anchor, 'sec2');

  const riskBody = elements.find(e => e.type === 'text' && e.text === 'We may not succeed.');
  assert.ok(riskBody, 'expected a Risk Factors body paragraph');
  assert.equal(riskBody.anchor, 'sec2');
});
