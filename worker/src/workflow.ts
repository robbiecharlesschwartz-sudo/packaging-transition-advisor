import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { MATERIAL_KEYS, currentMaterialKey, materialByKey } from './catalog';
import { CATALOG, costDigest, LAWS, runCost } from './cost/run';
import type { Env } from './env';
import { llmJson } from './llm';
import { plannerPrompt, profileText, summaryPrompt, writerPrompt } from './prompts';
import { embed, hybridSearch, jurisdictionFilter, OPTIONAL_MARKETS } from './retrieval';
import { runSourcing } from './sourcing';
import type { Alternative, NumberedPassage, PlanItem, Profile, SectionDef, SectionOut, WorkflowDef } from './types';
import { nowIso } from './util';
import { applyVerdicts, codeCheck, collectCheckables, llmVerify, numberAppears, significantNumbers, stripCiteMarkers, type Checkable } from './verify';
import { getWorkflow } from './workflows';

const STEP_CFG = { retries: { limit: 2, delay: '5 seconds' as const, backoff: 'exponential' as const }, timeout: '5 minutes' as const };
const MAX_PASSAGES = 64;
const ALL_LAYERS = ['regulation', 'claims_rules', 'infrastructure', 'materials', 'prices', 'demand', 'competitor', 'news', 'suppliers'];

interface RunCtx { runId: string; wf: WorkflowDef; profile: Profile | null; question: string | null }

