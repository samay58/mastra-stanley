# IPO S-1 Agent

## What it is
A small TypeScript toolkit that processes and queries S-1 filings, and can generate a comprehensive investment research report. It uses PostgreSQL with pgvector for retrieval and OpenAI for embeddings/agents.

## Quick start
```bash
npm install
cp .env.example .env
# Fill in .env: OPENAI_API_KEY, POSTGRES_CONNECTION_STRING, SEC_USER_AGENT

# Prepare data (embeddings) then try a query
npm run process-s1   # uses ./figmas1_content_list.json by default (fixture)
npm run embed
npm run query "What is the IPO price range?"

# Full report (multi-step; runtime depends on model + retrieval)
npm run generate-report
```

## Ingest a real S-1 from EDGAR (HTML)
```bash
# Example formats:
#   --cik 0001234567
#   --accession 0001234567-26-000001
# Use real values from EDGAR.
npm run ingest:edgar -- --cik <CIK> --accession <ACCESSION> --filing-id my-s1

# Then set S1_FILING_ID=my-s1 (in your shell or .env) and run:
npm run embed
npm run query "What is the IPO price range?"
```

## One command: ingest -> process -> embed -> UI
```bash
npm run s1:up -- --cik <CIK> --accession <ACCESSION> --filing-id my-s1
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

Document chunks and tables are indexed with pgvector. An agentic workflow uses retrieval results to answer queries or generate a report.

Per-filing artifacts are saved to `output/filings/<filingId>/`.

## Sessions

Development logs live in `session-logs/` and are gitignored. You can keep local notes there without committing them.

## Examples

See `examples/`:
- `agent_quick_check.ts` for a fast sanity check.
- `table_tool_preview.ts` for a quick table extraction preview.

## Notes

Minimal dependencies. No telemetry. Friendly CLI defaults.
