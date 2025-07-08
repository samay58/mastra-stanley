# IPO S-1 Agent

An intelligent agent for parsing, analyzing, and querying IPO S-1 filing documents using the Mastra framework.

## Overview

This project implements a lightweight S-1 document agent that can:
- Parse and chunk S-1 documents into semantically meaningful pieces
- Extract and process financial tables separately
- Generate embeddings for efficient vector search
- Answer complex queries about IPO filings with citations
- Use advanced RAG techniques including re-ranking

## Architecture

- **S1Processor**: Parses JSON data and creates hierarchical chunks
- **Vector Storage**: Uses pgvector or Pinecone for embedding storage  
- **S1QueryAgent**: Specialized Mastra agent for S-1 analysis
- **Query Workflow**: Multi-step retrieval and response generation

## Prerequisites

- Node.js 18+ 
- PostgreSQL with pgvector extension (or Pinecone account)
- OpenAI API key

## Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and add:
   - `OPENAI_API_KEY`: Your OpenAI API key
   - `POSTGRES_CONNECTION_STRING`: PostgreSQL connection string

## Usage

### Current Status ✅
The system is **operational** with the following components working:
- ✅ Document processing complete (575 chunks, 71 tables)
- ✅ Embeddings generated and stored
- ✅ Basic queries working with cited responses
- ⚠️ Workflow mode has a runtime error

### 1. Process S-1 Document (Completed ✅)

```bash
npm run process-s1
```

This has been completed and generated:
- 575 text chunks with hierarchical metadata
- 71 tables extracted as CSV files
- Output stored in `output/` directory

### 2. Generate Embeddings (Completed ✅)

```bash
npm run embed
```

All 575 chunks have been embedded using OpenAI text-embedding-3-small and stored in the `s1_embeddings` PostgreSQL index.

### 3. Query the Document (Working ✅)

Run queries against the S-1 document:

```bash
# Basic queries (working)
npm run query "What is Figma's IPO price range?"
npm run query "Who are the key executives?"
npm run query "What are the main revenue sources?"

# Workflow queries (has error)
npm run query "What are the main risk factors?" --workflow
```

**Example Response:**
```
Question: What is Figma's IPO price range?
Answer: Figma's IPO price range is set with a midpoint of $9 per share...
Citation: see "Use of Proceeds," page 113
```

### 4. Start Mastra Dev Server (Untested)

For API access:

```bash
npx mastra dev
```

The agents should be available at `http://localhost:4111/api/agents/`

## Project Structure

```
ipo-agent/
├── src/
│   ├── processor/      # Document processing
│   ├── embeddings/     # Embedding generation
│   ├── agents/         # Mastra agents
│   ├── workflows/      # Query workflows
│   ├── tools/          # Vector search tools
│   └── types/          # TypeScript types
├── output/            # Processed chunks and tables (575 chunks)
├── session-logs/      # Development session history
├── docs/              # Original S-1 data
└── figmas1_content_list.json  # Source data (677KB)
```

## Key Features

### Hierarchical Chunking
- Preserves document structure with section paths
- Maintains context across chunks
- Optimal 512 token chunks with overlap

### Table Processing
- Extracts HTML tables to CSV format
- Maintains table references in text chunks
- Enables structured data queries

### Advanced RAG
- Semantic search with metadata filtering
- Re-ranking for improved relevance
- Multi-step workflows for complex queries

### Citations & Confidence
- Returns section and page citations
- Provides confidence scores
- Distinguishes text vs table sources

## Example Queries

```javascript
// Financial metrics
"What were Figma's revenues for the last three years?"

// Risk analysis
"What are the top risks related to competition?"

// Management info
"Who are the key executives and their compensation?"

// Complex analysis
"Compare Figma's growth rate to its market opportunity"
```

## Development

### Adding New Tools

Create tools in `src/tools/`:

```typescript
export const myTool = createTool({
  id: 'myTool',
  description: 'Tool description',
  inputSchema: z.object({...}),
  outputSchema: z.object({...}),
  execute: async ({ context }) => {...}
});
```

### Creating Workflows

Add workflows in `src/workflows/`:

```typescript
export const myWorkflow = createWorkflow({
  id: 'my-workflow',
  inputSchema: z.object({...}),
  outputSchema: z.object({...})
})
  .then(step1)
  .then(step2)
  .commit();
```

## Troubleshooting

### Known Issues

#### Workflow Mode Error ⚠️
```bash
npm run query "question" --workflow
# Error: content.map is not a function
```
**Status**: Under investigation  
**Workaround**: Use basic queries without `--workflow` flag

#### Query Response Time
Basic queries may take 20-30 seconds to complete.

### PostgreSQL Setup ✅

PostgreSQL with pgvector is currently operational. If you need to reinstall:

```sql
CREATE EXTENSION vector;
```

See `PGVECTOR_SETUP.md` for complete setup instructions.

### Rate Limits

The embedding generation includes delays to avoid OpenAI rate limits. Adjust batch size in `EmbeddingGenerator` if needed.

### Memory Issues

For large documents, the processor handles streaming automatically. Chunks are processed in batches.

## License

MIT

## Contributing

Pull requests welcome! Please ensure:
- Code follows TypeScript best practices
- New features include tests
- Documentation is updated

## Acknowledgments

Built with [Mastra](https://mastra.ai) - The TypeScript framework for AI applications.