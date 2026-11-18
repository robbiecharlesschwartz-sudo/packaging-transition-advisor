// TypeScript port of cost/geometry.py + cost/calculator.py. Both are tested against cost/tests/cases.json,
// so the numbers shown on the site match the hand-checked Python implementation.

type Range = { low: number | null; high: number | null };
export interface CatalogInput {
  id: string;
  kind: string;
  low: number;
  high: number;
  ppi_series?: string | null;
  basis?: string;
  reliability?: string;
  chunk_id?: string | null;
  [k: string]: unknown;
}
export interface FeeRow {
  id: string;
  state: string;
  material_category: string;
  material_keys: string[];
  fee_per_kg_low: number;
  fee_per_kg_high: number;
  reliability?: string;
  chunk_id?: string | null;
  [k: string]: unknown;
}
export interface Catalog {
  states_fees_in_effect?: string[];
  states_fee_schedule_public?: string[];
  inputs: CatalogInput[];
  materials: Record<string, Record<string, string | null>>;
  epr_fees: FeeRow[];
}
export interface LawRow { state: string; law_type: string; status: string; [k: string]: unknown }
export interface CostOption { key: string; label: string; is_current?: boolean }

const FLEX = new Set(['pe_film', 'pp_film', 'multilayer_film', 'pla_film']);
const GRAMMAGE_KEYS = new Set(['paper_kraft', 'paper_barrier', 'paperboard']);
const RIGID_PLASTIC = new Set(['pet', 'rpet', 'hdpe', 'pp_rigid', 'pla_rigid']);
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function areaCm2(pt: string | undefined, dims: Record<string, number | undefined> | undefined): [number | null, string] {
  const d = dims ?? {};
  const L = d.l_cm, W = d.w_cm, H = d.h_cm, g = d.gusset_cm ?? 0, V = d.volume_ml;
  const t = pt ?? 'other';
  if ((t === 'flexible pouch/film' || t === 'mailer') && L && W)
    return [2 * L * W + 2 * g * W, `2·L·W${g ? ' + 2·gusset·W' : ''} (two faces${g ? ', gusset' : ''}; seals ignored)`];
  if ((t === 'corrugated box' || t === 'folding carton') && L && W && H)
    return [2 * (L * W + L * H + W * H), '2(LW + LH + WH) (closed box; flaps and overlaps ignored)'];
  if (t === 'tray/clamshell' && L && W && H) return [2 * (L * W + 2 * H * (L + W)), 'clamshell = 2 × open tray (LW + 2H(L+W))'];
  if (['rigid bottle', 'jar', 'can', 'cup/lid'].includes(t)) {
    let r: number, h: number;
    if (W && H) { r = W / 2; h = H; }
    else if (V) {
      const ratio = ({ 'rigid bottle': 2.5, jar: 1.0, can: 1.8, 'cup/lid': 1.2 } as Record<string, number>)[t];
      r = Math.cbrt(V / (2 * Math.PI * ratio));
      h = ratio * 2 * r;
    } else return [null, 'needs volume or diameter and height'];
    if (t === 'cup/lid') return [Math.PI * r * r + 2 * Math.PI * r * h, 'open cylinder (base + wall)' + (W ? '' : ' from volume, h = 1.2·d')];
    return [2 * Math.PI * r * h + 2 * Math.PI * r * r, 'closed cylinder (wall + 2 ends)' + (W ? '' : ' from volume, h/d assumed')];
  }
  if (t === 'label/sleeve' && L && W) return [L * W, 'L·W (single layer)'];
  if (L && W && H) return [2 * (L * W + L * H + W * H), '2(LW + LH + WH)'];
  if (L && W) return [2 * L * W, '2·L·W'];
  return [null, 'dimensions not given'];
}

const input = (c: Catalog, id?: string | null) => (id ? c.inputs.find((i) => i.id === id) ?? null : null);
const mat = (c: Catalog, k: string) => c.materials[k] ?? {};

export function priceFor(c: Catalog, key: string, pt?: string) {
  const m = mat(c, key);
  if (key === 'pe_film' && pt === 'mailer' && m.sacks) return input(c, m.sacks);
  if (key === 'paperboard' && pt !== 'folding carton' && m.sheet) return input(c, m.sheet);
  if (key === 'aluminum' && ['flexible pouch/film', 'tray/clamshell', 'label/sleeve'].includes(pt ?? '') && m.foil) return input(c, m.foil);
  return input(c, m.price);
}

