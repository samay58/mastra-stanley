// IPO S-1 Agent - Main Entry Point

export * from './mastra/index.js';
export * from './agents/s1QueryAgent.js';
export * from './workflows/s1QueryWorkflow.js';
export * from './tools/vectorQuery.js';
export * from './processor/S1Processor.js';
export { EmbeddingGenerator } from './embeddings/generate-embeddings.js';
export { queryS1 } from './query.js';
export * from './types/index.js';

console.log(`
╔═══════════════════════════════════════╗
║       IPO S-1 Agent - Mastra          ║
╠═══════════════════════════════════════╣
║  Intelligent S-1 Document Analysis    ║
║  Powered by Mastra Framework          ║
╚═══════════════════════════════════════╝

Available commands:
- npm run process-s1    : Process S-1 document into chunks
- npm run embed        : Generate embeddings (requires pgvector)
- npm run query        : Run example queries
- npx mastra dev      : Start Mastra dev server

For queries:
- npm run query "Your question here"
- npm run query "Your question here" --workflow

Documentation: See README.md
`);