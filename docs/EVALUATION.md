# Evaluation Plan (No-Slop + Performance)

The system only improves if we can measure it. This doc defines what “better” means and how we gate regressions.

## 1) Test Artifacts

### 1.1 Query suite
Create `eval/queries.jsonl` (one JSON per line):

Fields:
- `id`
- `filingId`
- `query`
- `intent`: `fact|table|narrative|mixed`
- `expected`:
  - `sections[]` (acceptable section paths)
  - `chunkTypes[]` (acceptable chunk types)
  - `facts[]` (optional: `{canonicalKey, period}`)
- `notes` (why the test exists)

Seed it from `TEST-QUERIES.md`, then add “boring but critical” questions:
- “What is the IPO price range?”
- “How many shares are offered (primary vs secondary)?”
- “Who owns >5% and what is their voting power?”
- “What is revenue/net loss for FY2024?”

### 1.2 Ground truth policy
We don’t need exact numeric ground truth to start.
We *do* need:
- the correct section/table evidence to be retrieved
- citations present in the final answer
- refusal when evidence is missing

Numeric exactness can be layered in once we have a fact store.

## 2) Metrics

### 2.1 Retrieval metrics
For each query:
- Recall@K for `expected.sections`
- MRR for `expected.chunkTypes`
- % queries with “good evidence bundle” (>=2 relevant chunks, no duplicates)

### 2.2 Answer quality gates (automated)
For each answer:
- No placeholder strings
- No uncited numeric claims (regex detect numbers/percentages; require evidence)
- Evidence bundle size within token budget
- Citations:
  - must include `sectionHierarchy`
  - must include `anchor` (page label or HTML id)

### 2.3 Performance metrics
Collect:
- retrieval latency p50/p95
- end-to-end latency p50/p95
- LLM tokens per query (prompt + completion)
- tool calls per query

## 3) Harness Design

### 3.1 Commands
Add scripts:
- `npm run eval:retrieval` (offline-ish; no LLM required if we only score retrieval)
- `npm run eval:answers` (LLM required; checks citation/no-slop gates)
- `npm run eval` (runs both + prints summary)

### 3.2 Determinism defaults
For eval runs:
- fixed model + temperature=0
- fixed max tool steps
- fixed topK + weights

### 3.3 Output
Write `eval/results/<timestamp>.json`:
- per-test metrics
- aggregate metrics
- regression diff vs last baseline

## 4) CI Gates (eventually)

On PR:
- `eval:retrieval` must pass thresholds (fast)
- `typecheck` must pass

Nightly:
- `eval:answers` (LLM-in-the-loop) + cost accounting

## 5) “No Slop” Definition (operational)

We treat any of the following as a failure:
- fabricated numbers
- generic filler (“the company focuses on innovation…”) without evidence
- schema-valid outputs with empty evidence arrays
- “confidence: high” without strong citations

