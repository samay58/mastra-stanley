export type FactType = 'financial_metric' | 'offering_terms' | 'ownership';

export type FactEvidenceType = 'table_cell' | 'table_row' | 'text_quote';

export interface FactEvidence {
  type: FactEvidenceType;
  source_url?: string;
  anchor?: string;
  section_hierarchy?: string;
  chunk_id?: string;
  table_filename?: string;
  table_caption?: string;
  row_index?: number;
  col_index?: number;
  row_label?: string;
  column_label?: string;
  quote: string;
}

export interface Fact {
  fact_id: string;
  filing_id: string;
  fact_type: FactType;
  canonical_key: string;
  value: string;
  unit?: string;
  period?: string;
  dimensions?: Record<string, string>;
  evidence: FactEvidence[];
  created_at: string;
}

