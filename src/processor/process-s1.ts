import { join } from 'path';
import { S1Processor } from './S1Processor.js';
import { getActiveFilingContext } from '../config/filing.js';

async function main() {
  console.log('Starting S-1 document processing...\n');

  const filing = getActiveFilingContext();
  const contentListPath = process.env.S1_CONTENT_LIST_PATH
    ? join(process.cwd(), process.env.S1_CONTENT_LIST_PATH)
    : join(process.cwd(), 'figmas1_content_list.json');

  const processor = new S1Processor(
    contentListPath,
    filing.outputDir,
    {
      chunkSize: process.env.S1_CHUNK_SIZE ? Number(process.env.S1_CHUNK_SIZE) : 1800,
      chunkOverlap: process.env.S1_CHUNK_OVERLAP ? Number(process.env.S1_CHUNK_OVERLAP) : 300,
      extractMetadata: true
    },
    {
      filingId: filing.filingId,
      sourceUrl: process.env.S1_SOURCE_URL
    }
  );

  try {
    // Process the document
    const { chunks, tables } = await processor.processDocument();
    
    // Save outputs
    await processor.saveOutputs(chunks, tables);
    
    // Print summary
    console.log('\n=== Processing Complete! ===');
    console.log(`Total chunks created: ${chunks.length}`);
    console.log(`Total tables extracted: ${tables.length}`);
    console.log(`Average chunk size: ${Math.round(chunks.reduce((acc, c) => acc + c.metadata.chunk_size, 0) / chunks.length)} characters`);
    
    // Show sample chunks
    console.log('\nSample chunks:');
    chunks.slice(0, 3).forEach(chunk => {
      console.log(`- ${chunk.id}: ${chunk.metadata.section_hierarchy} (${chunk.metadata.chunk_size} chars)`);
    });

  } catch (error) {
    console.error('Error processing S-1 document:', error);
    process.exit(1);
  }
}

// Run the processor
main().catch(console.error);
