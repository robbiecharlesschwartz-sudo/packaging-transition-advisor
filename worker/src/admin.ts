import type { Env } from './env';
import { embed } from './retrieval';
import { err, json, nowIso, safeEqual } from './util';

export function isAdmin(req: Request, env: Env): boolean {
  const h = req.headers.get('authorization') ?? '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
  return !!env.ADMIN_TOKEN && !!tok && safeEqual(tok, env.ADMIN_TOKEN);
}

export interface IngestDoc {
  id: string;
  title: string;
  publisher: string;
  source_url: string;
  layer: string;
  jurisdiction: string;
  doc_date?: string;
  fetched_date?: string;
  reg_status?: string;
  reliability: string;
  license: string;
  content_hash?: string;
  material_tags?: string[];
  package_tags?: string[];
  summary?: string | null;
  chunk_count?: number;
}

export interface IngestChunk {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  page?: number | null;
  section?: string | null;
  layer: string;
  jurisdiction: string;
  doc_date?: string;
  year?: number | null;
  license: string;
  reliability: string;
  title: string;
  material_tags: string[];
  package_tags: string[];
}

/** POST /api/admin/ingest  {document, chunks, replace}
 * Upserts a document row, embeds the chunks with Workers AI and writes them to Vectorize + D1/FTS5.
 * `replace: true` (first batch of a document) removes that document's previous chunks first. */
export async function ingest(req: Request, env: Env): Promise<Response> {
  const body = (await req.json()) as { document: IngestDoc; chunks: IngestChunk[]; replace?: boolean };
  return ingestCore(env, body);
}

