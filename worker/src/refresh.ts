import { ingestCore } from './admin';
import type { Env } from './env';
import { nowIso } from './util';

// Weekly Cron Trigger. Stays under the free plan's 50 external subrequests per invocation:
// 4 RSS feeds + 1 BLS call + up to 30 regulation-page hash checks.
const FEEDS = [
  ['packagingdive', 'Packaging Dive', 'https://www.packagingdive.com/feeds/news/'],
  ['wastedive', 'Waste Dive', 'https://www.wastedive.com/feeds/news/'],
  ['resource-recycling', 'Resource Recycling', 'https://resource-recycling.com/feed/'],
  ['plasticsnews', 'Plastics News', 'https://www.plasticsnews.com/rss/news'],
] as const;
const KEEP = /packag|EPR|extended producer|recycl|compost|plastic|paper|fiber|aluminum|glass|bottle|pouch|mailer|foam|polystyrene|PFAS|green claims|greenwash/i;
const UA = 'packaging-transition-advisor/1.0 (weekly corpus refresh; https://github.com/robbiecharlesschwartz-sudo/packaging-transition-advisor)';
const PPI_SERIES = ['PCU325211325211', 'PCU326111326111', 'PCU326112326112', 'PCU326160326160', 'PCU322211322211', 'PCU322212322212',
  'PCU322220322220', 'PCU322130322130', 'PCU327213327213', 'PCU331315331315', 'PCU332431332431', 'PCU484121484121'];

const strip = (s: string) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#\d+;|&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (xml: string, t: string) => strip(xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i'))?.[1] ?? '');

async function sha(text: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function log(env: Env, doc: string | null, change: string) {
  await env.DB.prepare('INSERT INTO corpus_changelog (at, document_id, change) VALUES (?,?,?)').bind(nowIso(), doc, change).run();
}

async function news(env: Env) {
  let added = 0;
  for (const [slug, pub, url] of FEEDS) {
    try {
      const xml = await (await fetch(url, { headers: { 'user-agent': UA } })).text();
      const items = xml.split(/<item[\s>]/i).slice(1, 31);
      for (const it of items) {
        const title = tag(it, 'title');
        const link = tag(it, 'link');
        const summary = tag(it, 'description').slice(0, 600);
        if (!title || !link || !KEEP.test(`${title} ${summary}`)) continue;
        const pd = new Date(tag(it, 'pubDate') || Date.now());
        const date = Number.isNaN(pd.getTime()) ? nowIso().slice(0, 10) : pd.toISOString().slice(0, 10);
        const id = `news-${slug}-${(await sha(link)).slice(0, 10)}`;
        const exists = await env.DB.prepare('SELECT 1 FROM documents WHERE id = ?').bind(id).first();
        if (exists) continue;
        const content = `${title} (${pub}, ${date}).\n\nRSS summary: ${summary || '(none)'}\n\nLink: ${link}`;
        await ingestCore(env, {
          document: { id, title: title.slice(0, 200), publisher: pub, source_url: link, layer: 'news', jurisdiction: 'US', doc_date: date,
            fetched_date: nowIso().slice(0, 10), reliability: 'press', license: 'link_only', chunk_count: 1, content_hash: await sha(content) },
          chunks: [{ id: `${id}::0000`, document_id: id, chunk_index: 0, content, section: 'Headline', layer: 'news', jurisdiction: 'US',
            doc_date: date, year: parseInt(date.slice(0, 4), 10), license: 'link_only', reliability: 'press', title, material_tags: [], package_tags: [] }],
          replace: true,
        });
        added++;
      }
    } catch (e) {
      await log(env, null, `rss ${slug} failed: ${String(e).slice(0, 120)}`);
    }
  }
  return added;
}

async function ppi(env: Env) {
  const y = new Date().getUTCFullYear();
  const body: Record<string, unknown> = { seriesid: PPI_SERIES, startyear: String(y - 1), endyear: String(y) };
  if (env.BLS_API_KEY) body.registrationkey = env.BLS_API_KEY;
  const api = env.BLS_API_KEY ? 'https://api.bls.gov/publicAPI/v2/timeseries/data/' : 'https://api.bls.gov/publicAPI/v1/timeseries/data/';
  const r = (await (await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA }, body: JSON.stringify(body) })).json()) as any;
  if (r.status !== 'REQUEST_SUCCEEDED') throw new Error(`BLS: ${JSON.stringify(r.message ?? r.status)}`);
  const stmts: D1PreparedStatement[] = [];
  for (const s of r.Results.series)
    for (const d of s.data)
      if (String(d.period).startsWith('M') && d.period !== 'M13' && d.value !== '-')
        stmts.push(env.DB.prepare(`INSERT INTO ppi_series (series_id, period, value) VALUES (?,?,?) ON CONFLICT(series_id, period) DO UPDATE SET value=excluded.value`)
          .bind(s.seriesID, `${d.year}-${String(d.period).slice(1)}`, parseFloat(d.value)));
  for (let i = 0; i < stmts.length; i += 80) await env.DB.batch(stmts.slice(i, i + 80));
  return stmts.length;
}

/** Re-checks regulation pages; a changed hash is logged so scripts/refresh.py re-ingests it. */
async function regChecks(env: Env) {
  const docs = await env.DB.prepare(`SELECT id, source_url FROM documents WHERE layer IN ('regulation','claims_rules') AND license != 'link_only' AND source_url NOT LIKE '%.pdf' ORDER BY fetched_date LIMIT 30`).all<{ id: string; source_url: string }>();
  let changed = 0;
  for (const d of docs.results) {
    try {
      const r = await fetch(d.source_url, { headers: { 'user-agent': UA } });
      if (!r.ok) { await log(env, d.id, `HTTP ${r.status} on re-check`); continue; }
      const text = strip(await r.text()).slice(0, 200000);
      const h = await sha(text);
      const key = `pagehash:${d.id}`;
      const prev = await env.DB.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first<{ value: string }>();
      if (prev && prev.value !== h) { changed++; await log(env, d.id, 'source page changed; queued for re-ingest by scripts/refresh.py'); }
      await env.DB.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').bind(key, h).run();
    } catch (e) {
      await log(env, d.id, `re-check failed: ${String(e).slice(0, 100)}`);
    }
  }
  return { checked: docs.results.length, changed };
}

export async function refresh(env: Env) {
  const out: Record<string, unknown> = { at: nowIso() };
  try { out.news_added = await news(env); } catch (e) { out.news_error = String(e); }
  try { out.ppi_points = await ppi(env); } catch (e) { out.ppi_error = String(e); }
  try { out.regulation = await regChecks(env); } catch (e) { out.reg_error = String(e); }
  await env.DB.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('last_refresh', ?)`).bind(JSON.stringify(out)).run();
  return out;
}
