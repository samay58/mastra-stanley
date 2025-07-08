# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the **ipo-agent** repository, which implements a sophisticated IPO/S-1 document analysis system using Mastra. The agent intelligently parses, chunks, and queries S-1 documents to provide grounded, structured answers with comprehensive citations. It leverages Mastra's capabilities for agents, workflows, RAG (Retrieval-Augmented Generation), and memory to process complex financial documents with professional-grade analysis.

## Development Commands

### Core Development Workflow
```bash
# Install dependencies
npm install

# Process S-1 document into chunks (completed ✅)
npm run process-s1

# Generate embeddings (completed ✅)
npm run embed

# Query with unstructured output (working ✅)
npm run query "What is Dylan Field's ownership percentage?"

# Query with structured output and schemas (enhanced ✅)
npm run query-structured "What are the main risk factors?"

# Start Mastra development server with playground
npx mastra dev

# Access playground UI at http://localhost:4111
# API endpoints at http://localhost:4111/api/agents/

# Build TypeScript
npm run build

# Development with hot reload
npm run dev
```

### Database Requirements
PostgreSQL with pgvector extension is **operational** ✅

**Docker Setup:**
```bash
# Start PostgreSQL container
docker start ipo-agent-postgres

# Verify vector index
# Database: s1_embeddings with 575 embeddings stored
```

## Technical Architecture

### Enhanced Agent System
The system features two specialized agents with different capabilities:

**S1QueryAgent** (`src/agents/s1QueryAgent.ts`) - **Enhanced Professional Agent**
- Systematic analysis methodology with query classification
- Structured response format with confidence levels
- Advanced search strategies (ownership, financial, risk, business)
- Memory system with semantic recall and working memory
- Enhanced instruction set for regulatory document analysis

**S1BasicAgent** - **Streamlined Agent**
- Simple vector search for quick lookups
- Minimal processing overhead for basic queries

### Structured Output System (`src/schemas/s1QuerySchemas.ts`)
The system now supports structured responses using Zod schemas:

- **OwnershipQuerySchema**: For ownership percentage and voting power analysis
- **FinancialQuerySchema**: For revenue, earnings, and financial metrics  
- **RiskQuerySchema**: For risk factor analysis and categorization
- **BusinessQuerySchema**: For operations, strategy, and business model queries
- **BaseS1ResponseSchema**: For general analysis with structured citations

### Data Processing Pipeline
```
S-1 JSON (677KB) → S1Processor → 575 Chunks + 71 Tables → Embeddings → Vector DB
    ↓
Query → Agent Classification → Multi-Strategy Search → Enhanced Reranking → Structured Response
```

### Vector Search Enhancement (`src/tools/vectorQuery.ts`)
- **Intelligent Boosting**: Query-specific relevance scoring based on section metadata
- **Relevance Filtering**: Filters low-confidence results (score < 0.5)
- **Section-Aware Ranking**: Boosts results from relevant document sections
- **Enhanced Search Tool**: `s1SearchWithRerankTool` with advanced processing

### Memory and Context Management
- **PostgreSQL Storage**: Persistent conversation memory with vector embeddings
- **Semantic Recall**: Retrieves relevant previous queries and answers (topK: 5)
- **Working Memory**: Context retention for complex multi-part analysis
- **Long Context**: Maintains 20 message history for detailed financial discussions

## Query Interface Options

### 1. Unstructured Queries
```bash
npm run query "What is Figma's revenue growth rate?"
```
Returns free-form text with citations.

### 2. Structured Queries (Enhanced)
```bash
npm run query-structured "Who owns the most shares in Figma?"
```
Returns JSON with:
- `direct_answer`: Clear response
- `ownership_details`: Structured ownership data
- `supporting_evidence`: Array of citations with section/page references
- `analysis`: Expert interpretation
- `confidence_level`: High/Medium/Low assessment

### 3. Playground Interface
Access interactive testing at `http://localhost:4111` after running `npx mastra dev`

## Advanced Features

### Query Classification System
The agent automatically detects query type and applies optimized search strategies:

- **Ownership/Governance**: Uses comprehensive search with ownership-specific boosting
- **Financial Data**: Prioritizes table lookups and financial section searches
- **Risk Analysis**: Focuses on risk factor sections with categorical analysis
- **Business Operations**: Searches business model and strategy sections

### Citation System
All responses include structured citations:
```typescript
{
  section: "Risk Factors",
  page: 45,
  quote: "Competition in the design software market...",
  table_number: 12 // if applicable
}
```

### Memory-Driven Context
The system maintains context across sessions:
- Previous queries inform current analysis
- Related topics are automatically recalled
- Complex multi-part questions build on previous context

## Environment Variables Required
```bash
OPENAI_API_KEY=your_openai_api_key
POSTGRES_CONNECTION_STRING=postgresql://user:password@localhost:5432/ipo_agent
MASTRA_LOG_LEVEL=info
```

## Working with S-1 Data

### Document Structure
- **Source**: `figmas1_content_list.json` - Figma's S-1 filing (July 1, 2025)
- **Processed Output**: 575 hierarchical chunks + 71 financial tables (CSV format)
- **Metadata**: Section paths, page numbers, chunk types, timestamps

### Chunk Metadata Schema
```typescript
{
  id: string,
  section_path: string, // e.g., "RISK FACTORS > Competition Risks"
  page_idx: number,
  chunk_type: "text" | "table" | "heading",
  timestamp: string,
  chunk_size: number
}
```

### File Size Considerations
The source JSON is 677KB. Use streaming/pagination when processing programmatically.

## Current Project Status

**Core System**: Production-ready ✅  
**Database**: PostgreSQL + pgvector operational ✅  
**Embeddings**: All 575 chunks embedded ✅  
**Enhanced Agent**: Professional-grade analysis with structured output ✅  
**Memory System**: Context retention and semantic recall ✅  
**Playground**: Interactive testing environment ✅  
**Structured Schemas**: Type-safe response formats ✅

## Development Notes

### Project Structure
```
src/
├── agents/         # Enhanced S-1 analysis agents with memory
├── schemas/        # Zod schemas for structured output
├── tools/          # Vector search with intelligent boosting
├── processor/      # Document parsing and chunking
├── embeddings/     # Vector embedding generation
├── workflows/      # Multi-step query processing (legacy)
├── mastra/         # Mastra configuration and setup
└── types/          # TypeScript type definitions

output/             # Generated chunks and tables (575 items)
```

### Key Implementation Details

**Agent Instructions**: Professional financial analyst persona with systematic methodology, structured response format, and regulatory document expertise.

**Vector Search**: Enhanced with query-specific boosting, relevance filtering, and section-aware ranking for improved result quality.

**Memory Integration**: Uses PostgreSQL for both storage and vector operations, enabling semantic recall and working memory across sessions.

**Type Safety**: Full TypeScript implementation with Zod schemas for runtime validation of both S-1 data structures and agent responses.

### Performance Characteristics
- **Query Response Time**: 15-30 seconds for complex analysis
- **Memory Usage**: Optimized for large document processing
- **Embedding Dimensions**: 1536 (OpenAI text-embedding-3-small)
- **Context Window**: 20 messages with semantic recall