export async function ingestCore(env: Env, body: { document: IngestDoc; chunks: IngestChunk[]; replace?: boolean }): Promise<Response> {
  const d = body.document;
  if (!d?.id || !Array.isArray(body.chunks)) return err('document and chunks required');
  if (body.chunks.length > 50) return err('max 50 chunks per request');

  if (body.replace) {
    const old = await env.DB.prepare('SELECT id FROM chunks WHERE document_id = ?').bind(d.id).all<{ id: string }>();
    const oldIds = old.results.map((r) => r.id);
    if (oldIds.length) {
      for (let i = 0; i < oldIds.length; i += 500) await env.VEC.deleteByIds(oldIds.slice(i, i + 500));
      await env.DB.batch([
        env.DB.prepare('DELETE FROM chunks_fts WHERE rowid IN (SELECT rowid FROM chunks WHERE document_id = ?)').bind(d.id),
        env.DB.prepare('DELETE FROM chunks WHERE document_id = ?').bind(d.id),
      ]);
    }
  }

  await env.DB.prepare(
    `INSERT INTO documents (id,title,publisher,source_url,layer,jurisdiction,doc_date,fetched_date,reg_status,
       reliability,license,content_hash,material_tags,package_tags,summary,chunk_count)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET title=excluded.title, publisher=excluded.publisher, source_url=excluded.source_url,
       layer=excluded.layer, jurisdiction=excluded.jurisdiction, doc_date=excluded.doc_date,
       fetched_date=excluded.fetched_date, reg_status=excluded.reg_status, reliability=excluded.reliability,
       license=excluded.license, content_hash=excluded.content_hash, material_tags=excluded.material_tags,
       package_tags=excluded.package_tags, summary=excluded.summary, chunk_count=excluded.chunk_count`,
  )
    .bind(
      d.id, d.title, d.publisher, d.source_url, d.layer, d.jurisdiction, d.doc_date ?? null, d.fetched_date ?? null,
      d.reg_status ?? 'n/a', d.reliability, d.license, d.content_hash ?? null,
      JSON.stringify(d.material_tags ?? []), JSON.stringify(d.package_tags ?? []), d.summary ?? null,
      d.chunk_count ?? 0,
    )
    .run();

  if (!body.chunks.length) return json({ ok: true, chunks: 0 });

  // Title + section are prepended so short chunks still carry their context into the vector.
  const texts = body.chunks.map((c) => `${c.title}${c.section ? ' — ' + c.section : ''}\n${c.content}`);
  const vectors = await embed(env, texts);
  await env.VEC.upsert(
    body.chunks.map((c, i) => ({
      id: c.id,
      values: vectors[i],
      metadata: {
        document_id: c.document_id,
        layer: c.layer,
        jurisdiction: c.jurisdiction,
        license: c.license,
        reliability: c.reliability,
        year: c.year ?? 0,
      },
    })),
  );

  const stmts: D1PreparedStatement[] = [];
  for (const c of body.chunks) {
    stmts.push(
      env.DB.prepare('DELETE FROM chunks_fts WHERE rowid = (SELECT rowid FROM chunks WHERE id = ?)').bind(c.id),
      env.DB.prepare(
        `INSERT OR REPLACE INTO chunks (id,document_id,chunk_index,content,page,section,layer,jurisdiction,doc_date,
           license,material_tags,package_tags) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        c.id, c.document_id, c.chunk_index, c.content, c.page ?? null, c.section ?? null, c.layer, c.jurisdiction,
        c.doc_date ?? null, c.license, JSON.stringify(c.material_tags), JSON.stringify(c.package_tags),
      ),
      env.DB.prepare('INSERT INTO chunks_fts (rowid,title,section,content) SELECT rowid, ?, ?, ? FROM chunks WHERE id = ?').bind(
        c.title, c.section ?? '', c.content, c.id,
      ),
    );
  }
  await env.DB.batch(stmts);
  await env.DB.prepare(`INSERT OR REPLACE INTO meta (key,value) VALUES ('corpus_updated', ?)`).bind(nowIso()).run();
  return json({ ok: true, chunks: body.chunks.length });
}

const LOADABLE: Record<string, string[]> = {
  price_inputs: ['id', 'material', 'kind', 'unit', 'low', 'high', 'base_period', 'ppi_series', 'source_doc_id',
    'source_chunk_id', 'source_url', 'note', 'reliability', 'reviewed'],
  epr_fees: ['id', 'state', 'material_category', 'material_keys', 'fee_per_kg', 'fee_unit_original', 'effective_date',
    'source_doc_id', 'source_chunk_id', 'source_url'],
  state_laws: ['id', 'state', 'law_type', 'status', 'title', 'enacted_date', 'key_date', 'key_date_event', 'note',
    'source_doc_id', 'source_url'],
  ppi_series: ['series_id', 'period', 'value', 'label'],
  suppliers: ['id', 'company_name', 'website', 'inquiry_url', 'material_tags', 'product_tags', 'certifications',
    'scale_tier', 'source_doc_ids', 'evidence', 'last_verified'],
  supplier_plants: ['id', 'supplier_id', 'city', 'state', 'lat', 'lng', 'plant_type', 'source_doc_id'],
  supplier_prices: ['id', 'supplier_id', 'product_desc', 'unit', 'low', 'high', 'moq', 'captured_date', 'source_url'],
  runs: ['id', 'created_at', 'workflow_id', 'profile', 'question', 'status', 'output', 'retrieved_chunk_ids',
    'is_example', 'example_slug', 'model', 'error'],
  run_steps: ['run_id', 'step_id', 'status', 'started_at', 'ended_at', 'summary', 'detail'],
};

/** POST /api/admin/load {table, rows, truncate}: replaces structured tables from versioned JSON files. */
export async function loadTable(req: Request, env: Env): Promise<Response> {
  const body = (await req.json()) as { table: string; rows: Record<string, unknown>[]; truncate?: boolean };
  const cols = LOADABLE[body.table];
  if (!cols) return err(`table not loadable: ${body.table}`);
  const stmts: D1PreparedStatement[] = [];
  if (body.truncate) stmts.push(env.DB.prepare(`DELETE FROM ${body.table}`));
  for (const r of body.rows) {
    const vals = cols.map((c) => {
      const v = r[c];
      if (v === undefined) return null;
      if (Array.isArray(v) || (v && typeof v === 'object')) return JSON.stringify(v);
      if (typeof v === 'boolean') return v ? 1 : 0;
      return v;
    });
    stmts.push(
      env.DB.prepare(
        `INSERT OR REPLACE INTO ${body.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
      ).bind(...vals),
    );
  }
  for (let i = 0; i < stmts.length; i += 80) await env.DB.batch(stmts.slice(i, i + 80));
  return json({ ok: true, table: body.table, rows: body.rows.length });
}

/** POST /api/admin/delete-doc {id} */
export async function deleteDoc(req: Request, env: Env): Promise<Response> {
  const { id } = (await req.json()) as { id: string };
  const old = await env.DB.prepare('SELECT id FROM chunks WHERE document_id = ?').bind(id).all<{ id: string }>();
  const ids = old.results.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 500) await env.VEC.deleteByIds(ids.slice(i, i + 500));
  await env.DB.batch([
    env.DB.prepare('DELETE FROM chunks_fts WHERE rowid IN (SELECT rowid FROM chunks WHERE document_id = ?)').bind(id),
    env.DB.prepare('DELETE FROM chunks WHERE document_id = ?').bind(id),
    env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(id),
  ]);
  return json({ ok: true, deleted_chunks: ids.length });
}

/** POST /api/admin/hashes: {doc_id: content_hash} so ingestion only re-embeds changed documents. */
export async function hashes(env: Env): Promise<Response> {
  const r = await env.DB.prepare('SELECT id, content_hash FROM documents').all<{ id: string; content_hash: string }>();
  return json(Object.fromEntries(r.results.map((x) => [x.id, x.content_hash])));
}

/** POST /api/admin/recount: refresh cached corpus counters (run once after an ingest batch). */
export async function recount(env: Env): Promise<Response> {
  await env.DB.batch([
    env.DB.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('chunk_count', (SELECT COUNT(*) FROM chunks))`),
    env.DB.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('document_count', (SELECT COUNT(*) FROM documents))`),
  ]);
  return json({ ok: true });
}
