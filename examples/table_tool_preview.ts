/**
 * Table Tool Preview
 *
 * What: Exercises the S-1 table data tool with a few scenarios.
 * Why: Validate table extraction, cleaning, and metadata.
 * Run: `npx tsx examples/table_tool_preview.ts`
 * Reqs: `OPENAI_API_KEY`, `POSTGRES_CONNECTION_STRING` in `.env`.
 * Tip: Run `npm run embed` once to prepare vector data.
 */

import dotenv from 'dotenv';
dotenv.config();

import { s1TableDataTool } from '../src/tools/vectorQuery.js';

async function main() {
  console.log('🧪 Table Tool Preview\n');

  const testCases = [
    {
      name: 'Revenue rows in operations-related tables',
      params: { keyword: 'operations', rowFilter: 'revenue', cleanData: true },
    },
    {
      name: 'Specific financial table #9',
      params: { tableNumber: 9, cleanData: true },
    },
    {
      name: 'Summary financial table #2',
      params: { tableNumber: 2, cleanData: true },
    },
  ];

  for (const testCase of testCases) {
    console.log(`\n📊 Test Case: ${testCase.name}`);
    console.log('='.repeat(60));

    try {
      const result = await s1TableDataTool.execute({ context: testCase.params });

      console.log(`✅ Found ${result.tableData.length} table(s)`);

      if (result.summary) {
        console.log(`📋 Summary: ${result.summary}`);
      }

      for (const table of result.tableData) {
        console.log(`\n📄 Table ${table.tableNumber}: ${table.description}`);

        if (table.headers) {
          console.log(`📝 Headers: ${table.headers.join(' | ')}`);
        }

        if (table.cleanedData) {
          console.log('📊 Cleaned Data:');
          table.cleanedData.slice(0, 5).forEach((row) => {
            console.log(`  ${row.rowLabel}: ${row.values.join(' | ')}`);
            if ((row as any).yearData) {
              const yearData = (row as any).yearData as Record<string, string>;
              console.log(
                `    Year Data: ${Object.entries(yearData)
                  .map(([year, value]) => `${year}: ${value}`)
                  .join(', ')}`,
              );
            }
          });

          if (table.cleanedData.length > 5) {
            console.log(`  ... and ${table.cleanedData.length - 5} more rows`);
          }
        }
      }
    } catch (error) {
      console.error('❌ Error:', error);
    }

    console.log('\n' + '-'.repeat(60));
  }
}

main().catch(console.error);

