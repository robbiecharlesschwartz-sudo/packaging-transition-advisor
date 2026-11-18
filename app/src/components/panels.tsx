import { useEffect, useRef } from 'react';
import { dateLabel } from '../lib/format';
import type { Passage, Step, StepDef } from '../lib/types';
import { Icon } from './ui';

export function EvidenceDrawer({ passages, ns, focus, label, onClose }: { passages: Passage[]; ns: number[]; focus?: number; label?: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const list = ns.map((n) => passages.find((p) => p.n === n)).filter(Boolean) as Passage[];
  useEffect(() => {
    ref.current?.querySelector(`[data-n="${focus}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [focus, ns.join(',')]);
  return (
    <aside className="no-print flex h-full flex-col" aria-label="Evidence">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-bg"><Icon name="file" /></span>
            <div>
              <div className="text-[13px] font-semibold">Evidence</div>
              <div className="flex items-center gap-1 text-[11px] text-sub"><span className="h-1.5 w-1.5 rounded-full bg-ok" />{label ?? (list.length ? `${list.length} passage${list.length > 1 ? 's' : ''}` : 'Retrieved passages')}</div>
            </div>
          </div>
        </div>
        <button className="btn-ghost px-2 py-1 xl:hidden" onClick={onClose} aria-label="Close evidence"><Icon name="x" /></button>
      </div>
      <div ref={ref} className="flex-1 space-y-3 overflow-y-auto p-4">
        {!list.length && <p className="text-sm2 text-sub">Every sentence in the brief carries numbered citations. Click one to see the exact passage it came from, with publisher, date and reliability tier.</p>}
        {list.map((p) => (
          <article key={p.n} data-n={p.n} className={`rounded-[8px] border bg-raised p-3 text-[12.5px] ${p.n === focus ? 'border-sub' : 'border-line'}`}>
            <div className="mb-1 flex items-start gap-2">
              <span className="cite">{p.n}</span>
              <a href={p.source_url} target="_blank" rel="noreferrer" className="font-semibold text-ink underline decoration-line underline-offset-2 hover:decoration-ink">{p.title}</a>
            </div>
            <div className="mb-2 text-xs2 text-sub">
              {p.publisher} · {dateLabel(p.doc_date)} · {p.jurisdiction} · <span className="font-semibold">{p.reliability}</span>
              {p.section ? ` · ${p.section}` : ''}{p.page ? ` · p.${p.page}` : ''}
            </div>
            {p.content_visible ? (
              <p className="whitespace-pre-line leading-6">{p.content.length > 1800 ? p.content.slice(0, 1800) + ' …' : p.content}</p>
            ) : (
              <p className="italic text-sub">Passage text not shown: this source is link-only (copyright). Open the source to read it.</p>
            )}
            <div className="mt-2 text-[11px] text-sub">retrieval: vector #{p.vector_rank ?? '—'} · keyword #{p.keyword_rank ?? '—'} · fused score {p.score.toFixed(4)}</div>
          </article>
        ))}
      </div>
    </aside>
  );
}

const PROGRESS = [
  { id: 'plan', label: 'Planning' },
  { id: 'retrieve', label: 'Searching' },
  { id: 'passages', label: 'Passages found' },
  { id: 'write', label: 'Writing' },
  { id: 'verify', label: 'Checking evidence' },
  { id: 'report', label: 'Report' },
];

export function ProgressStrip({ steps, status }: { steps: Step[]; status: string }) {
  const by = new Map(steps.map((s) => [s.step_id.replace(/-\d+$/, ''), s]));
  const text = (id: string) => {
    const s = by.get(id)?.summary ?? {};
    if (id === 'plan' && s.sub_queries) return `${s.sub_queries} sub-queries`;
    if (id === 'retrieve' && s.searched_chunks) return `${Number(s.searched_chunks).toLocaleString('en-US')} chunks · ${s.documents} docs`;
    if (id === 'passages' && s.kept) return `${s.kept} passages kept`;
    if (id === 'write' && s.claims !== undefined) return `${s.claims} claims drafted`;
    if (id === 'verify' && s.checked !== undefined) return `${s.supported}/${s.checked} supported · ${s.removed} removed`;
    return '';
  };
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-live="polite">
      {PROGRESS.map((p, i) => {
        const st = by.get(p.id)?.status;
        const tone = st === 'done' ? 'border-line text-ink' : st === 'running' ? 'border-sub text-ink animate-pulse' : st === 'error' ? 'border-danger/40 bg-danger/10 text-danger' : 'pill-gap';
        return (
          <li key={p.id} className="flex items-center gap-2">
            <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${tone}`}>{st === 'done' && <span className="mr-1 text-ok">✓</span>}{p.label}{text(p.id) ? ` · ${text(p.id)}` : ''}</span>
            {i < PROGRESS.length - 1 && <Icon name="chevron" className="h-3 w-3 text-sub" />}
          </li>
        );
      })}
      {status === 'error' && <li className="text-xs2 text-danger">Run failed</li>}
    </ol>
  );
}

