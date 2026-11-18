import catalogJson from '../../../cost/price_inputs.json';
import lawsJson from '../../../corpus/structured/state_laws.json';
import { currentMaterialKey, materialByKey } from '../catalog';
import type { Env } from '../env';
import type { Alternative, Profile } from '../types';
import { estimate, type Catalog, type LawRow } from './calculator';

export const CATALOG = catalogJson as unknown as Catalog & { generated: string };
export const LAWS = lawsJson as unknown as (LawRow & { title: string; key_date: string | null; key_date_event: string | null; source_doc_id: string; source_chunk_id: string; enacted_date: string | null })[];

/** PPI_now / mean(PPI over the price's base period), per series, from the weekly-refreshed ppi_series table. */
async function ppiFactors(env: Env): Promise<Record<string, { factor: number; latest: string; base: number; now: number }>> {
  const series = [...new Set(CATALOG.inputs.map((i) => i.ppi_series).filter(Boolean))] as string[];
  if (!series.length) return {};
  const rows = await env.DB.prepare(
    `SELECT series_id, period, value FROM ppi_series WHERE series_id IN (SELECT value FROM json_each(?)) ORDER BY period`,
  ).bind(JSON.stringify(series)).all<{ series_id: string; period: string; value: number }>();
  const basePeriod = String(CATALOG.inputs.find((i) => i.kind === 'price_per_kg')?.base_period ?? '');
  const m = basePeriod.match(/(\d{4}-\d{2}) to (\d{4}-\d{2})/);
  const out: Record<string, { factor: number; latest: string; base: number; now: number }> = {};
  for (const s of series) {
    const pts = rows.results.filter((r) => r.series_id === s);
    if (!pts.length) continue;
    const last = pts[pts.length - 1];
    const base = m ? pts.filter((p) => p.period >= m[1] && p.period <= m[2]) : [];
    const baseAvg = base.length ? base.reduce((a, p) => a + p.value, 0) / base.length : last.value;
    out[s] = { factor: last.value / baseAvg, latest: last.period, base: baseAvg, now: last.value };
  }
  return out;
}

export async function runCost(env: Env, profile: Profile, alternatives: Alternative[]) {
  const curKey = currentMaterialKey(profile.current_material, profile.package_type);
  if (!curKey) {
    return { available: false, reason: 'current material not in the cost catalog', gaps: ['Current material is "other" or not given; cost comparison needs it.'], inputs: [], options: [] };
  }
  const options = [
    { key: curKey, label: `Current: ${materialByKey(curKey)?.label ?? curKey}`, is_current: true },
    ...alternatives.filter((a) => a.material_key !== curKey).map((a) => ({ key: a.material_key, label: a.name })),
  ];
  const ppi = await ppiFactors(env);
  const factors = Object.fromEntries(Object.entries(ppi).map(([k, v]) => [k, v.factor]));
  const res = estimate(profile, options, CATALOG, LAWS, factors);
  return { available: true, ...res, ppi, catalog_generated: CATALOG.generated };
}

/** Compact text of the calculator result for the writer prompt (numbers the LLM may use). */
export function costDigest(c: any): string {
  if (!c?.available) return `Cost calculator not run: ${c?.reason ?? 'n/a'}`;
  const money = (x: any) => (x ? `$${x.low.toFixed(4)}-$${x.high.toFixed(4)}` : 'gap');
  const lines = c.options.map((o: any) => {
    const fees = Object.entries(o.epr).map(([s, e]: any) => `${s}: ${'low' in e ? money(e) : e.status}`).join('; ');
    const w = o.weight_g.low !== null ? `${o.weight_g.low.toFixed(1)}-${o.weight_g.high.toFixed(1)} g (${o.weight_g.method})` : 'weight gap';
    return `- ${o.label}: weight ${w}; material ${money(o.material_cost)}${o.material_cost ? ` [${o.material_cost.basis}]` : ''}; EPR fee per unit ${fees}; total per unit ${money(o.total_per_unit)}${o.annual ? `; annual $${Math.round(o.annual.low).toLocaleString('en-US')}-$${Math.round(o.annual.high).toLocaleString('en-US')}` : ''}`;
  });
  return [...lines, `Confidence: ${c.confidence}. Gaps: ${c.gaps.join(' | ')}`].join('\n');
}
