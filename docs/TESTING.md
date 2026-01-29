# Testing Guide (Fixture + Real EDGAR)

This project is **single-filing at a time**. Set `S1_FILING_ID` to control which filing all tools/agents use.

## 0) Prereqs

- Node.js (CI uses Node 22)
- `npm install` (or `npm ci`)
- For EDGAR ingestion: set `SEC_USER_AGENT` in `.env` (SEC requires a real UA)
- For embeddings / UI / LLM eval: set `OPENAI_API_KEY` and `POSTGRES_CONNECTION_STRING`

## 1) Fast Local Checks (no DB, no OpenAI)

```bash
npm test
```

Process the built-in fixture into per-filing artifacts:

```bash
npm run process-s1
```

Run retrieval eval (BM25 over chunks; writes JSON under `eval/results/`):

```bash
npm run eval:retrieval
```

## 2) Full Local (pgvector + embeddings + Mastra UI)

Start Postgres + pgvector (Docker):

```bash
docker run -d --name mastra-stanley-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 ankane/pgvector
```

Set `.env`:

```bash
OPENAI_API_KEY=...
POSTGRES_CONNECTION_STRING=postgresql://postgres:postgres@localhost:5432/postgres
```

Then run:

```bash
# 1) process (fixture)
npm run process-s1

# 2) extract deterministic facts (recommended for numeric questions)
npm run facts

# 3) embed into pgvector
npm run embed

# 4) interactive UI
S1_FILING_ID=figma npx mastra dev
```

Optional: LLM-based answer eval (requires embeddings + OpenAI):

```bash
npm run eval:answers
```

## 3) Real EDGAR Filing (one command)

```bash
npm run s1:up -- --cik <CIK> --accession <ACCESSION> --filing-id <my-s1>
```

This will:
- download + cache EDGAR artifacts under `output/filings/<filingId>/raw/`
- parse HTML -> `content_list.json`
- process -> `text_chunks.jsonl`, `tables_manifest.json`, `sections_manifest.json`, `mastra_import.json`
- extract facts -> `facts.json`
- embed -> pgvector
- start the Mastra dev UI

To start UI later:

```bash
S1_FILING_ID=<my-s1> npx mastra dev
```

## 4) Where Outputs Go

All generated artifacts live in `output/filings/<filingId>/` (gitignored):
- `content_list.json` (parsed elements + anchors)
- `text_chunks.jsonl` (retrieval chunks)
- `tables_manifest.json` + `tables/*.csv` (tables + structure hints)
- `sections_manifest.json` (lightweight node tree)
- `facts.json` (deterministic, citation-backed facts)
- `raw/index.html`, `raw/index.json`, `raw/<primary>.html` (EDGAR cache)

