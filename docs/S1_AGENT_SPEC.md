# IPO S-1 Agent Spec (Mastra-First)

## 0) Goal

Build an S-1-specific analysis system that is:
- Trustworthy: answers are grounded in quotes + citations (section + page/anchor).
- Fast: low-latency retrieval and predictable cost per query.
- Durable: works across many S-1s (not hard-coded to one filing).
- Useful: supports the real questions in `TEST-QUERIES.md` without “AI slop”.
- Mastra-native: uses Mastra primitives (tools, workflows, RAG utilities) rather than a bespoke framework.

This repo currently has the bones of a system for **Figma’s S-1**, but it needs a re-cut around (1) ingestion, (2) S-1-aware chunking, (3) structured facts, and (4) evaluation/quality gates.

## 1) What The Repo Is Today (Deep Scrub)

### Current pipeline (as implemented)
1. **Input**: `figmas1_content_list.json` (pre-extracted elements: `text`/`table`/`image`).
2. **Processing**: `src/processor/S1Processor.ts`
   - Detects headings via `MAJOR_SECTIONS` + `text_level`.
   - Streams elements into “chunks” with `section_path` metadata.
   - Extracts tables via regex HTML parsing and writes CSVs to `output/tables/`.
   - Writes `output/text_chunks.jsonl` and `output/mastra_import.json`.
3. **Embedding + index**: `src/embeddings/generate-embeddings.ts`
   - Creates/replaces pgvector index `s1_embeddings` every run.
   - Embeds chunk text with `text-embedding-3-small` and upserts.
4. **Retrieval tools**: `src/tools/vectorQuery.ts`
   - `searchS1Document` (pure vector), `searchS1WithRerank` (vector + heuristics),
     `hybridS1Search` (vector + keyword scoring), `enhancedS1Search` (vector + BM25 + query expansion),
     plus table lookup/data tools that read CSVs from disk.
5. **Agents/workflows**:
   - `S1QueryAgent` for Q&A; specialized agents for report generation.
   - `s1QueryWorkflow` and a large `investmentResearchWorkflow`.
6. **Report scripts**:
   - `npm run generate-report` runs the research workflow, writes JSON to `output/`.
   - `npm run validate-report` checks placeholders/citations heuristically.

### Why it doesn’t “actually work” reliably yet
Key blockers and failure modes:
- **Hard-coded to Figma**: prompts, chunk IDs (`figma-s1-chunk-*`), query expander, table heuristics, workflow “known counts”.
- **Ingestion gap**: there’s no first-class pipeline to fetch and parse a fresh S-1 from SEC EDGAR. The system assumes a prebuilt `*_content_list.json`.
- **Chunking isn’t S-1-aware enough**:
  - Fixed-size char chunking; no token budgeting; no chunk typing.
  - Section hierarchy depends on `text_level`, which is mostly missing in the sample input.
  - Tables are referenced inside text chunks but not indexed as first-class structured objects.
- **Numeric questions are structurally hard**:
  - Embeddings alone aren’t great at “exact-number” retrieval.
  - Some prompts hard-code “expected” numbers (risk of hallucination).
- **Performance pitfalls**:
  - Re-creating the vector index on every embedding run.
  - Tool execution re-initializes clients repeatedly.
  - Hybrid BM25 builds in-memory from JSONL; ok for one doc, shaky for multi-doc scale.
- **Quality control is not enforceable**:
  - Placeholder removal patterns are too aggressive (can delete legitimate bracketed text).
  - Workflows can return “valid schema” but meaningless content.

## 2) Target User Experience (Non-Slop Contract)

### Query mode (interactive)
When a user asks a question, the system returns:
- **Answer**: concise, directly addresses the question.
- **Evidence**: 2–6 quotes with citations (section path + page or stable anchor).
- **Interpretation**: optional, clearly labeled as analysis vs. fact.
- **Confidence**: derived from evidence quality (not vibes).
- **Follow-ups**: only if needed (e.g., which share class; time period).

