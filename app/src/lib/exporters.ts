import { range } from './format';
import type { Output, Run } from './types';

function cites(c: number[]) {
  return c.length ? ` [${c.join(', ')}]` : '';
}

export function toMarkdown(o: Output): string {
  const L: string[] = [];
  const title = o.profile?.company_description ? `Transition brief: ${o.profile.package_type ?? 'packaging'}` : o.workflow.name;
  L.push(`# ${title}`, '', `_${o.workflow.name} · generated ${o.generated_at.slice(0, 10)} · corpus updated ${o.corpus_updated?.slice(0, 10) ?? 'n/a'}_`, '');
  if (o.question) L.push(`**Question:** ${o.question}`, '');
  L.push('> Research aid, not legal or financial advice. Estimates are order-of-magnitude.', '');
  for (const s of o.sections) {
    L.push(`## ${s.title} — ${s.status ?? ''}`, '', `**${s.takeaway}**`, '');
    for (const c of s.claims) L.push(`- ${c.text}${cites(c.cites)}${c.verdict === 'partial' ? ' _(partially supported)_' : ''}`);
    const d = s.data ?? {};
    if (s.kind === 'alternatives')
      for (const opt of d.options ?? []) {
        L.push('', `### ${opt.name} — fit: ${opt.fit}`);
        for (const r of opt.reasons ?? []) L.push(`- ${r.text}${cites(r.cites ?? [])}`);
        for (const n of opt.needs ?? []) L.push(`- ${n.need}: **${n.rating}** ${n.note ?? ''}${cites(n.cites ?? [])}`);
      }
    if (s.kind === 'regulatory') {
      L.push('', '| State | Law | Status | Key date |', '|---|---|---|---|');
      for (const l of d.state_laws ?? []) L.push(`| ${l.state} | ${l.title} | ${l.status.replace(/_/g, ' ')} | ${l.key_date ?? ''} ${l.key_date_event ?? ''}${l.cite ? ` [${l.cite}]` : ''} |`);
    }
    if (s.kind === 'eol') {
      L.push('', '| Alternative | Location | Pathway | Status | Note |', '|---|---|---|---|---|');
      for (const r of d.rows ?? []) L.push(`| ${r.alternative} | ${r.location} | ${r.pathway ?? ''} | ${r.status} | ${r.note ?? ''}${cites(r.cites ?? [])} |`);
    }
    if (s.kind === 'claims') {
      if (d.safe?.length) { L.push('', '**Supportable claims**'); for (const c of d.safe) L.push(`- "${c.claim}" — ${c.why}${cites(c.cites ?? [])}`); }
      if (d.risky?.length) { L.push('', '**Risky claims**'); for (const c of d.risky) L.push(`- "${c.claim}" — ${c.why}${cites(c.cites ?? [])}`); }
    }
    if (s.kind === 'cost' && d.available) {
      L.push('', `| Line item | ${d.options.map((x: any) => x.label).join(' | ')} |`, `|---|${d.options.map(() => '---').join('|')}|`);
      L.push(`| Unit weight | ${d.options.map((x: any) => (x.weight_g.low === null ? 'gap' : `${x.weight_g.low.toFixed(1)}–${x.weight_g.high.toFixed(1)} g`)).join(' | ')} |`);
      L.push(`| Material / unit | ${d.options.map((x: any) => range(x.material_cost)).join(' | ')} |`);
      for (const st of d.states) L.push(`| EPR fee / unit (${st}) | ${d.options.map((x: any) => ('low' in x.epr[st] ? range(x.epr[st]) : x.epr[st].status)).join(' | ')} |`);
      L.push(`| **Total / unit** | ${d.options.map((x: any) => range(x.total_per_unit)).join(' | ')} |`);
      if (d.annual_units) L.push(`| **Annual (${d.annual_units.toLocaleString('en-US')} units)** | ${d.options.map((x: any) => range(x.annual, 0)).join(' | ')} |`);
      L.push('', `Confidence: **${d.confidence}**. ${d.note}`);
    }
    if (s.kind === 'sourcing' && d.by_alternative) {
      for (const [alt, rows] of Object.entries<any[]>(d.by_alternative)) {
        L.push('', `### ${alt}`);
        for (const r of rows) L.push(`- ${r.company_name}: ${r.match}${r.nearest ? `; nearest listed plant ${r.nearest.city}, ${r.nearest.state}` : ''}; ${r.cost_evidence}${cites(r.cites ?? [])}`);
      }
      L.push('', `_${d.note}_`, '', '**Request-for-quote checklist**', ...(d.rfq_checklist ?? []).map((x: string) => `- ${x}`));
    }
    if (s.kind === 'competitor') for (const e of d.examples ?? []) L.push(`- **${e.company}** (${e.year ?? 'n.d.'}): ${e.action}${cites(e.cites ?? [])}`);
    if (s.kind === 'gaps') {
      for (const g of s.gaps) L.push(`- ${g}`);
      if (d.next_questions?.length) { L.push('', '**Next questions**'); d.next_questions.forEach((q: string) => L.push(`- ${q}`)); }
      if (d.documents_needed?.length) { L.push('', '**Documents that would answer them**'); d.documents_needed.forEach((q: string) => L.push(`- ${q}`)); }
    } else if (s.gaps.length) {
      L.push('', '_Not covered by the evidence:_', ...s.gaps.map((g) => `- ${g}`));
    }
    L.push('');
  }
  L.push('## Sources', '');
  for (const p of o.passages.filter((x) => x.cited)) L.push(`${p.n}. ${p.title}. ${p.publisher}, ${p.doc_date ?? 'n.d.'}. ${p.source_url} (${p.reliability})`);
  return L.join('\n');
}

export function download(name: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportJson(run: Run) {
  download(`run-${run.id.slice(0, 8)}.json`, JSON.stringify(run, null, 2), 'application/json');
}