export function StepDetail({ def, step }: { def: StepDef; step?: Step }) {
  const d = step?.detail;
  return (
    <div className="space-y-3 text-sm2">
      <div className="flex items-center gap-2 border-b border-line pb-2"><Icon name={def.icon} className="h-4 w-4" /><div className="text-[13px] font-semibold uppercase tracking-wide">{def.label}</div></div>
      <p className="text-sub">{def.description}</p>
      <div className="grid grid-cols-2 gap-2 text-xs2"><div><span className="label">Inputs</span>{def.inputs.join(', ')}</div><div><span className="label">Outputs</span>{def.outputs.join(', ')}</div></div>
      {!step && <p className="italic text-sub">This step did not run for this workflow.</p>}
      {step && <div className="text-xs2 text-sub">Status: <b>{step.status}</b>{step.ended_at ? ` · finished ${new Date(step.ended_at).toLocaleTimeString()}` : ''}</div>}
      {step?.summary && <pre className="overflow-x-auto border border-line bg-muted p-2 text-[11px]">{JSON.stringify(step.summary, null, 2)}</pre>}
      {def.id === 'plan' && d?.queries && <ul className="space-y-1">{d.queries.map((q: any, i: number) => <li key={i}><span className="chip bg-muted text-sub">{q.section}</span> {q.query}</li>)}</ul>}
      {def.id === 'retrieve' && Array.isArray(d) && d.map((r: any, i: number) => (
        <div key={i}><div className="font-semibold">“{r.query}”</div><ul className="pl-3 text-xs2">{r.hits.slice(0, 5).map((h: any) => <li key={h.chunk_id}>{h.title} · score {Number(h.score).toFixed(4)} (vector #{h.v ?? '—'}, keyword #{h.kw ?? '—'})</li>)}</ul></div>
      ))}
      {def.id === 'passages' && Array.isArray(d) && <ol className="text-xs2">{d.map((p: any) => <li key={p.n}>[{p.n}] {p.title} <span className="text-sub">({p.layer})</span></li>)}</ol>}
      {def.id === 'cost' && d?.inputs && <ul className="text-xs2">{d.inputs.map((i: any) => <li key={i.id}>{i.id}: {i.low}{i.high !== i.low ? `–${i.high}` : ''} {i.unit ?? ''} <span className="text-sub">({i.title ?? i.doc_id})</span></li>)}</ul>}
      {def.id === 'verify' && Array.isArray(d) && <ul className="space-y-1 text-xs2">{d.map((v: any, i: number) => <li key={i}><span className={`chip ${v.verdict === 'supported' ? 'pill-ok' : v.verdict === 'partial' ? 'pill-warn' : 'border-danger/40 bg-danger/10 text-danger'}`}>{v.verdict}</span> {v.text.slice(0, 140)} {v.note ? <i className="text-sub">— {v.note}</i> : null}</li>)}</ul>}
    </div>
  );
}