Hard rule: **If we can’t cite it, we don’t assert it.**

### Research report mode (batch)
Generates a modular report, where each section is:
- produced from explicit evidence bundles,
- validated for citations + “no placeholders”,
- and can be regenerated independently.

## 3) Data Model (Make Retrieval + Citations Easy)

Represent one filing as a set of typed objects. Minimum entities:

### 3.1 Filing
- `filing_id`: stable key (CIK + accession + doc type).
- `company_name`, `cik`, `accession`, `filing_date`.
- `source_urls`: EDGAR HTML + exhibits.

### 3.2 Node (hierarchy / structure)
Used to preserve “document structure is sacred”.
- `node_id`, `filing_id`
- `type`: `section|subsection|risk_factor|paragraph|table|figure`
- `title`, `section_path[]`, `item_code?` (if derivable)
- `anchor`: stable reference (HTML id, byte offsets, or page label)
- `order`: ordering within parent

### 3.3 Chunk (retrieval unit)
Chunks should be derived from nodes and carry stable citations.
- `chunk_id`, `filing_id`, `node_id`
- `chunk_type`:
  - `narrative_paragraph`
  - `risk_factor`
  - `mdna_discussion`
  - `accounting_policy`
  - `table_caption`
  - `table_row_group`
  - `cover_page_fact`
  - (extend as needed)
- `content`
- `metadata` (stored alongside embeddings):
  - `section_hierarchy`
  - `anchor` (page/HTML id)
  - `entity_hints` (e.g., “Class B”, “Rule 144”, “greenshoe”)
  - `time_hints` (FY2024, Q3 2025, “three months ended …”)

### 3.4 Fact (structured extraction)
This is the “cut the fact” layer for numeric/structured questions.
- `fact_id`, `filing_id`
- `fact_type`: `financial_metric|offering_terms|ownership|risk|legal|governance|customer_metric`
- `canonical_key`: e.g. `revenue`, `net_loss`, `cash_and_equivalents`, `shares_outstanding_basic`
- `value`: number/string
- `unit`: `$`, `%`, `shares`, `years`, etc.
- `period`: `FY2024`, `Q3_2025`, `as_of_2025-07-01`, etc.
- `dimensions`: optional dict (segment, geography, class)
- `evidence`: `{chunk_id, quote, anchor}`

Facts are queryable directly (SQL) and optionally embedded (for fuzzy matching).

## 4) S-1 Ingestion (Source-of-Truth First)

We need a repeatable ingestion pipeline for arbitrary S-1s.

### 4.1 Inputs we should support
1. SEC EDGAR HTML (preferred for structure + anchors)
2. SEC filing “complete submission text file” (backup)
3. PDF (optional; used when we need page-exact citations)
4. Exhibits / XBRL (high-value for financial statements)

### 4.2 Proposed ingestion stages
1. **Fetch**
   - Identify filing by accession/CIK/ticker + date.
   - Download primary HTML + exhibits (cache locally).
2. **Parse structure**
   - Convert HTML into a node tree:
     - detect major sections (Prospectus Summary, Risk Factors, Business, …)
     - detect repeated headers/ToC and de-duplicate
     - preserve ordering
3. **Extract tables**
   - Parse HTML tables with a real parser (not regex).
   - Store as JSON (rows/cols), plus a “rendered” plain-text representation.
4. **Chunk**
   - Node-aware chunking (see next section).
5. **Extract facts**
   - Deterministic extraction first (regex + table structure).
   - LLM-assisted normalization only when necessary, and always with cited evidence.
6. **Index**
   - Upsert chunks into pgvector (narrative + table text views).
   - Upsert facts into relational store (and optional facts embedding index).

## 5) S-1-Specific Chunking Strategy

Chunking is the core product. The strategy is:
1. **Preserve hierarchy**
2. **Keep atomic facts retrievable**
3. **Keep enough context to interpret the fact**
4. **Keep chunk counts low enough for speed**

