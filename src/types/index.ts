import { z } from 'zod';

// S-1 Content Types
export const ContentElementSchema = z.object({
  type: z.enum(['text', 'table', 'image']),
  text: z.string().optional(),
  text_level: z.number().optional(),
  anchor: z.string().optional(),
  source_url: z.string().optional(),
  img_path: z.string().optional(),
  table_caption: z.array(z.string()).optional(),
  table_footnote: z.array(z.string()).optional(),
  table_body: z.string().optional(),
  page_idx: z.number()
});

export type ContentElement = z.infer<typeof ContentElementSchema>;

// Chunk Types
export const ChunkMetadataSchema = z.object({
  id: z.string(),
  filing_id: z.string().optional(),
  text: z.string(),
  section_path: z.array(z.string()),
  section_hierarchy: z.string(),
  page_idx: z.number(),
  anchor: z.string().optional(),
  source_url: z.string().optional(),
  chunk_type: z.enum([
    'text',
    'summary',
    'risk_factor',
    'mdna',
    'business',
    'management',
    'exec_comp',
    'ownership',
    'capital_structure',
    'underwriters',
    'financial_statements',
    'table_reference',
  ]),
  prev_chunk_id: z.string().optional(),
  next_chunk_id: z.string().optional(),
  chunk_size: z.number(),
  timestamp: z.string()
});

export type ChunkMetadata = z.infer<typeof ChunkMetadataSchema>;

export const ChunkSchema = z.object({
  id: z.string(),
  content: z.string(),
  metadata: ChunkMetadataSchema
});

export type Chunk = z.infer<typeof ChunkSchema>;

// Table Types
export interface TableData {
  filename: string;
  section: string;
  anchor?: string;
  caption?: string;
  source_url?: string;
  // Optional structure hints derived during HTML parsing. These are used to
  // render better previews, skip non-data preambles, and support deterministic extraction.
  title?: string;
  header?: string[];
  header_row_count?: number;
  data_start_row?: number;
  rows: number;
  cols: number;
  data: any[][];
}

// S1 Section Types
export const MAJOR_SECTIONS = [
  "PROSPECTUS SUMMARY",
  "RISK FACTORS",
  "SPECIAL NOTE REGARDING FORWARD-LOOKING STATEMENTS",
  "INDUSTRY AND MARKET DATA",
  "USE OF PROCEEDS",
  "DIVIDEND POLICY",
  "CAPITALIZATION",
  "DILUTION",
  "MANAGEMENT'S DISCUSSION AND ANALYSIS",
  "BUSINESS",
  "MANAGEMENT",
  "EXECUTIVE COMPENSATION",
  "CERTAIN RELATIONSHIPS AND RELATED PARTY TRANSACTIONS",
  "PRINCIPAL AND SELLING STOCKHOLDERS",
  "DESCRIPTION OF CAPITAL STOCK",
  "SHARES ELIGIBLE FOR FUTURE SALE",
  "MATERIAL U.S. FEDERAL INCOME TAX CONSEQUENCES",
  "UNDERWRITERS",
  "LEGAL MATTERS",
  "EXPERTS",
  "WHERE YOU CAN FIND ADDITIONAL INFORMATION",
  "INDEX TO CONSOLIDATED FINANCIAL STATEMENTS"
] as const;

export type MajorSection = typeof MAJOR_SECTIONS[number];

// Processing Config
export interface ProcessingConfig {
  chunkSize: number;
  chunkOverlap: number;
  separator: string;
  extractMetadata: boolean;
}
