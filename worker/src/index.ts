import { STEPS } from '../../pipeline/steps';
import { deleteDoc, hashes, ingest, isAdmin, loadTable, recount } from './admin';
import { MATERIALS } from './catalog';
import { CATALOG, LAWS } from './cost/run';
import type { Env } from './env';
import { listGeminiModels, llmJson } from './llm';
import { refresh } from './refresh';
import { hybridSearch, jurisdictionFilter } from './retrieval';
import type { Profile } from './types';
import { err, json, nowIso } from './util';
import { getWorkflow, workflows } from './workflows';

export { BriefWorkflow } from './workflow';

const CACHE = { 'cache-control': 'public, max-age=300' };

async function rateLimit(env: Env, ip: string): Promise<string | null> {
  const day = new Date().toISOString().slice(0, 10);
  const perIp = parseInt(env.DAILY_RUNS_PER_IP, 10) || 8;
  const global = parseInt(env.DAILY_RUNS_GLOBAL, 10) || 150;
  const rows = await env.DB.prepare(`SELECT key, count FROM rate_limits WHERE day = ? AND key IN (?, '__global__')`).bind(day, ip).all<{ key: string; count: number }>();
  const mine = rows.results.find((r) => r.key === ip)?.count ?? 0;
  const all = rows.results.find((r) => r.key === '__global__')?.count ?? 0;
  if (mine >= perIp) return `Daily limit reached (${perIp} live runs per visitor). Replay mode shows full example runs without using the free LLM quota.`;
  if (all >= global) return 'The free LLM quota for today is used up. Try replay mode, or come back tomorrow.';
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO rate_limits (key, day, count) VALUES (?, ?, 1) ON CONFLICT(key, day) DO UPDATE SET count = count + 1`).bind(ip, day),
    env.DB.prepare(`INSERT INTO rate_limits (key, day, count) VALUES ('__global__', ?, 1) ON CONFLICT(key, day) DO UPDATE SET count = count + 1`).bind(day),
  ]);
  return null;
}

function cleanProfile(p: any): Profile | null {
  if (!p || typeof p !== 'object') return null;
  const num = (x: any) => (x === '' || x === null || x === undefined || !Number.isFinite(Number(x)) ? undefined : Number(x));
  const arr = (x: any) => (Array.isArray(x) ? x.map(String).filter(Boolean).slice(0, 60) : undefined);
  const str = (x: any, n = 600) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, n) : undefined);
  const d = p.dimensions ?? {};
  return {
    company_description: str(p.company_description, 1200), product_category: str(p.product_category), package_type: str(p.package_type),
    current_material: str(p.current_material),
    dimensions: { l_cm: num(d.l_cm), w_cm: num(d.w_cm), h_cm: num(d.h_cm), gusset_cm: num(d.gusset_cm), volume_ml: num(d.volume_ml) },
    thickness: num(p.thickness?.value) ? { value: num(p.thickness.value)!, unit: p.thickness.unit === 'mm' ? 'mm' : 'micron' } : undefined,
    unit_weight_g: num(p.unit_weight_g), annual_units: num(p.annual_units),
    components: Array.isArray(p.components) ? p.components.slice(0, 10).map((c: any) => ({ name: String(c.name ?? '').slice(0, 60), material: str(c.material, 60), weight_g: num(c.weight_g) })) : undefined,
    sales_states: arr(p.sales_states)?.map((s) => s.toUpperCase() === 'NATIONWIDE' ? 'nationwide' : s.toUpperCase().slice(0, 2)),
    other_markets: arr(p.other_markets)?.filter((m) => ['CA', 'EU', 'UK'].includes(m)),
    functional_needs: arr(p.functional_needs), candidate_alternatives: arr(p.candidate_alternatives),
    sourcing_preferences: p.sourcing_preferences ? {
      us_made: !!p.sourcing_preferences.us_made, near_sales_states: !!p.sourcing_preferences.near_sales_states,
      certifications: arr(p.sourcing_preferences.certifications), scale: ['small', 'mid', 'large'].includes(p.sourcing_preferences.scale) ? p.sourcing_preferences.scale : undefined,
    } : undefined,
  };
}

async function createRun(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => null)) as any;
  if (!body) return err('JSON body required');
  const wf = getWorkflow(String(body.workflow_id ?? ''));
  if (!wf) return err('unknown workflow_id');
  const question = typeof body.question === 'string' && body.question.trim() ? body.question.trim().slice(0, 1000) : null;
  const profile = cleanProfile(body.profile);
  if (wf.id === 'free_question' && !question) return err('free_question needs a question');
  if (wf.id !== 'free_question' && !profile?.package_type && !question) return err('this workflow needs at least a package type (or a question)');
  const ip = req.headers.get('cf-connecting-ip') ?? 'local';
  if (!isAdmin(req, env)) {
    const limited = await rateLimit(env, ip);
    if (limited) return err(limited, 429);
  }
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO runs (id, created_at, workflow_id, profile, question, status, is_example, example_slug) VALUES (?,?,?,?,?, 'queued', ?, ?)`)
    .bind(id, nowIso(), wf.id, profile ? JSON.stringify(profile) : null, question, isAdmin(req, env) && body.example_slug ? 1 : 0,
      isAdmin(req, env) ? body.example_slug ?? null : null).run();
  await env.BRIEF.create({ id, params: { runId: id } });
  return json({ run_id: id }, 202);
}

