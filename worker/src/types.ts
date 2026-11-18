export interface Dimensions {
  l_cm?: number;
  w_cm?: number;
  h_cm?: number;
  gusset_cm?: number;
  volume_ml?: number;
}

export interface Component {
  name: string;
  material?: string;
  weight_g?: number;
}

export interface SourcingPrefs {
  us_made?: boolean;
  near_sales_states?: boolean;
  certifications?: string[];
  scale?: 'small' | 'mid' | 'large';
}

export interface Profile {
  company_description?: string;
  product_category?: string;
  package_type?: string;
  current_material?: string;
  dimensions?: Dimensions;
  thickness?: { value: number; unit: 'micron' | 'mm' };
  unit_weight_g?: number;
  annual_units?: number;
  components?: Component[];
  sales_states?: string[];
  other_markets?: string[];
  functional_needs?: string[];
  candidate_alternatives?: string[];
  sourcing_preferences?: SourcingPrefs;
}

export interface SectionDef {
  id: string;
  kind: 'summary' | 'narrative' | 'alternatives' | 'regulatory' | 'eol' | 'claims' | 'cost' | 'sourcing' | 'competitor' | 'gaps';
  title: string;
  layers?: string[] | 'all';
  query_hint?: string;
}

export interface WorkflowDef {
  id: string;
  name: string;
  description: string;
  needs: { cost: boolean; sourcing: boolean };
  top_k: number;
  filters: { layers: string[] | 'all'; jurisdictions: 'selected' | 'all' };
  system_prompt: string;
  output_schema: Record<string, unknown>;
  sections: SectionDef[];
}

export interface NumberedPassage {
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
  score: number;
  vector_rank: number | null;
  keyword_rank: number | null;
}

export interface Claim {
  text: string;
  cites: number[];
  verdict?: 'supported' | 'partial' | 'unsupported';
  note?: string;
}

export interface SectionOut {
  id: string;
  kind: SectionDef['kind'];
  title: string;
  takeaway: string;
  claims: Claim[];
  data?: any;
  gaps: string[];
  removed?: Claim[];
  status?: 'Grounded' | 'Partial' | 'Evidence Gap';
  passages: number[];
}

export interface PlanItem {
  section: string;
  query: string;
  layers: string[] | 'all';
}

export interface Alternative {
  name: string;
  material_key: string;
}
