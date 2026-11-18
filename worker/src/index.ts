import { deleteDoc, hashes, ingest, isAdmin, loadTable } from './admin';
import type { Env } from './env';
import { hybridSearch, jurisdictionFilter } from './retrieval';
import { err, json } from './util';

export { BriefWorkflow } from './workflow';

async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  const p = url.pathname;

  if (p === '/api/health') return json({ ok: true });

  if (p.startsWith('/api/admin/')) {
    if (!isAdmin(req, env)) return err('unauthorized', 401);
    if (req.method !== 'POST') return err('POST only', 405);
    if (p === '/api/admin/ingest') return ingest(req, env);
    if (p === '/api/admin/load') return loadTable(req, env);
    if (p === '/api/admin/delete-doc') return deleteDoc(req, env);
    if (p === '/api/admin/hashes') return hashes(env);
    return err('not found', 404);
  }

  if (p === '/api/search') {
    const q = url.searchParams.get('q') ?? '';
    if (!q.trim()) return err('q required');
    const layers = url.searchParams.get('layers')?.split(',').filter(Boolean);
    const states = url.searchParams.get('states')?.split(',').filter(Boolean);
    const k = Math.min(parseInt(url.searchParams.get('k') ?? '8', 10) || 8, 20);
    const res = await hybridSearch(env, q, { layers, ...jurisdictionFilter(states, []) }, { k });
    return json(res);
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
} satisfies ExportedHandler<Env>;
