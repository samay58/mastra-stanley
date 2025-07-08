import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { S1Processor } from './S1Processor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  console.log('Starting S-1 document processing...\n');

  const processor = new S1Processor(
    join(__dirname, '../../figmas1_content_list.json'),
    join(__dirname, '../../output'),
    {
      chunkSize: 512,
      chunkOverlap: 50,
      extractMetadata: true
    }
  );

  try {
    // Process the document
    const { chunks, tables } = await processor.processDocument();
    
    // Save outputs
    await processor.saveOutputs(chunks);
    
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