### 5.1 Chunk types and rules

**A) Narrative paragraphs (default)**
- Split by paragraph boundaries.
- Target size: ~250–450 tokens.
- Overlap: none by default; rely on parent context instead.
- Attach `parent_summary` (short, generated once per section) as metadata for synthesis (not for retrieval ranking).

**B) Risk factors**
- Each risk factor becomes its own chunk:
  - `title` + body
  - `risk_tags`: (competition, platform dependency, security, AI liability, regulation, macro, etc.)
- Keep the “Risk Factors” intro as separate chunks (often contains framing and materiality language).

**C) MD&A**
- Keep “Results of Operations” paragraphs as chunks.
- Separately chunk “Key Business Metrics” disclosures (NRR, customers, etc.) as metric-focused chunks.

**D) Financial statements + notes**
- Tables are first-class:
  - Store the raw table (JSON)
  - Store a “table text view” optimized for retrieval:
    - caption + period headers
    - row label + values (normalized)
    - units (in $000s, etc.)
- Chunk tables by logical row groups (e.g., Revenue/COGS/Gross Profit; Opex; Net income).
- Notes/footnotes: keep as paragraph chunks but strongly link to the referenced table/fact.

**E) Ownership / capitalization**
- Beneficial ownership table becomes:
  - one chunk per major holder group
  - plus extracted facts (5% holders, voting power, dual-class)

**F) Offering terms / underwriters**
- Extract and chunk:
  - offering size, primary vs secondary, greenshoe
  - lock-up terms and expiration schedule
  - directed share program

### 5.2 Multi-resolution retrieval (parent-child)
Store both:
- **child chunks** (small, fact-dense) for precision retrieval
- **parent nodes** (section-level summaries) for context

At query time: retrieve child chunks first, then automatically fetch their parents to provide context in synthesis.

## 6) Retrieval & Ranking (S-1-Aware)

### 6.1 Query routing
Detect query intent and route:
- **Numeric / fact** (revenue, margins, cash, share counts, % ownership)
  1) structured fact lookup (fast path)
  2) table retrieval (if missing)
  3) narrative fallback (for explanation/context)
- **Qualitative** (strategy, risks, competition)
  1) hybrid search over narrative
  2) section-constrained rerank
  3) “evidence bundle” assembly

### 6.2 Hybrid retrieval approach
Use a hybrid score:
- vector similarity (semantic)
- keyword/FTS match (exact terms, names, numbers)
- section priors (e.g., risk queries prefer Risk Factors)
- chunk-type priors (e.g., revenue queries prefer financial tables + MD&A)

Implementation options:
1. Postgres full-text search + pgvector (ideal; one engine, fast).
2. Keep BM25 in-memory as a fallback for local-only mode.

### 6.3 Table QA and fact grounding
For table-backed answers:
- retrieve table chunk(s)
- run a table-specific “row resolver” to locate the exact row/period
- return a fact with:
  - value, unit, period
  - quote: row label + value cell context
  - citation: table anchor + caption

### 6.4 Vector index tuning (pgvector)
Use pgvector indexes intentionally (speed/recall trade-offs are real):
- Default to **HNSW** for interactive querying (fast, high recall), with explicit build params.
- Keep **IVFFlat** as an option for very large corpora where build cost matters.
- Expose query-time knobs (HNSW `ef`, IVF `probes`) in tools for debugging and benchmarks.

For Mastra PgVector, use `createIndex({ indexConfig: { type: 'hnsw', hnsw: { m, efConstruction }}})` and
pass `options: { ef }` at query-time when you need higher recall.

## 7) Mastra-First Architecture

### 7.1 Prefer Mastra RAG primitives where possible
Adopt:
- `MDocument` for chunking (HTML-aware) where it fits, but keep our S-1 chunk typing.
- Mastra’s vector query tooling (or wrap it) so tools are standardized and composable.
- Workflows for orchestration, but keep steps small and testable.

