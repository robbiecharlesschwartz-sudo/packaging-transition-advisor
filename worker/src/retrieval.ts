import type { Env } from './env';
import { parseJsonArray } from './util';

export interface Filters {
  layers?: string[];
  jurisdictions?: string[];
  excludeJurisdictions?: string[];
  material_tags?: string[];
  package_tags?: string[];
}

export interface Passage {
  chunk_id: string;
  document_id: string;
  content: string;
  section: string | null;
  page: number | null;
  layer: string;
  jurisdiction: string;
  doc_date: string | null;
  license: string;
  material_tags: string[];
  package_tags: string[];
  title: string;
  publisher: string;
  source_url: string;
  reliability: string;
  reg_status: string;
  score: number;
  vector_rank: number | null;
  keyword_rank: number | null;
}

const RRF_K = 60;
const RECENCY_LAYERS = new Set(['news', 'prices', 'regulation']);
const STOP = new Set(
  ('a an and are as at be by can could do does for from has have how i if in into is it its of on or our ' +
    'should so than that the their them then there these they this to under was we what when where which who ' +
    'why will with would you your about any all also more most move moving company companies sell sold state states').split(' '),
);

export async function embed(env: Env, texts: string[]): Promise<number[][]> {
  const res = (await env.AI.run(env.EMBED_MODEL as any, { text: texts })) as unknown as { data: number[][] };
  return res.data;
}

export function ftsQuery(q: string): string | null {
  const terms = q
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t))
    .slice(0, 14);
  if (!terms.length) return null;
  return [...new Set(terms)].map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ');
}

function vectorFilter(f: Filters): VectorizeVectorMetadataFilter | undefined {
  const filter: Record<string, unknown> = {};
  if (f.layers?.length) filter.layer = f.layers.length === 1 ? { $eq: f.layers[0] } : { $in: f.layers };
  if (f.jurisdictions?.length)
    filter.jurisdiction = f.jurisdictions.length === 1 ? { $eq: f.jurisdictions[0] } : { $in: f.jurisdictions };
  else if (f.excludeJurisdictions?.length) filter.jurisdiction = { $nin: f.excludeJurisdictions };
  return Object.keys(filter).length ? (filter as VectorizeVectorMetadataFilter) : undefined;
}

export interface SearchOptions {
  k?: number;
  perDoc?: number;
  candidates?: number;
  queryVector?: number[];
}

