# Retrieval Architecture (S-1 RAG + Facts)

This doc turns the high-level spec into a concrete retrieval design we can implement incrementally.

## 1) Core Principle

S-1 questions split into two buckets:
1. **Fact questions** (numbers, ownership, offering terms) → answer from a **structured fact store** with cited evidence.
2. **Narrative questions** (risks, strategy, competition) → answer from **hybrid retrieval** over narrative chunks (vector + keyword) with section/type priors.

## 2) Storage Layout (Postgres)

Minimum tables (names illustrative):

- `filings(filing_id, cik, accession, company_name, filing_date, source_url_html, source_url_pdf, created_at)`
- `nodes(node_id, filing_id, parent_node_id, type, title, section_path, anchor, order_idx)`
- `chunks(chunk_id, filing_id, node_id, chunk_type, content, anchor, section_hierarchy, page_label, created_at)`
- `chunk_fts(chunk_id, filing_id, tsv tsvector)` (or inline `tsv` on `chunks`)
- `chunk_embeddings(chunk_id, filing_id, embedding vector(1536))`
- `tables(table_id, filing_id, node_id, caption, anchor, data_json, text_view, created_at)`
- `facts(fact_id, filing_id, fact_type, canonical_key, value_text, value_num, unit, period, dimensions_json, evidence_json, created_at)`

Notes:
- `anchor` is the citation key. For HTML this can be an `id`/fragment; for PDF a `(page, bbox)` or at minimum a page label.
- Keep `text_view` for tables: it’s the retrieval-friendly representation (caption + row/value lines).

## 3) Indexing Strategy

### 3.1 Vector indexes (pgvector)
- Use HNSW for interactive queries:
  - `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=128);`
- Tune at query time with `ef` (higher = better recall, slower).

### 3.2 Keyword indexes (Postgres FTS)
- Build a `tsvector` on `content` (and/or include `section_hierarchy`, `chunk_type` as weighted fields).
- Example: weight section titles higher than body text.

### 3.3 Facts indexes
- B-tree index on `(filing_id, canonical_key, period)` for fast fact lookups.
- Optional: embed facts into a separate `facts_embeddings` table if we want fuzzy metric matching.

## 4) Retrieval APIs (Tools)

### 4.1 `searchChunks` (hybrid)
Input:
- `filingId`
- `query`
- `topK`
- optional: `sectionHint`, `chunkTypes`, `periodHint`, `anchorHint`, `vectorWeight`, `ef|probes`

Output (always return evidence objects):
- `{ chunkId, score, vectorScore, keywordScore, chunkType, sectionHierarchy, anchor, pageLabel?, content }[]`

### 4.2 `lookupFacts` (fast path)
Input:
- `filingId`
- `canonicalKey?` (exact) OR `query` (fuzzy mapping to canonicalKey)
- `period?`

Output:
- `{ canonicalKey, value, unit, period, dimensions, evidence: [{chunkId, quote, anchor}] }[]`

### 4.3 `resolveTableRow`
Input:
- `tableId` OR `anchor`
- `rowMatcher` (exact/regex/fuzzy)
- `periodMatcher`

Output:
- `{ rowLabel, period, value, unit, evidence }[]`

## 5) Hybrid Ranking Formula

We should treat ranking as a product surface, not a hidden heuristic.

Suggested components:
- `V`: vector similarity score (0..1)
- `K`: keyword score (normalized 0..1) from FTS rank or BM25
- `S`: section prior multiplier (e.g., risk queries boost Risk Factors)
- `T`: chunk-type prior multiplier (e.g., revenue queries boost table chunks)
- `P`: period match bonus (when question includes a year/quarter)

One workable formula:
- `score = (wV * V + wK * K) * S * T + P`

Where:
- start with `wV=0.7, wK=0.3` (tune by query class)
- `S,T` are in `[0.6, 2.0]` (keep bounded)
- `P` is additive small bonus (e.g., `+0.05`)

## 6) Evidence Bundle Assembly (critical for non-slop)

Instead of “retrieve N chunks and dump them into the LLM”, we build an explicit bundle:
- De-duplicate near-identical chunks
- Pull parent node title(s) for each chunk
- For table evidence, include both:
  - table caption + headers
  - the exact row(s) referenced
- Cap the bundle size by tokens, not by count

Bundle output:
- `evidence[] = [{ chunkId, anchor, sectionHierarchy, quote, fullContext? }]`

Then the LLM is only asked to:
- answer using `evidence[]`
- refuse if evidence is insufficient

## 7) Implementation Phasing

Phase A (fast): keep current pgvector + in-memory BM25, but:
- make all tools return `chunkId + anchor + sectionHierarchy`
- add a `filingId` filter everywhere

Phase B (better): move keyword scoring into Postgres FTS:
- no JSONL load + BM25 build in hot path
- single query engine; better latency

Phase C (best): add facts + table resolvers and route numeric queries:
- drastically improves “what is revenue / ownership / shares” reliability