### 7.2 Tooling rules (avoid slop)
- Tools return **evidence objects**, not just text.
- Every tool response includes `chunk_id` and `anchor`.
- Agents are forbidden from inventing numbers:
  - response schema requires `evidence[]`
  - validation fails if `evidence.length == 0` for factual claims

### 7.3 Memory
Treat memory as optional and separate from filing retrieval:
- It should store the user’s goals, preferences, and prior questions.
- It should not be required for the system to answer a single query.

## 8) Evaluation and Quality Gates

### 8.1 Test set
Start with `TEST-QUERIES.md`, then build:
- 50–100 queries with expected evidence targets (section or table).
- For numeric queries: expected `{metric, period}` not necessarily the exact number (initially).

### 8.2 Retrieval metrics
- Recall@K for expected section/table
- MRR for correct chunk type
- Latency distribution (p50/p95) for:
  - retrieval only
  - end-to-end answer

### 8.3 Output quality gates (automated)
- No placeholders
- No uncited numeric claims
- Evidence bundle must include:
  - at least 1 direct quote for numeric/fact answers
  - section + anchor always

### 8.4 Cost budgets
Set explicit budgets:
- embedding cost per filing
- max tokens per query
- max tool calls per query (with “ask clarification” fallback)

### 8.5 Performance SLOs (make “10x faster” concrete)
Target budgets for a single-filing system on a laptop-class machine:
- Retrieval-only: p50 < 250ms, p95 < 900ms
- End-to-end Q&A (2–4 tool calls): p50 < 4s, p95 < 12s
- “Generate report” (batch): deterministic step timings + resumable sections

Enforce:
- no repeated index rebuilds
- no repeated parsing of tables/chunks inside hot query paths
- connection pooling and re-use for pgvector + storage

## 9) Phased Implementation Plan

### Phase 1: Make it real (single filing, end-to-end)
- Replace Figma hard-coding with `filing_id` and config.
- Implement ingestion from SEC HTML for one S-1 (store raw + parsed nodes).
- Implement chunk typing and citations (anchor model).
- Implement baseline hybrid retrieval (vector + keyword).

### Phase 2: Facts layer (the “cut the fact” upgrade)
- Implement fact schema + store.
- Extract:
  - financial statement line items (revenue, gross profit, opex, net loss, cash)
  - offering terms (price range, shares, proceeds, greenshoe)
  - ownership table (5% holders, voting power)
- Route numeric queries to facts first.

### Phase 3: Performance + scale (multi-filing)
- Multiple filings in one DB, with `filing_id` filters.
- Incremental upserts (no index replace).
- Postgres-side hybrid retrieval (FTS + vector).
- Caching: query embeddings, rerank results, table parses.

### Phase 4: Report generation that isn’t slop
- Rewrite report workflow to be evidence-driven:
  - each section = evidence bundle -> structured write-up
  - section regeneration + validation
- Add reviewer mode: show evidence next to claims.

## 10) Mastra Product Feedback (to share with CEO)
Concrete friction observed in this repo pattern:
- Tool execution ergonomics: calling tool `.execute()` outside the agent/runtime requires boilerplate; it’s easy to pass the wrong context object.
- Validation: schemas help, but it’s still easy to produce “schema-valid nonsense” without first-class “evidence required” constraints.
- RAG primitives: `MDocument` chunking is powerful; S-1 needs domain-specific chunk typing and metadata conventions baked in (a “financial filing” preset would be huge).
- Observability: workflows benefit from a standard trace view of:
  - retrieved chunks
  - citations used
  - costs/latency per step

## 11) Open Questions
- Do we require page-number citations (PDF), or are stable HTML anchors sufficient?
- Are we targeting one filing at a time, or a corpus (cross-company comparisons)?
- Do we want XBRL ingestion in v1, or later?