/** Hybrid search: Vectorize + FTS5, merged with reciprocal rank fusion, then light boosts. */
export async function hybridSearch(env: Env, query: string, filters: Filters, opts: SearchOptions = {}) {
  const k = opts.k ?? 8;
  const perDoc = opts.perDoc ?? 3;
  const n = opts.candidates ?? 40;
  const vec = opts.queryVector ?? (await embed(env, [query]))[0];

  const fq = ftsQuery(query);
  const where: string[] = [];
  const binds: unknown[] = [];
  if (filters.layers?.length) {
    where.push('c.layer IN (SELECT value FROM json_each(?))');
    binds.push(JSON.stringify(filters.layers));
  }
  if (filters.jurisdictions?.length) {
    where.push('c.jurisdiction IN (SELECT value FROM json_each(?))');
    binds.push(JSON.stringify(filters.jurisdictions));
  } else if (filters.excludeJurisdictions?.length) {
    where.push('c.jurisdiction NOT IN (SELECT value FROM json_each(?))');
    binds.push(JSON.stringify(filters.excludeJurisdictions));
  }

  const [vres, kres] = await Promise.all([
    env.VEC.query(vec, { topK: Math.min(n, 100), filter: vectorFilter(filters), returnMetadata: 'none' }),
    fq
      ? env.DB.prepare(
          `SELECT c.id AS id, bm25(chunks_fts, 2.0, 1.5, 1.0) AS s
             FROM chunks_fts f JOIN chunks c ON c.rowid = f.rowid
            WHERE chunks_fts MATCH ?${where.length ? ' AND ' + where.join(' AND ') : ''}
            ORDER BY s LIMIT ?`,
        )
          .bind(fq, ...binds, n)
          .all<{ id: string; s: number }>()
      : Promise.resolve({ results: [] as { id: string; s: number }[] }),
  ]);

  const fused = new Map<string, { score: number; v: number | null; kw: number | null }>();
  vres.matches.forEach((m, i) => fused.set(m.id, { score: 1 / (RRF_K + i + 1), v: i + 1, kw: null }));
  (kres.results ?? []).forEach((r, i) => {
    const e = fused.get(r.id) ?? { score: 0, v: null, kw: null };
    e.score += 1 / (RRF_K + i + 1);
    e.kw = i + 1;
    fused.set(r.id, e);
  });

  const top = [...fused.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, Math.max(k * 4, 24));
  if (!top.length) return { passages: [] as Passage[], stats: { vector: 0, keyword: 0, fused: 0 } };

  const rows = await env.DB.prepare(
    `SELECT c.id AS chunk_id, c.document_id, c.content, c.section, c.page, c.layer, c.jurisdiction,
            c.doc_date, c.license, c.material_tags, c.package_tags,
            d.title, d.publisher, d.source_url, d.reliability, d.reg_status
       FROM chunks c JOIN documents d ON d.id = c.document_id
      WHERE c.id IN (SELECT value FROM json_each(?))`,
  )
    .bind(JSON.stringify(top.map(([id]) => id)))
    .all<Record<string, any>>();

  const wantMats = new Set((filters.material_tags ?? []).map((t) => t.toLowerCase()));
  const wantPkgs = new Set((filters.package_tags ?? []).map((t) => t.toLowerCase()));
  const thisYear = new Date().getUTCFullYear();
  const byId = new Map(rows.results.map((r) => [r.chunk_id as string, r]));

  const scored: Passage[] = [];
  for (const [id, f] of top) {
    const r = byId.get(id);
    if (!r) continue;
    const mats = parseJsonArray(r.material_tags);
    const pkgs = parseJsonArray(r.package_tags);
    let s = f.score;
    if (RECENCY_LAYERS.has(r.layer)) {
      const y = parseInt(String(r.doc_date ?? '').slice(0, 4), 10);
      if (y) s *= 1 + 0.2 * Math.max(0, Math.min(1, (y - (thisYear - 8)) / 8));
    }
    if (wantMats.size && mats.some((t) => wantMats.has(t.toLowerCase()))) s *= 1.15;
    if (wantPkgs.size && pkgs.some((t) => wantPkgs.has(t.toLowerCase()))) s *= 1.1;
    if (r.reliability === 'primary') s *= 1.05;
    scored.push({
      ...(r as any),
      material_tags: mats,
      package_tags: pkgs,
      score: s,
      vector_rank: f.v,
      keyword_rank: f.kw,
    });
  }
  scored.sort((a, b) => b.score - a.score);

  const perDocCount = new Map<string, number>();
  const passages: Passage[] = [];
  for (const p of scored) {
    const c = perDocCount.get(p.document_id) ?? 0;
    if (c >= perDoc) continue;
    perDocCount.set(p.document_id, c + 1);
    passages.push(p);
    if (passages.length >= k) break;
  }
  return {
    passages,
    stats: { vector: vres.matches.length, keyword: kres.results?.length ?? 0, fused: fused.size },
  };
}

export const OPTIONAL_MARKETS = ['CA', 'CA-ON', 'EU', 'UK'];

/**
 * Jurisdiction filter for a profile. Selected states -> include federal + those states (+ chosen markets).
 * Nationwide / no states -> every US jurisdiction: exclude only the optional markets not chosen.
 */
export function jurisdictionFilter(
  states: string[] | undefined,
  other: string[] | undefined,
): Pick<Filters, 'jurisdictions' | 'excludeJurisdictions'> {
  const st = (states ?? []).filter((s) => s && s !== 'nationwide');
  const markets = new Set<string>();
  (other ?? []).forEach((m) => {
    markets.add(m);
    if (m === 'CA') markets.add('CA-ON');
  });
  if (!st.length || (states ?? []).includes('nationwide')) {
    return { excludeJurisdictions: OPTIONAL_MARKETS.filter((m) => !markets.has(m)) };
  }
  return { jurisdictions: ['US', 'global', ...st.map((s) => `US-${s.toUpperCase()}`), ...markets] };
}