interface Weight extends Range { method: string; inputs: string[]; gap?: boolean; assumption?: string }

function thicknessCm(th: any) {
  return th.unit === 'micron' ? th.value / 10000 : th.value / 10;
}

export function currentWeight(p: any, key: string, c: Catalog): Weight {
  if (p.unit_weight_g) {
    const w = Number(p.unit_weight_g);
    return { low: w, high: w, method: 'given in profile', inputs: [] };
  }
  const [area, how] = areaCm2(p.package_type, p.dimensions);
  const dens = input(c, mat(c, key).density);
  if (area && p.thickness && dens) {
    const cm = thicknessCm(p.thickness);
    return { low: r3(area * cm * dens.low), high: r3(area * cm * dens.high),
      method: `area ${area.toFixed(0)} cm² (${how}) × thickness × density`, inputs: [dens.id] };
  }
  const cont = input(c, mat(c, key).container);
  if (cont && ['rigid bottle', 'can', 'jar'].includes(p.package_type))
    return { low: cont.low, high: cont.high, method: 'average beverage-container weight (CalRecycle)', inputs: [cont.id] };
  return { low: null, high: null, method: 'gap: give unit weight, or dimensions + thickness', inputs: [], gap: true };
}

export function altWeight(p: any, key: string, curKey: string, cur: Weight, c: Catalog): Weight {
  if (key === curKey) return { ...cur };
  const [area, how] = areaCm2(p.package_type, p.dimensions);
  const m = mat(c, key), cm = mat(c, curKey);
  const hasCur = cur.low !== null;
  if (GRAMMAGE_KEYS.has(key)) {
    const gram = input(c, m.grammage);
    if (area && gram) {
      const m2 = area / 10000;
      return { low: r3(m2 * gram.low), high: r3(m2 * gram.high), method: `area ${area.toFixed(0)} cm² (${how}) × cited grammage range`, inputs: [gram.id] };
    }
  }
  const ca = input(c, m.container), cc = input(c, cm.container);
  if (hasCur && ca && cc) {
    const r = ca.low / cc.low;
    return { low: r3(cur.low! * r), high: r3(cur.high! * r), method: `current weight × average container-weight ratio ${r.toFixed(2)} (CalRecycle)`,
      inputs: [ca.id, cc.id], assumption: 'ratio of average beverage containers, not same-size' };
  }
  const da = input(c, m.density), dc = input(c, cm.density);
  if (area && p.thickness && da) {
    const t = thicknessCm(p.thickness);
    return { low: r3(area * t * da.low), high: r3(area * t * da.high), method: 'same wall/film thickness × alternative density',
      inputs: [da.id], assumption: 'same gauge as the current package' };
  }
  const sameFamily = (FLEX.has(key) && FLEX.has(curKey)) || (RIGID_PLASTIC.has(key) && RIGID_PLASTIC.has(curKey));
  if (hasCur && sameFamily) {
    if (da && dc) {
      const lo = da.low / dc.high, hi = da.high / dc.low;
      return { low: r3(cur.low! * lo), high: r3(cur.high! * hi), method: 'current weight × density ratio', inputs: [da.id, dc.id],
        assumption: 'same gauge as the current package' };
    }
    return { low: cur.low, high: cur.high, method: 'equal weight assumed', inputs: [],
      assumption: 'no cited gauge or density for one of the materials; equal weight assumed' };
  }
  return { low: null, high: null, method: "gap: no cited basis to estimate this alternative's weight", inputs: [], gap: true };
}

function eprStates(p: any, c: Catalog, laws: LawRow[]): string[] {
  const ss: string[] = p.sales_states ?? [];
  const st = ss.filter((s) => s && s !== 'nationwide');
  if (!st.length || ss.includes('nationwide'))
    return [...new Set([...(c.states_fees_in_effect ?? []), ...laws.filter((l) => l.law_type === 'epr').map((l) => l.state)])].sort();
  return st;
}

