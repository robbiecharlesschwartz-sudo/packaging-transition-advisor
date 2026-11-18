import type { Meta, Profile, Run } from './types';

async function j<T>(r: Response): Promise<T> {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as any).error ?? `HTTP ${r.status}`);
  return body as T;
}

export const api = {
  meta: () => fetch('/api/meta').then((r) => j<Meta>(r)),
  run: (workflow_id: string, profile: Profile | null, question: string | null) =>
    fetch('/api/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workflow_id, profile, question }) })
      .then((r) => j<{ run_id: string }>(r)),
  getRun: (id: string) => fetch(`/api/runs/${id}`).then((r) => j<Run>(r)),
  examples: () => fetch('/api/examples').then((r) => j<{ id: string; example_slug: string; workflow_id: string }[]>(r)),
  sources: () => fetch('/api/sources').then((r) => j<any[]>(r)),
  stateLaws: () => fetch('/api/state-laws').then((r) => j<any[]>(r)),
  ppi: (series: string[]) => fetch(`/api/ppi?series=${series.join(',')}`).then((r) => j<{ series_id: string; period: string; value: number; label?: string }[]>(r)),
};

/** Bundled replay runs (app/public/examples) work even if the API or the LLM quota is unavailable. */
export async function loadBundledExample(slug: string): Promise<Run> {
  const r = await fetch(`/examples/${slug}.json`);
  if (!r.ok) throw new Error('example not found');
  return r.json();
}

export const EXAMPLES = [
  { slug: 'snack-pouch', label: 'Snack pouch (multilayer film → recyclable options)' },
  { slug: 'cosmetics-bottle', label: 'Cosmetics bottle (PET → rPET, glass, aluminum, refill)' },
  { slug: 'ecommerce-mailer', label: 'E-commerce mailer (poly → paper) in EPR states' },
];
