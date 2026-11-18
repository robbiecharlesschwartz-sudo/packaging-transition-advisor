import type { Env } from './env';
import { llmJson } from './llm';
import { verifierPrompt } from './prompts';
import type { Claim, NumberedPassage, SectionOut } from './types';

/** A sentence anywhere in a section (claim or structured item) that must be backed by its cites. */
export interface Checkable {
  key: string; // section:path
  text: string;
  cites: number[];
  verdict?: 'supported' | 'partial' | 'unsupported';
  note?: string;
}

const NUM_RX = /\$?\d[\d,]*(?:\.\d+)?%?/g;

function normalizeNum(s: string): string {
  return s.replace(/[$,%]/g, '').replace(/\.0+$/, '');
}

/** Numbers that matter: anything with a decimal, $, %, a comma, or 2+ digits. */
export function significantNumbers(text: string): string[] {
  return (text.match(NUM_RX) ?? [])
    .filter((t) => /[.$%,]/.test(t) || t.replace(/\D/g, '').length >= 2)
    .map(normalizeNum)
    .filter((n) => n.length > 0);
}

export function numberAppears(n: string, haystack: string): boolean {
  const h = haystack.replace(/(\d),(\d{3})/g, '$1$2');
  if (h.includes(n)) return true;
  const f = parseFloat(n);
  if (!Number.isFinite(f)) return false;
  // allow trailing-zero / rounding variants (e.g. 12 vs 12.0, 0.26 vs 0.264)
  return (h.match(/\d+(?:\.\d+)?/g) ?? []).some((x) => {
    const v = parseFloat(x);
    return v === f || (n.includes('.') && Math.abs(v - f) / Math.max(Math.abs(f), 1e-9) < 0.006);
  });
}

function pushItem(out: Checkable[], key: string, text: string | undefined, cites: unknown) {
  if (!text || !String(text).trim()) return;
  out.push({ key, text: String(text), cites: Array.isArray(cites) ? cites.map(Number).filter(Number.isFinite) : [] });
}

export function collectCheckables(s: SectionOut): Checkable[] {
  const out: Checkable[] = [];
  s.claims.forEach((c, i) => pushItem(out, `${s.id}:claims.${i}`, c.text, c.cites));
  const d = s.data ?? {};
  (d.options ?? []).forEach((o: any, i: number) => {
    (o.reasons ?? []).forEach((r: any, j: number) => pushItem(out, `${s.id}:options.${i}.reasons.${j}`, `${o.name}: ${r.text}`, r.cites));
    (o.needs ?? []).forEach((n: any, j: number) => {
      if (n.rating !== 'Unknown') pushItem(out, `${s.id}:options.${i}.needs.${j}`, `${o.name} for ${n.need}: ${n.rating}. ${n.note ?? ''}`, n.cites);
    });
  });
  (d.rows ?? []).forEach((r: any, i: number) => {
    if (s.kind === 'regulatory') {
      (r.key_dates ?? []).forEach((k: any, j: number) => pushItem(out, `${s.id}:rows.${i}.key_dates.${j}`, `${r.jurisdiction}: ${k.date} ${k.event}`, k.cites));
      for (const f of ['recycled_content', 'bans', 'labeling'])
        if (r[f]?.text) pushItem(out, `${s.id}:rows.${i}.${f}`, `${r.jurisdiction}: ${r[f].text}`, r[f].cites);
    } else if (s.kind === 'eol') {
      if (r.status !== 'unknown') pushItem(out, `${s.id}:rows.${i}`, `${r.alternative} in ${r.location} (${r.pathway}): ${r.status}. ${r.note ?? ''}`, r.cites);
    }
  });
  for (const f of ['safe', 'risky'])
    (d[f] ?? []).forEach((c: any, i: number) => pushItem(out, `${s.id}:${f}.${i}`, `"${c.claim}" is ${f === 'safe' ? 'a supportable claim' : 'risky'}: ${c.why}`, c.cites));
  (d.examples ?? []).forEach((e: any, i: number) => pushItem(out, `${s.id}:examples.${i}`, `${e.company}${e.year ? ` (${e.year})` : ''}: ${e.action}`, e.cites));
  return out;
}

/** Deterministic checks: cites must exist in the section's passages; significant numbers must appear in
 * a cited passage, the calculator output or the user's own profile. */
export function codeCheck(items: Checkable[], allowed: Set<number>, byN: Map<number, NumberedPassage>, extraNumbers: string) {
  for (const it of items) {
    const good = it.cites.filter((n) => allowed.has(n));
    if (!good.length) {
      it.verdict = 'unsupported';
      it.note = it.cites.length ? 'cited passage numbers not in this section' : 'no citation';
      continue;
    }
    it.cites = good;
    const hay = good.map((n) => byN.get(n)?.content ?? '').join(' ') + ' ' + extraNumbers;
    const missing = significantNumbers(it.text).filter((n) => !numberAppears(n, hay));
    if (missing.length) {
      it.verdict = 'unsupported';
      it.note = `number(s) ${missing.join(', ')} not found in cited passages`;
    }
  }
}