export function eprFor(state: string, key: string, w: Range, c: Catalog, laws: LawRow[]): any {
  const rows = c.epr_fees.filter((f) => f.state === state && f.material_keys.includes(key));
  if (rows.length && w.low !== null) {
    const f = rows[0];
    return { low: (w.low! / 1000) * f.fee_per_kg_low, high: (w.high! / 1000) * f.fee_per_kg_high, category: f.material_category, inputs: [f.id] };
  }
  const law = laws.find((l) => l.state === state && l.law_type === 'epr');
  if ((c.states_fees_in_effect ?? []).includes(state)) {
    if ((c.states_fee_schedule_public ?? []).includes(state)) return { status: 'fees in effect; no fee category mapped for this material', gap: true };
    return { status: 'fees in effect; fee schedule not public', gap: true };
  }
  if (law) return { status: 'law enacted; fees not yet in effect' };
  return { status: 'no packaging EPR law in corpus' };
}

export function estimate(p: any, options: CostOption[], c: Catalog, laws: LawRow[], ppi: Record<string, number> = {}) {
  const pt = p.package_type;
  const curOpt = options.find((o) => o.is_current) ?? options[0];
  const curKey = curOpt.key;
  const curW = currentWeight(p, curKey, c);
  const states = eprStates(p, c, laws);
  const units: number | undefined = p.annual_units;
  const out: any[] = [];
  const used = new Set<string>();
  const gaps: string[] = [];

  for (const o of options) {
    const key = o.key;
    const w = o.is_current ? curW : altWeight(p, key, curKey, curW, c);
    w.inputs.forEach((i) => used.add(i));
    const price = priceFor(c, key, pt);
    let m: any = null;
    if (price && w.low !== null) {
      const f = ppi[price.ppi_series ?? ''] ?? 1.0;
      m = { low: (w.low / 1000) * price.low * f, high: (w.high! / 1000) * price.high * f, basis: price.basis,
        ppi_factor: Math.round(f * 10000) / 10000, inputs: [price.id] };
      used.add(price.id);
    } else gaps.push(`${o.label}: material cost not estimated (${!price ? 'no cited $/kg price' : 'weight unknown'})`);
    if (w.gap) gaps.push(`${o.label}: ${w.method}`);
    const epr: Record<string, any> = {};
    for (const s of states) {
      epr[s] = eprFor(s, key, w, c, laws);
      (epr[s].inputs ?? []).forEach((i: string) => used.add(i));
    }
    const fees = Object.values(epr).filter((e: any) => 'low' in e) as any[];
    const total = m ? { low: m.low + (fees.length ? Math.min(...fees.map((e) => e.low)) : 0),
      high: m.high + (fees.length ? Math.max(...fees.map((e) => e.high)) : 0) } : null;
    const annual = total && units ? { low: total.low * units, high: total.high * units } : null;
    let delta = null;
    if (!o.is_current && w.low !== null && curW.low !== null) delta = { low: r3(w.low - curW.high!), high: r3(w.high! - curW.low) };
    out.push({ key, label: o.label, is_current: !!o.is_current, weight_g: w, material_cost: m, epr,
      freight: { weight_delta_g: delta, cost: null, note: 'no cited freight $/kg in corpus' }, total_per_unit: total, annual });
  }
  for (const s of states)
    if (out.some((o) => String(o.epr[s].status ?? '').startsWith('fees in effect; fee schedule not public')))
      gaps.push(`${s}: EPR fees are in effect but the fee schedule is not public`);
  gaps.push('Freight: no cited freight cost per kg; only the weight difference is shown');
  if (out.some((o) => o.material_cost && String(o.material_cost.basis ?? '').includes('proxy')))
    gaps.push("Some prices use a trade-category proxy (marked 'proxy'); confirm with supplier quotes");

  const inputs = [...c.inputs.filter((i) => used.has(i.id)), ...c.epr_fees.filter((f) => used.has(f.id))];
  const primary = inputs.filter((i) => i.reliability === 'primary').length;
  const complete = out.every((o) => o.total_per_unit);
  const confidence = complete && inputs.length && primary / inputs.length >= 0.6 ? 'Medium' : 'Low';
  return {
    options: out, states, confidence, gaps: [...new Set(gaps)].sort(), inputs, annual_units: units ?? null,
    note: 'Order-of-magnitude estimate from public data (trade-statistics unit values, PRO fee schedules), not a supplier quote. Ranges, not point values.',
  };
}
