export interface Env {
  DB: D1Database;
  VEC: VectorizeIndex;
  AI: Ai;
  ASSETS: Fetcher;
  BRIEF: Workflow;
  LLM_PROVIDER: string;
  GEMINI_MODEL: string;
  GEMINI_FALLBACK_MODELS: string;
  EMBED_MODEL: string;
  FALLBACK_LLM: string;
  DAILY_RUNS_PER_IP: string;
  DAILY_RUNS_GLOBAL: string;
  GEMINI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  ADMIN_TOKEN?: string;
  BLS_API_KEY?: string;
}
