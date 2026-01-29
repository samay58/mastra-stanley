# Mastra Stanley (S-1 Agent)

Mastra-first S-1 analysis toolkit:
- Ingest (SEC EDGAR HTML) -> parse anchors/tables -> chunk -> extract facts -> embed -> query in Mastra UI
- **One S-1 filing at a time** (controlled by `S1_FILING_ID`)

## Quick Start (fast, local)

```bash
npm ci
npm test
npm run process-s1
npm run eval:retrieval
```

## Real EDGAR S-1 (one command)

```bash
# Requires: SEC_USER_AGENT, OPENAI_API_KEY, POSTGRES_CONNECTION_STRING
npm run s1:up -- --cik <CIK> --accession <ACCESSION> --filing-id <my-s1>
```

## Testing

See `docs/TESTING.md` for the full, step-by-step test flow (fixture + pgvector + EDGAR + evals).

## Output Artifacts

Per-filing artifacts are written to `output/filings/<filingId>/` (gitignored), including:
`content_list.json`, `text_chunks.jsonl`, `tables_manifest.json`, `sections_manifest.json`, `facts.json`, and EDGAR `raw/` cache.
