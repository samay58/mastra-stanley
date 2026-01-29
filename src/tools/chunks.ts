import dotenv from 'dotenv';
dotenv.config();

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { readFile, stat } from 'fs/promises';

import type { Chunk } from '../types/index.js';
import { getActiveFilingContext } from '../config/filing.js';

type ChunkIndex = {
  filingId: string;
  mtimeMs: number;
  byId: Map<string, Chunk>;
};

let cache: ChunkIndex | null = null;

async function loadChunkIndex(): Promise<ChunkIndex> {
  const filing = getActiveFilingContext();
  const st = await stat(filing.chunksPath);

  if (cache && cache.filingId === filing.filingId && cache.mtimeMs === st.mtimeMs) {
    return cache;
  }

  const raw = await readFile(filing.chunksPath, 'utf-8');
  const lines = raw.split('\n').filter(l => l.trim().length > 0);
  const byId = new Map<string, Chunk>();

  for (const line of lines) {
    try {
      const chunk = JSON.parse(line) as Chunk;
      if (chunk?.id) {
        byId.set(chunk.id, chunk);
      }
    } catch {
      // ignore malformed lines
    }
  }

  cache = { filingId: filing.filingId, mtimeMs: st.mtimeMs, byId };
  return cache;
}

const ChunkSchema = z.object({
  id: z.string(),
  content: z.string(),
  metadata: z.record(z.any()),
});

export const s1ChunkContextTool = createTool({
  id: 'readS1ChunkContext',
  description: 'Read a specific chunk (and optionally its neighbors) from the active filing for additional local context during synthesis.',
  inputSchema: z.object({
    chunkId: z.string().describe('Chunk ID (e.g., figma-chunk-00123)'),
    includePrev: z.boolean().default(true).describe('Include the previous chunk (if available)'),
    includeNext: z.boolean().default(true).describe('Include the next chunk (if available)'),
  }),
  outputSchema: z.object({
    chunks: z.array(ChunkSchema),
  }),
  execute: async ({ context }) => {
    const { chunkId, includePrev, includeNext } = context;
    const index = await loadChunkIndex();

    const center = index.byId.get(chunkId);
    if (!center) return { chunks: [] };

    const out: Chunk[] = [];
    const prevId = includePrev ? (center.metadata as any)?.prev_chunk_id : undefined;
    const nextId = includeNext ? (center.metadata as any)?.next_chunk_id : undefined;

    if (includePrev && typeof prevId === 'string') {
      const prev = index.byId.get(prevId);
      if (prev) out.push(prev);
    }

    out.push(center);

    if (includeNext && typeof nextId === 'string') {
      const next = index.byId.get(nextId);
      if (next) out.push(next);
    }

    return { chunks: out as any };
  },
});

