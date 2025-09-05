# Folder Structure

- `src/`:
  - `agents/`: domain-specific agents used by workflows
  - `workflows/`: multi-step orchestration for analysis/reporting
  - `tools/`: retrieval and utility tools (e.g., vector queries)
  - `embeddings/`: embedding generation for pgvector
  - `processor/`: S-1 parsing and preprocessing
  - `types/`, `schemas/`, `utils/`: shared types and helpers

- `examples/`:
  - `agent_quick_check.ts`: quick sanity check of the financial agent
  - `table_tool_preview.ts`: targeted preview of table extraction/cleaning

- `output/`: generated results (e.g., saved reports). Not committed.
- `session-logs/`: local dev notes; gitignored.

See `README.md` for quick start and usage.
