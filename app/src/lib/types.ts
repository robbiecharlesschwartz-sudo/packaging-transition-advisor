export type Status = 'Grounded' | 'Partial' | 'Evidence Gap';

export interface Claim { text: string; cites: number[]; verdict?: 'supported' | 'partial' | 'unsupported'; note?: string }

export interface Section {
  id: string;
  kind: 'summary' | 'narrative' | 'alternatives' | 'regulatory' | 'eol' | 'claims' | 'cost' | 'sourcing' | 'competitor' | 'gaps';
  title: string;
  takeaway: string;
  claims: Claim[];
  data?: any;
  gaps: string[];
  removed?: Claim[];
  status?: Status;
  passages: number[];
}

export interface Passage {
  n: number;
  chunk_id: string;
  document_id: string;
  title: string;
  publisher: string;
  source_url: string;
  doc_date: string | null;
  layer: string;
  jurisdiction: string;
  reliability: string;
  license: string;
  section: string | null;
  page: number | null;
  content: string;
  content_visible: boolean;
  cited: boolean;
  score: number;
  vector_rank: number | null;
  keyword_rank: number | null;
}

export interface Output {
  workflow: { id: string; name: string };
  profile: Profile | null;
  question: string | null;
  generated_at: string;
  model: string;
  alternatives: { name: string; material_key: string }[];
  sections: Section[];
  kpis: {
    recommended_alternative: { name: string; fit: string } | null;
    cost_change_per_unit: { alternative: string; low: number; high: number; confidence: string } | null;
    states_with_fees: string[];
    evidence_strength: { label: string; supported_share: number; primary_share: number };
  };
  passages: Passage[];
  stats: Record<string, number>;
  corpus_updated: string | null;
}

export interface Step { step_id: string; status: string; started_at: string | null; ended_at: string | null; summary: any; detail: any }

export interface Run {
  id: string;
  created_at: string;
  workflow_id: string;
  profile: Profile | null;
  question: string | null;
  status: 'queued' | 'running' | 'done' | 'error';
  output: Output | null;
  steps: Step[];
  model?: string;
  error?: string | null;
  example_slug?: string | null;
}

export interface Profile {
  company_description?: string;
  product_category?: string;
  package_type?: string;
  current_material?: string;
  dimensions?: { l_cm?: number; w_cm?: number; h_cm?: number; gusset_cm?: number; volume_ml?: number };
  thickness?: { value: number; unit: 'micron' | 'mm' };
  unit_weight_g?: number;
  annual_units?: number;
  sales_states?: string[];
  other_markets?: string[];
  functional_needs?: string[];
  candidate_alternatives?: string[];
  sourcing_preferences?: { us_made?: boolean; near_sales_states?: boolean; certifications?: string[]; scale?: 'small' | 'mid' | 'large' };
}

export interface StepDef { id: string; label: string; icon: string; description: string; inputs: string[]; outputs: string[]; next: string[]; optional?: string; column: number; row: number }

export interface Meta {
  corpus_updated: string | null;
  documents: number;
  documents_excluding_news: number;
  chunks: number;
  layers: Record<string, number>;
  workflows: { id: string; name: string; description: string; needs: { cost: boolean; sourcing: boolean }; sections: { id: string; title: string; kind: string }[] }[];
  steps: StepDef[];
  materials: { key: string; label: string; family: string }[];
  llm: string;
}
