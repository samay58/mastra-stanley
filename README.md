# IPO S-1 Agent

## What it is
A small TypeScript toolkit that processes and queries S-1 filings, and can generate a comprehensive investment research report. It uses PostgreSQL with pgvector for retrieval and OpenAI for embeddings/agents.

## Quick start
```bash
npm install
cp .env.example .env
# Fill in .env: OPENAI_API_KEY, POSTGRES_CONNECTION_STRING

# Prepare data (embeddings) then try a query
npm run embed
npm run query "What is Figma's 2024 revenue?"

# Full report (takes ~15–20 minutes)
npm run generate-report
```

## Options and examples

Scripts: `process-s1`, `embed`, `query`, `query-structured`, `generate-report`, `mastra:dev`

Examples:

```bash
# Quick agent sanity check
npx tsx examples/agent_quick_check.ts

# Table tool preview
npx tsx examples/table_tool_preview.ts

# Interactive playground
npx mastra dev  # http://localhost:4111
```

## How it works

Document chunks and tables are indexed with pgvector. An agentic workflow uses retrieval results to answer queries or generate a report. Results are saved to `output/`.

## Sessions

Development logs live in `session-logs/` and are gitignored. You can keep local notes there without committing them.

## Examples

See `examples/`:
- `agent_quick_check.ts` for a fast sanity check.
- `table_tool_preview.ts` for a quick table extraction preview.

## Notes

Minimal dependencies. No telemetry. Friendly CLI defaults.