async function logStep(env: Env, runId: string, stepId: string, status: string, summary: unknown, detail?: unknown) {
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO run_steps (run_id, step_id, status, started_at, ended_at, summary, detail) VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(run_id, step_id) DO UPDATE SET status=excluded.status, ended_at=excluded.ended_at,
       summary=excluded.summary, detail=COALESCE(excluded.detail, run_steps.detail)`,
  ).bind(runId, stepId, status, now, status === 'running' ? null : now, JSON.stringify(summary ?? {}),
    detail === undefined ? null : JSON.stringify(detail)).run();
}

function fillHint(hint: string | undefined, p: Profile | null, q: string | null, alts: Alternative[]): string {
  const states = (p?.sales_states ?? []).filter((s) => s !== 'nationwide');
  return (hint ?? '{question}')
    .replace('{question}', q ?? '')
    .replace('{current_material}', p?.current_material ?? '')
    .replace('{package_type}', p?.package_type ?? 'packaging')
    .replace('{product_category}', p?.product_category ?? '')
    .replace('{functional_needs}', (p?.functional_needs ?? []).join(', ') || 'barrier and shelf life')
    .replace('{states}', states.length ? states.join(', ') : 'US states')
    .replace('{alternatives}', alts.length ? alts.map((a) => a.name).join(', ') : 'recyclable, paper-based and compostable alternatives')
    .replace(/\s+/g, ' ')
    .trim();
}

function sectionLayers(s: SectionDef, wf: WorkflowDef): string[] | undefined {
  const l = s.layers ?? wf.filters.layers;
  return l === 'all' ? undefined : l;
}

async function fetchChunks(env: Env, ids: string[]): Promise<Omit<NumberedPassage, 'n'>[]> {
  if (!ids.length) return [];
  const r = await env.DB.prepare(
    `SELECT c.id AS chunk_id, c.document_id, c.content, c.section, c.page, c.layer, c.jurisdiction, c.doc_date, c.license,
            d.title, d.publisher, d.source_url, d.reliability
       FROM chunks c JOIN documents d ON d.id = c.document_id WHERE c.id IN (SELECT value FROM json_each(?))`,
  ).bind(JSON.stringify(ids)).all<any>();
  return r.results.map((x) => ({ ...x, score: 0, vector_rank: null, keyword_rank: null }));
}

function defaultAlternatives(p: Profile | null): Alternative[] {
  if (!p) return [];
  const cur = currentMaterialKey(p.current_material, p.package_type);
  const byType: Record<string, string[]> = {
    'flexible pouch/film': ['pe_film', 'paper_barrier', 'pla_film'],
    mailer: ['paper_kraft', 'pe_film', 'corrugated'],
    'rigid bottle': ['rpet', 'glass', 'aluminum', 'reuse_refill'],
    jar: ['rpet', 'glass', 'aluminum'],
    'tray/clamshell': ['molded_fiber', 'rpet', 'paperboard'],
    'cup/lid': ['paperboard', 'pla_rigid', 'rpet'],
    'folding carton': ['paperboard', 'molded_fiber'],
    'corrugated box': ['corrugated', 'molded_fiber'],
    can: ['aluminum', 'steel'],
  };
  const keys = (byType[p.package_type ?? ''] ?? ['paper_kraft', 'rpet', 'molded_fiber']).filter((k) => k !== cur || k === 'corrugated');
  return keys.slice(0, 3).map((k) => ({ name: materialByKey(k)!.label, material_key: k }));
}

export class BriefWorkflow extends WorkflowEntrypoint<Env, { runId: string }> {
  async run(event: WorkflowEvent<{ runId: string }>, step: WorkflowStep) {
    const env = this.env;
    const runId = event.payload.runId;
    let current = 'input';
    try {
      // ---------------------------------------------------------------- input
      const input = await step.do('input', async () => {
        const row = await env.DB.prepare('SELECT workflow_id, profile, question FROM runs WHERE id = ?').bind(runId).first<any>();
        if (!row) throw new Error('run not found');
        await env.DB.prepare(`UPDATE runs SET status='running' WHERE id=?`).bind(runId).run();
        const out = { workflow_id: row.workflow_id as string, profile: row.profile ? JSON.parse(row.profile) : null, question: row.question as string | null };
        await logStep(env, runId, 'input', 'done', { workflow: out.workflow_id, profile: !!out.profile, question: out.question },
          { profile: out.profile, question: out.question, profile_text: profileText(out.profile, out.question) });
        return out;
      });
      const wf = getWorkflow(input.workflow_id)!;
      const ctx: RunCtx = { runId, wf, profile: input.profile, question: input.question };
      const searchable = wf.sections.filter((s) => s.kind !== 'summary' && s.kind !== 'gaps');

      // ---------------------------------------------------------------- plan
      current = 'plan';
      const plan = await step.do('plan', STEP_CFG, async () => {
        await logStep(env, runId, 'plan', 'running', {});
        const forced: Alternative[] = (ctx.profile?.candidate_alternatives ?? [])
          .map((k) => (MATERIAL_KEYS.includes(k) ? { name: materialByKey(k)!.label, material_key: k } : null))
          .filter(Boolean) as Alternative[];
        const curKey = currentMaterialKey(ctx.profile?.current_material, ctx.profile?.package_type);
        const notCurrent = (a: Alternative) => a.material_key !== curKey;
        const baseAlts = (forced.filter(notCurrent).length ? forced.filter(notCurrent) : defaultAlternatives(ctx.profile));
        const hints = Object.fromEntries(searchable.map((s) => [s.id, fillHint(s.query_hint, ctx.profile, ctx.question, baseAlts)]));
        let queries: PlanItem[] = [];
        let alternatives = baseAlts;
        let provider = 'templates';
        try {
          const { data, model } = await llmJson<{ queries: { section: string; query: string }[]; alternatives: Alternative[] }>(
            env, { ...plannerPrompt(wf, ctx.profile, ctx.question, hints), maxTokens: 2048, tier: 'fast' });
          provider = model;
          queries = (data.queries ?? []).filter((q) => searchable.some((s) => s.id === q.section) && q.query?.trim())
            .slice(0, 16).map((q) => ({ section: q.section, query: q.query.slice(0, 300), layers: sectionLayers(searchable.find((s) => s.id === q.section)!, wf) ?? 'all' }));
          const llmAlts = (data.alternatives ?? []).filter((a) => MATERIAL_KEYS.includes(a.material_key) && notCurrent(a)).slice(0, 4)
            .map((a) => ({ ...a, name: !a.name || a.name === a.material_key || /_/.test(a.name) ? materialByKey(a.material_key)!.label : a.name }));
          if (!forced.length && llmAlts.length) alternatives = llmAlts;
        } catch (e) {
          provider = `templates (planner LLM failed: ${String(e).slice(0, 120)})`;
        }
        for (const s of searchable) // every section gets at least its template query
          if (!queries.some((q) => q.section === s.id)) queries.push({ section: s.id, query: hints[s.id], layers: sectionLayers(s, wf) ?? 'all' });
        const out = { queries, alternatives, provider };
        await logStep(env, runId, 'plan', 'done', { sub_queries: queries.length, alternatives: alternatives.map((a) => a.name), provider }, out);
        return out;
      });

      // ---------------------------------------------------------------- retrieve
      current = 'retrieve';
      const retrieved = await step.do('retrieve', STEP_CFG, async () => {
        await logStep(env, runId, 'retrieve', 'running', { sub_queries: plan.queries.length });
        const jf = jurisdictionFilter(ctx.profile?.sales_states, ctx.profile?.other_markets);
        const vectors = await embed(env, plan.queries.map((q) => q.query));
        const counts = await env.DB.prepare(`SELECT (SELECT value FROM meta WHERE key='chunk_count') AS chunks, (SELECT value FROM meta WHERE key='document_count') AS docs`).first<any>();
        const results = [];
        for (let i = 0; i < plan.queries.length; i++) {
          const q = plan.queries[i];
          const layers = q.layers === 'all' ? undefined : q.layers;
          const mats = ctx.profile ? [ctx.profile.current_material ?? '', ...plan.alternatives.flatMap((a) => materialByKey(a.material_key)?.tags ?? [])].filter(Boolean) : [];
          const res = await hybridSearch(env, q.query, { layers, ...jf, material_tags: mats, package_tags: ctx.profile?.package_type ? [ctx.profile.package_type] : [] },
            { k: wf.top_k + 2, queryVector: vectors[i] });
          results.push({ section: q.section, query: q.query, stats: res.stats,
            hits: res.passages.map((p) => ({ chunk_id: p.chunk_id, score: p.score, v: p.vector_rank, kw: p.keyword_rank, title: p.title, doc: p.document_id })) });
        }
        const out = { results, corpus: { chunks: Number(counts?.chunks ?? 0), documents: Number(counts?.docs ?? 0) } };
        const found = new Set(results.flatMap((r) => r.hits.map((h) => h.chunk_id))).size;
        await logStep(env, runId, 'retrieve', 'done', { searched_chunks: out.corpus.chunks, documents: out.corpus.documents, candidates: found, sub_queries: results.length }, results);
        return out;
      });

      // ---------------------------------------------------------------- passages
      current = 'passages';
      const numbered = await step.do('passages', STEP_CFG, async () => {
        const perSection: Record<string, string[]> = {};
        const order: string[] = [];
        for (const s of searchable) {
          const ids: string[] = [];
          for (const r of retrieved.results.filter((x) => x.section === s.id))
            for (const h of r.hits) if (!ids.includes(h.chunk_id)) ids.push(h.chunk_id);
          perSection[s.id] = ids.slice(0, wf.top_k);
        }
        // the current material's producer-fee rows are cited passages for the product section
        const cur = searchable.find((s) => s.kind === 'current');
        if (cur && ctx.profile) {
          const k = currentMaterialKey(ctx.profile.current_material, ctx.profile.package_type);
          const feeChunks = (CATALOG.epr_fees as any[]).filter((f) => k && f.material_keys.includes(k)).map((f) => f.chunk_id).filter(Boolean);
          perSection[cur.id] = [...new Set([...perSection[cur.id], ...feeChunks])];
        }
        // state-law rows behind the regulatory map are cited passages too
        const reg = searchable.find((s) => s.kind === 'regulatory');
        if (reg) {
          const st = (ctx.profile?.sales_states ?? []).filter((x) => x !== 'nationwide');
          const lawChunks = LAWS.filter((l) => !st.length || st.includes(l.state)).map((l) => l.source_chunk_id).filter(Boolean);
          perSection[reg.id] = [...new Set([...perSection[reg.id], ...lawChunks])];
        }
        for (const s of searchable) for (const id of perSection[s.id]) if (!order.includes(id)) order.push(id);
        const keep = order.slice(0, MAX_PASSAGES);
        const rows = await fetchChunks(env, keep);
        const byId = new Map(rows.map((r) => [r.chunk_id, r]));
        const scoreOf = new Map(retrieved.results.flatMap((r) => r.hits.map((h) => [h.chunk_id, h] as const)));
        const passages: NumberedPassage[] = keep.filter((id) => byId.has(id)).map((id, i) => {
          const h = scoreOf.get(id);
          return { ...byId.get(id)!, n: i + 1, score: h?.score ?? 0, vector_rank: h?.v ?? null, keyword_rank: h?.kw ?? null };
        });
        const nOf = new Map(passages.map((p) => [p.chunk_id, p.n]));
        const sectionN = Object.fromEntries(searchable.map((s) => [s.id, perSection[s.id].map((id) => nOf.get(id)).filter(Boolean) as number[]]));
        const docs = new Set(passages.map((p) => p.document_id)).size;
        await logStep(env, runId, 'passages', 'done', { kept: passages.length, documents: docs },
          passages.map((p) => ({ n: p.n, title: p.title, doc: p.document_id, chunk: p.chunk_id, score: p.score, layer: p.layer })));
        return { passages, sectionN };
      });
      let passages = numbered.passages;
      const sectionN = numbered.sectionN;

      const appendPassages = async (ids: string[], sectionId: string) => {
        const have = new Map(passages.map((p) => [p.chunk_id, p.n]));
        const missing = ids.filter((id) => !have.has(id));
        const rows = await fetchChunks(env, missing);
        let n = passages.length;
        const added = rows.map((r) => ({ ...r, n: ++n }));
        passages = [...passages, ...added];
        const nums = ids.map((id) => have.get(id) ?? added.find((a) => a.chunk_id === id)?.n).filter(Boolean) as number[];
        sectionN[sectionId] = [...new Set([...(sectionN[sectionId] ?? []), ...nums])];
        return added;
      };

      // ---------------------------------------------------------------- cost
      let cost: any = null;
      const costSection = searchable.find((s) => s.kind === 'cost');
      if (wf.needs.cost && costSection && ctx.profile) {
        current = 'cost';
        const res: any = await step.do('cost', STEP_CFG, async (): Promise<any> => {
          const c = await runCost(env, ctx.profile!, plan.alternatives);
          const ids = [...new Set((c.inputs ?? []).map((i: any) => i.chunk_id).filter(Boolean))] as string[];
          await logStep(env, runId, 'cost', 'done', { options: c.options?.length ?? 0, confidence: (c as any).confidence ?? 'n/a', cited_inputs: ids.length },
            { inputs: c.inputs, gaps: c.gaps, ppi: (c as any).ppi });
          return JSON.parse(JSON.stringify({ c, ids }));
        });
        cost = res.c;
        const added = await appendPassages(res.ids, costSection.id);
        const nOf = new Map(passages.map((p) => [p.chunk_id, p.n]));
        for (const i of cost.inputs ?? []) i.n = nOf.get(i.chunk_id) ?? null;
        void added;
      }

      // ---------------------------------------------------------------- sourcing
      let sourcing: any = null;
      const srcSection = searchable.find((s) => s.kind === 'sourcing');
      if (wf.needs.sourcing && srcSection && ctx.profile) {
        current = 'sourcing';
        sourcing = await step.do('sourcing', STEP_CFG, async () => {
          const s = runSourcing(ctx.profile!, plan.alternatives);
          const n = Object.values(s.by_alternative).flat().length;
          await logStep(env, runId, 'sourcing', 'done', { suppliers_matched: n, plants: s.plants.length }, s.by_alternative);
          return s;
        });
        await appendPassages(sourcing.evidence_chunk_ids, srcSection.id);
        const nOf = new Map(passages.map((p) => [p.chunk_id, p.n]));
        for (const rows of Object.values<any[]>(sourcing.by_alternative))
          for (const r of rows) r.cites = r.evidence_chunk_ids.map((id: string) => nOf.get(id)).filter(Boolean);
      }

      // ---------------------------------------------------------------- write
      current = 'write';
      const byN = new Map(passages.map((p) => [p.n, p]));
      const toWrite = searchable;
      const groups: SectionDef[][] = [];
      for (let i = 0; i < toWrite.length; i += 3) groups.push(toWrite.slice(i, i + 3));
      const altText = plan.alternatives.map((a) => `${a.name} (${a.material_key})`).join('; ');
      const supplierText = sourcing ? Object.entries<any[]>(sourcing.by_alternative).map(([alt, rows]) =>
        `${alt}: ${rows.length ? rows.map((r) => `${r.company_name} - ${r.match}${r.nearest ? `, nearest listed plant ${r.nearest.city}, ${r.nearest.state} (${r.nearest.km} km from ${r.nearest.to_state})` : ''} [${r.cites.join(', ')}]`).join('; ') : 'no supplier in table'}`).join('\n') + `\n${sourcing.note}` : undefined;
      const calcText = cost ? costDigest(cost) : undefined;
      await logStep(env, runId, 'write', 'running', { sections: toWrite.length, calls: groups.length });
      const drafts: SectionOut[] = [];
      let model = '';
      for (let g = 0; g < groups.length; g++) {
        const group = groups[g];
        const out = await step.do(`write-${g + 1}`, STEP_CFG, async () => {
          const ps = Object.fromEntries(group.map((s) => [s.id, (sectionN[s.id] ?? []).map((n) => byN.get(n)!).filter(Boolean)]));
          const call = (tier: 'quality' | 'fast') => llmJson<{ sections: any[] }>(env, {
            ...writerPrompt(wf, group, ps, ctx.profile, ctx.question, {
              alternatives: altText,
              calculator: group.some((s) => s.kind === 'cost') ? calcText : undefined,
              suppliers: group.some((s) => s.kind === 'sourcing') ? supplierText : undefined,
            }),
            maxTokens: 8192,
            tier,
          });
          // An empty writer output for a section that has passages is a model failure, not an evidence gap:
          // retry once on the other routing tier before letting the report mark it as a gap (eval R10).
          const empty = (secs: any[]) => group.some((s) => (ps[s.id] ?? []).length > 0 && (() => {
            const d = secs.find((x: any) => x?.id === s.id);
            return !d || (!(d.claims ?? []).length && !Object.values(d.data ?? {}).some((v: any) => Array.isArray(v) && v.length));
          })());
          let { data, model } = await call('quality');
          let retried = false;
          if (empty(data.sections ?? [])) {
            retried = true;
            try {
              const r = await call('fast');
              if (!empty(r.data.sections ?? []) || (r.data.sections ?? []).length > (data.sections ?? []).length) ({ data, model } = r);
            } catch { /* keep first result */ }
          }
          return { sections: data.sections ?? [], model, retried };
        });
        model = out.model;
        for (const s of group) {
          const d = out.sections.find((x: any) => x?.id === s.id) ?? {};
          drafts.push({ id: s.id, kind: s.kind, title: s.title, takeaway: stripCiteMarkers(String(d.takeaway ?? '')),
            claims: Array.isArray(d.claims) ? d.claims.filter((c: any) => c?.text).map((c: any) => ({ text: stripCiteMarkers(String(c.text)), cites: (c.cites ?? []).map(Number) })) : [],
            data: d.data ?? {}, gaps: Array.isArray(d.gaps) ? d.gaps.map(String) : [], passages: sectionN[s.id] ?? [] });
          for (const o of drafts[drafts.length - 1].data?.options ?? []) if (!o.name || o.name === o.material_key || /_/.test(o.name)) o.name = materialByKey(o.material_key)?.label ?? o.name;
        }
      }
      const claimCount = drafts.reduce((a, s) => a + s.claims.length, 0);
      await logStep(env, runId, 'write', 'done', { sections: drafts.length, claims: claimCount, calls: groups.length, model });

      // ---------------------------------------------------------------- verify
      current = 'verify';
      const profileNums = JSON.stringify(ctx.profile ?? {}) + ' ' + (ctx.question ?? '');
      const verified = await step.do('verify', STEP_CFG, async () => {
        await logStep(env, runId, 'verify', 'running', { claims: claimCount });
        const all: { s: SectionOut; items: Checkable[] }[] = [];
        for (const s of drafts) {
          const items = collectCheckables(s);
          const tool = s.kind === 'cost' ? calcText : s.kind === 'sourcing' ? supplierText : s.kind === 'current' ? `USER PROFILE (facts the user stated about their own product):\n${profileText(ctx.profile, ctx.question)}` : undefined;
          if (tool) items.forEach((i) => (i.extra = tool));
          if (tool) items.forEach((i) => { if (!i.cites.length && s.passages.length) i.cites = [s.passages[0]]; });
          codeCheck(items, new Set(passages.map((p) => p.n)), byN, profileNums);
          all.push({ s, items });
        }
        const flat = all.flatMap((x) => x.items);
        const calls = await llmVerify(env, flat, byN);
        const stats = { checked: flat.length, supported: 0, partial: 0, removed: 0, by_code: flat.filter((i) => i.note?.startsWith('number') || i.note?.includes('citation') || i.note?.includes('not in this section')).length, calls };
        const verdicts: any[] = [];
        for (const { s, items } of all) {
          const r = applyVerdicts(s, items);
          stats.supported += r.supported; stats.partial += r.partial; stats.removed += r.removed;
          if (s.kind === 'cost') {
            s.data = cost;
            if (cost?.available && cost.options?.some((o: any) => o.total_per_unit)) s.status = s.status === 'Grounded' && !cost.gaps.length ? 'Grounded' : 'Partial';
            else s.status = 'Evidence Gap';
          }
          if (s.kind === 'sourcing') {
            s.data = sourcing;
            const n = sourcing ? Object.values<any[]>(sourcing.by_alternative).flat().length : 0;
            s.status = n ? (s.status === 'Evidence Gap' ? 'Partial' : s.status) : 'Evidence Gap';
          }
          if (s.kind === 'current' && ctx.profile) {
            const p = ctx.profile;
            const key = currentMaterialKey(p.current_material, p.package_type);
            const cur = cost?.options?.find((o: any) => o.is_current);
            const st = (p.sales_states ?? []).filter((x) => x !== 'nationwide');
            const fees = (CATALOG.epr_fees as any[]).filter((f) => key && f.material_keys.includes(key));
            s.data = {
              facts: {
                company: p.company_description ?? null, product_category: p.product_category ?? null, package_type: p.package_type ?? null,
                current_material: p.current_material ?? null, material_key: key, material_label: key ? materialByKey(key)?.label : null,
                dimensions: p.dimensions ?? null, thickness: p.thickness ?? null, unit_weight_g: p.unit_weight_g ?? null,
                weight_estimate: cur ? { low: cur.weight_g.low, high: cur.weight_g.high, method: cur.weight_g.method } : null,
                annual_units: p.annual_units ?? null, components: p.components ?? [], sales_states: st.length ? st : ['nationwide'],
                other_markets: p.other_markets ?? [], functional_needs: p.functional_needs ?? [],
              },
              fee_categories: fees.map((f) => ({ state: f.state, category: f.material_category, cents_per_lb: [f.cents_per_lb_low, f.cents_per_lb_high], n: passages.find((x) => x.chunk_id === f.chunk_id)?.n ?? null })),
              current_cost: cur ? { material: cur.material_cost, total: cur.total_per_unit, annual: cur.annual } : null,
              keyed_on: {
                functional_needs: p.functional_needs ?? [],
                material_tags: key ? materialByKey(key)?.tags ?? [] : [],
                alternatives: plan.alternatives,
                queries: plan.queries.filter((q) => q.section !== 'current').slice(0, 8).map((q) => q.query),
                forced: (p.candidate_alternatives ?? []).length > 0,
              },
              missing: [!p.unit_weight_g && 'unit weight', !p.dimensions?.l_cm && !p.dimensions?.volume_ml && 'dimensions', !p.annual_units && 'annual units',
                !(p.sales_states ?? []).length && 'sales states', !(p.functional_needs ?? []).length && 'functional needs'].filter(Boolean),
            };
          }
          if (s.kind === 'regulatory') {
            const st = (ctx.profile?.sales_states ?? []).filter((x) => x !== 'nationwide');
            const nOf = new Map(passages.map((p) => [p.chunk_id, p.n]));
            s.data = { ...(s.data ?? {}), state_laws: LAWS.filter((l) => !st.length || st.includes(l.state)).map((l) => ({ ...l, cite: nOf.get(l.source_chunk_id) ?? null })), selected_states: st };
          }
          verdicts.push(...items.map((i) => ({ section: s.id, text: i.text, cites: i.cites, verdict: i.verdict, note: i.note })));
        }
        await logStep(env, runId, 'verify', 'done', stats, verdicts);
        return { sections: all.map((x) => x.s), stats };
      });

      // ---------------------------------------------------------------- report
      current = 'report';
      await step.do('report', STEP_CFG, async () => {
        const sections = verified.sections;
        const final: SectionOut[] = [];
        let summary: SectionOut | null = null;
        let nextQuestions: string[] = [];
        let docsNeeded: string[] = [];
        const hasSummary = wf.sections.some((s) => s.kind === 'summary');
        const usableClaims = sections.flatMap((s) => s.claims.map((c) => ({ ...c, section: s.title })));
        try {
          const digest = sections.map((s) => `## ${s.title} [${s.status}]\n` + (s.claims.map((c) => `- ${c.text} [${c.cites.join(', ')}]`).join('\n') || '- (no supported claims)')
            + (s.kind === 'cost' && calcText ? `\nCALCULATOR OUTPUT:\n${calcText}` : '')).join('\n\n');
          const { data } = await llmJson<any>(env, { ...summaryPrompt(wf, ctx.profile, ctx.question, digest), maxTokens: 3072, tier: 'quality' });
          nextQuestions = (data.next_questions ?? []).map(String).slice(0, 8);
          docsNeeded = (data.documents_needed ?? []).map(String).slice(0, 8);
          if (hasSummary) {
            const allowed = new Set(usableClaims.flatMap((c) => c.cites));
            summary = { id: 'summary', kind: 'summary', title: 'Summary', takeaway: stripCiteMarkers(String(data.takeaway ?? '')),
              claims: (data.claims ?? []).filter((c: any) => c?.text).map((c: any) => ({ text: stripCiteMarkers(String(c.text)), cites: (c.cites ?? []).map(Number) })),
              gaps: [], passages: [...allowed] };
            const items = collectCheckables(summary);
            if (calcText) items.forEach((i) => (i.extra = calcText));
            codeCheck(items, allowed, byN, profileNums);
            await llmVerify(env, items, byN);
            applyVerdicts(summary, items);
          }
        } catch (e) {
          if (hasSummary) summary = { id: 'summary', kind: 'summary', title: 'Summary', takeaway: 'Summary could not be generated; see the sections below.', claims: [], gaps: [String(e).slice(0, 200)], status: 'Evidence Gap', passages: [] };
        }
        // takeaways must also obey the number rule; drop numbers that are not in cited passages
        // A section can be fully supported by verified structured content (table rows, ratings, examples)
        // even when the writer returned no narrative bullets; only call it a gap when it has neither.
        const hasData = (s: SectionOut) => {
          const d = s.data ?? {};
          return !!((d.rows ?? []).length || (d.options ?? []).length || (d.safe ?? []).length || (d.risky ?? []).length || (d.examples ?? []).length);
        };
        for (const s of [...sections, ...(summary ? [summary] : [])]) {
          const hay = [...new Set([...s.claims.flatMap((c) => c.cites), ...(s.passages ?? [])])].map((n) => byN.get(n)?.content ?? '').join(' ') + ' ' + (calcText ?? '') + ' ' + profileNums;
          const bad = significantNumbers(s.takeaway).filter((n) => !numberAppears(n, hay));
          const content = s.claims.length > 0 || hasData(s) || s.kind === 'cost' || s.kind === 'sourcing';
          if (!content) {
            s.takeaway = s.id === 'answer' ? 'The documents in the corpus do not support an answer to this question.' : `The corpus does not support an answer for ${s.title.toLowerCase()}.`;
            s.status = 'Evidence Gap';
          } else if (bad.length || !s.takeaway.trim()) {
            s.takeaway = s.claims[0]?.text ?? s.takeaway.replace(/\s*\$?\d[\d,.]*%?/g, '').trim();
          }
        }
        if (summary) final.push(summary);
        final.push(...sections);
        const gapsSection = wf.sections.find((s) => s.kind === 'gaps');
        if (gapsSection) {
          const gaps = [...new Set(sections.flatMap((s) => [...s.gaps, ...(s.status === 'Evidence Gap' ? [`${s.title}: no supporting passages in the corpus`] : [])])
            .concat(cost?.gaps ?? [], sourcing?.gaps ?? []))];
          final.push({ id: gapsSection.id, kind: 'gaps', title: gapsSection.title,
            takeaway: gaps.length ? `${gaps.length} open question${gaps.length > 1 ? 's' : ''} the corpus could not answer.` : 'No major gaps were flagged.',
            claims: [], gaps, data: { next_questions: nextQuestions, documents_needed: docsNeeded }, status: gaps.length ? 'Partial' : 'Grounded', passages: [] });
        }

        // KPIs
        const alt = final.find((s) => s.kind === 'alternatives');
        const opts: any[] = alt?.data?.options ?? [];
        const curKeyK = currentMaterialKey(ctx.profile?.current_material, ctx.profile?.package_type);
        const altOpts = opts.filter((o) => o.material_key !== curKeyK);
        const rec = altOpts.find((o) => o.fit === 'Strong') ?? altOpts.find((o) => o.fit === 'Possible') ?? null;
        let costChange: any = null;
        if (cost?.available) {
          const cur = cost.options.find((o: any) => o.is_current);
          const target = cost.options.find((o: any) => rec && o.key === rec.material_key && o.total_per_unit) ?? cost.options.find((o: any) => !o.is_current && o.total_per_unit);
          if (cur?.total_per_unit && target?.total_per_unit)
            costChange = { alternative: target.label, low: target.total_per_unit.low - cur.total_per_unit.high, high: target.total_per_unit.high - cur.total_per_unit.low, confidence: cost.confidence };
        }
        const selected = (ctx.profile?.sales_states ?? []).filter((x) => x !== 'nationwide');
        const feeStates = LAWS.filter((l) => l.law_type === 'epr' && l.status === 'fees_in_effect' && (!selected.length || selected.includes(l.state))).map((l) => l.state);
        const allClaims = final.flatMap((s) => s.claims);
        const supported = allClaims.filter((c) => c.verdict === 'supported').length;
        const cited = new Set(allClaims.flatMap((c) => c.cites));
        for (const s of final) for (const o of s.data?.options ?? []) for (const r of o.reasons ?? []) (r.cites ?? []).forEach((n: number) => cited.add(n));
        for (const s of final) for (const r of s.data?.rows ?? []) (r.cites ?? []).forEach((n: number) => cited.add(n));
        for (const i of cost?.inputs ?? []) if (i.n) cited.add(i.n);
        for (const s of final) for (const l of s.data?.state_laws ?? []) if (l.cite) cited.add(l.cite);
        const citedPassages = passages.filter((p) => cited.has(p.n));
        const primaryShare = citedPassages.length ? citedPassages.filter((p) => p.reliability === 'primary').length / citedPassages.length : 0;
        const supportShare = allClaims.length ? supported / allClaims.length : 0;
        const strength = allClaims.length === 0 ? 'Weak' : supportShare >= 0.75 && primaryShare >= 0.6 ? 'Strong' : supportShare >= 0.5 ? 'Moderate' : 'Weak';
        const kpis = {
          recommended_alternative: rec ? { name: rec.name, fit: rec.fit } : null,
          cost_change_per_unit: costChange,
          states_with_fees: feeStates,
          evidence_strength: { label: strength, supported_share: Math.round(supportShare * 100), primary_share: Math.round(primaryShare * 100) },
        };
        const corpus = await env.DB.prepare(`SELECT value FROM meta WHERE key='corpus_updated'`).first<{ value: string }>();
        const output = {
          workflow: { id: wf.id, name: wf.name }, profile: ctx.profile, question: ctx.question, generated_at: nowIso(), model,
          alternatives: plan.alternatives, sections: final, kpis,
          passages: passages.map((p) => ({ ...p, content: p.license === 'link_only' ? '' : p.content, content_visible: p.license !== 'link_only', cited: cited.has(p.n) })),
          stats: { ...verified.stats, passages: passages.length, cited: cited.size, sub_queries: plan.queries.length, searched_chunks: retrieved.corpus.chunks, documents: retrieved.corpus.documents },
          corpus_updated: corpus?.value ?? null,
        };
        const counts = final.reduce((a: Record<string, number>, s) => ((a[s.status ?? 'n/a'] = (a[s.status ?? 'n/a'] ?? 0) + 1), a), {});
        await env.DB.prepare(`UPDATE runs SET status='done', output=?, retrieved_chunk_ids=?, model=? WHERE id=?`)
          .bind(JSON.stringify(output), JSON.stringify(passages.map((p) => p.chunk_id)), model, runId).run();
        await logStep(env, runId, 'report', 'done', { sections: final.length, ...counts, cited: cited.size });
        return { ok: true };
      });
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await env.DB.prepare(`UPDATE runs SET status='error', error=? WHERE id=?`).bind(msg.slice(0, 1000), runId).run();
      await logStep(env, runId, current, 'error', { error: msg.slice(0, 300) });
      throw e;
    }
  }
}

export { ALL_LAYERS, OPTIONAL_MARKETS };