async function getRun(env: Env, id: string): Promise<Response> {
  const run = await env.DB.prepare('SELECT id, created_at, workflow_id, profile, question, status, output, is_example, example_slug, model, error FROM runs WHERE id = ?').bind(id).first<any>();
  if (!run) return err('run not found', 404);
  const steps = await env.DB.prepare('SELECT step_id, status, started_at, ended_at, summary, detail FROM run_steps WHERE run_id = ?').bind(id).all<any>();
  return json({
    ...run, profile: run.profile ? JSON.parse(run.profile) : null, output: run.output ? JSON.parse(run.output) : null,
    steps: steps.results.map((s) => ({ ...s, summary: s.summary ? JSON.parse(s.summary) : null, detail: s.detail ? JSON.parse(s.detail) : null })),
  }, 200, run.status === 'done' ? { 'cache-control': 'public, max-age=3600' } : {});
}

async function meta(env: Env): Promise<Response> {
  const [docs, chunks, updated, layers] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN layer != 'news' THEN 1 ELSE 0 END) AS non_news FROM documents`).first<any>(),
    env.DB.prepare(`SELECT value AS n FROM meta WHERE key = 'chunk_count'`).first<any>(),
    env.DB.prepare(`SELECT value FROM meta WHERE key='corpus_updated'`).first<any>(),
    env.DB.prepare('SELECT layer, COUNT(*) AS n FROM documents GROUP BY layer').all<any>(),
  ]);
  return json({
    corpus_updated: updated?.value ?? null, documents: docs?.n ?? 0, documents_excluding_news: docs?.non_news ?? 0, chunks: chunks?.n ?? 0,
    layers: Object.fromEntries(layers.results.map((l) => [l.layer, l.n])),
    workflows: [...workflows().values()].map((w) => ({ id: w.id, name: w.name, description: w.description, needs: w.needs, sections: w.sections.map((s) => ({ id: s.id, title: s.title, kind: s.kind })) })),
    steps: STEPS, materials: MATERIALS, price_inputs_generated: CATALOG.generated,
    llm: env.GEMINI_API_KEY ? 'gemini' : 'workers-ai fallback',
  }, 200, CACHE);
}

async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  const p = url.pathname;
  if (p === '/api/health') return json({ ok: true, time: nowIso() });

  if (p.startsWith('/api/admin/')) {
    if (!isAdmin(req, env)) return err('unauthorized', 401);
    if (req.method !== 'POST') return err('POST only', 405);
    if (p === '/api/admin/ingest') return ingest(req, env);
    if (p === '/api/admin/load') return loadTable(req, env);
    if (p === '/api/admin/delete-doc') return deleteDoc(req, env);
    if (p === '/api/admin/hashes') return hashes(env);
    if (p === '/api/admin/recount') return recount(env);
    if (p === '/api/admin/models') return json({ models: await listGeminiModels(env) });
    if (p === '/api/admin/llm-test') {
      const r = await llmJson<any>(env, { system: 'Return JSON {"ok":true,"echo":<the word>}.', user: 'word: packaging', maxTokens: 64 });
      return json(r);
    }
    if (p === '/api/admin/gemini-probe') {
      const models = ((await req.json().catch(() => ({}))) as any).models ?? [env.GEMINI_MODEL];
      const out: Record<string, string> = {};
      for (const m of models) {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY ?? '' },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with the word ok.' }] }] }) });
        out[m] = `${r.status} ${(await r.text()).slice(0, 160).replace(/\s+/g, ' ')}`;
      }
      return json(out);
    }
    if (p === '/api/admin/refresh') return json(await refresh(env));
    if (p === '/api/admin/mark-example') {
      const b = (await req.json()) as { run_id: string; slug: string };
      await env.DB.prepare('UPDATE runs SET is_example = 1, example_slug = ? WHERE id = ?').bind(b.slug, b.run_id).run();
      return json({ ok: true });
    }
    return err('not found', 404);
  }

  if (p === '/api/run' && req.method === 'POST') return createRun(req, env);
  const m = p.match(/^\/api\/runs\/([0-9a-f-]{36})$/);
  if (m) return getRun(env, m[1]);
  if (p === '/api/examples') {
    const r = await env.DB.prepare(`SELECT id, created_at, workflow_id, example_slug, profile, question FROM runs WHERE is_example = 1 AND status = 'done' ORDER BY example_slug`).all<any>();
    return json(r.results.map((x) => ({ ...x, profile: x.profile ? JSON.parse(x.profile) : null })), 200, CACHE);
  }
  if (p === '/api/meta') return meta(env);
  if (p === '/api/sources') {
    const r = await env.DB.prepare(`SELECT id, title, publisher, source_url, layer, jurisdiction, doc_date, fetched_date, reg_status, reliability, license, chunk_count FROM documents ORDER BY layer, jurisdiction, title`).all();
    return json(r.results, 200, CACHE);
  }
  if (p === '/api/state-laws') return json(LAWS, 200, CACHE);
  if (p === '/api/ppi') {
    const s = url.searchParams.get('series')?.split(',').filter(Boolean).slice(0, 6) ?? [];
    const r = await env.DB.prepare(`SELECT series_id, period, value, label FROM ppi_series WHERE series_id IN (SELECT value FROM json_each(?)) ORDER BY period`).bind(JSON.stringify(s)).all();
    return json(r.results, 200, CACHE);
  }
  if (p === '/api/search') {
    const q = url.searchParams.get('q') ?? '';
    if (!q.trim()) return err('q required');
    const layers = url.searchParams.get('layers')?.split(',').filter(Boolean);
    const states = url.searchParams.get('states')?.split(',').filter(Boolean);
    const k = Math.min(parseInt(url.searchParams.get('k') ?? '8', 10) || 8, 20);
    return json(await hybridSearch(env, q, { layers, ...jurisdictionFilter(states, []) }, { k }));
  }
  return err('not found', 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(req, env, url);
      } catch (e) {
        console.error(e);
        return err(e instanceof Error ? e.message : 'internal error', 500);
      }
    }
    return env.ASSETS.fetch(req);
  },
  async scheduled(_c: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(refresh(env).then((r) => console.log('refresh', JSON.stringify(r))));
  },
} satisfies ExportedHandler<Env>;