export async function llmVerify(env: Env, items: Checkable[], byN: Map<number, NumberedPassage>, batchSize = 18) {
  const todo = items.filter((i) => !i.verdict);
  let calls = 0;
  for (let b = 0; b < todo.length; b += batchSize) {
    const batch = todo.slice(b, b + batchSize);
    const payload = batch.map((it, i) => ({
      id: i,
      text: it.text,
      passages: it.cites.map((n) => `[${n}] ${(byN.get(n)?.content ?? '').slice(0, 1100)}`).join('\n'),
    }));
    try {
      const { data } = await llmJson<{ verdicts: { id: number; verdict: string; note?: string }[] }>(env, {
        ...verifierPrompt(payload),
        maxTokens: 4096,
        temperature: 0,
      });
      calls++;
      for (const v of data.verdicts ?? []) {
        const it = batch[v.id];
        if (!it) continue;
        it.verdict = (['supported', 'partial', 'unsupported'].includes(v.verdict) ? v.verdict : 'partial') as Checkable['verdict'];
        it.note = v.note;
      }
    } catch (e) {
      for (const it of batch) {
        it.verdict = 'partial';
        it.note = 'verifier unavailable; not independently checked';
      }
    }
  }
  for (const it of todo) if (!it.verdict) { it.verdict = 'partial'; it.note = 'verifier returned no verdict'; }
  return calls;
}

/** Writes verdicts back into the section, removes unsupported content, and sets the status label. */
export function applyVerdicts(s: SectionOut, items: Checkable[]) {
  const byKey = new Map(items.map((i) => [i.key, i]));
  const removed: Claim[] = [];
  const keep = <T,>(arr: T[] | undefined, prefix: string, toText: (x: T) => string, setV: (x: T, c: Checkable) => void): T[] =>
    (arr ?? []).filter((x, i) => {
      const c = byKey.get(`${prefix}${i}`);
      if (!c) return true;
      setV(x, c);
      if (c.verdict === 'unsupported') {
        removed.push({ text: toText(x), cites: c.cites, verdict: 'unsupported', note: c.note });
        return false;
      }
      return true;
    });
  const setVerdict = (x: any, c: Checkable) => { x.verdict = c.verdict; x.note_verifier = c.note; x.cites = c.cites; };

  s.claims = keep(s.claims, `${s.id}:claims.`, (c) => c.text, (c, v) => { c.verdict = v.verdict; c.note = v.note; c.cites = v.cites; });
  const d = s.data ?? {};
  (d.options ?? []).forEach((o: any, i: number) => {
    o.reasons = keep(o.reasons, `${s.id}:options.${i}.reasons.`, (r: any) => `${o.name}: ${r.text}`, setVerdict);
    o.needs = (o.needs ?? []).map((n: any, j: number) => {
      const c = byKey.get(`${s.id}:options.${i}.needs.${j}`);
      if (!c) return n;
      setVerdict(n, c);
      if (c.verdict === 'unsupported') {
        removed.push({ text: `${o.name} for ${n.need}: ${n.rating}`, cites: c.cites, verdict: 'unsupported', note: c.note });
        return { ...n, rating: 'Unknown', note: 'claim removed: not supported by the cited passages', cites: [] };
      }
      return n;
    });
  });
  if (s.kind === 'regulatory') {
    (d.rows ?? []).forEach((r: any, i: number) => {
      r.key_dates = keep(r.key_dates, `${s.id}:rows.${i}.key_dates.`, (k: any) => `${r.jurisdiction}: ${k.date} ${k.event}`, setVerdict);
      for (const f of ['recycled_content', 'bans', 'labeling']) {
        const c = byKey.get(`${s.id}:rows.${i}.${f}`);
        if (!c || !r[f]) continue;
        setVerdict(r[f], c);
        if (c.verdict === 'unsupported') {
          removed.push({ text: `${r.jurisdiction}: ${r[f].text}`, cites: c.cites, verdict: 'unsupported', note: c.note });
          r[f] = { text: '', cites: [] };
        }
      }
    });
  }
  if (s.kind === 'eol') d.rows = keep(d.rows, `${s.id}:rows.`, (r: any) => `${r.alternative} in ${r.location}: ${r.status}`, setVerdict);
  for (const f of ['safe', 'risky']) if (d[f]) d[f] = keep(d[f], `${s.id}:${f}.`, (c: any) => c.claim, setVerdict);
  if (d.examples) d.examples = keep(d.examples, `${s.id}:examples.`, (e: any) => `${e.company}: ${e.action}`, setVerdict);

  s.removed = removed;
  const surviving = items.filter((i) => i.verdict !== 'unsupported');
  const supported = surviving.filter((i) => i.verdict === 'supported').length;
  if (!surviving.length) s.status = 'Evidence Gap';
  else if (supported === items.length) s.status = 'Grounded';
  else s.status = 'Partial';
  return { total: items.length, supported, partial: surviving.length - supported, removed: removed.length };
}
