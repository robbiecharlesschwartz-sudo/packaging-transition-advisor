import { useCallback, useEffect, useRef, useState } from 'react';
import { KpiTiles, SectionCard, SourcesList } from './components/Brief';
import { EvidenceDrawer, ProgressStrip } from './components/panels';
import { ProfileForm } from './components/ProfileForm';
import { EvidenceCtx, Icon } from './components/ui';
import { WorkflowGraph } from './components/WorkflowGraph';
import { api, EXAMPLES, loadBundledExample } from './lib/api';
import { download, exportJson, toMarkdown } from './lib/exporters';
import { dateLabel } from './lib/format';
import type { Meta, Profile, Run, Step } from './lib/types';

type Tab = 'brief' | 'how' | 'sources';

function useTheme() {
  const [dark, setDark] = useState(() => !document.documentElement.classList.contains('light'));
  useEffect(() => {
    document.documentElement.classList.toggle('light', !dark);
    try { localStorage.setItem('pta-theme', dark ? 'dark' : 'light'); } catch { /* storage may be blocked */ }
  }, [dark]);
  return [dark, setDark] as const;
}

/** Replays a saved run: reveals its real step logs one by one, then the brief. */
function useReplay() {
  const timers = useRef<number[]>([]);
  const stop = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const play = (run: Run, onFrame: (r: Run) => void) => {
    stop();
    const order = ['input', 'plan', 'retrieve', 'passages', 'cost', 'sourcing', 'write', 'verify', 'report'];
    const steps = [...run.steps].sort((a, b) => order.indexOf(a.step_id.replace(/-\d+$/, '')) - order.indexOf(b.step_id.replace(/-\d+$/, '')));
    steps.forEach((_, i) => {
      timers.current.push(window.setTimeout(() => {
        const shown: Step[] = steps.slice(0, i + 1).map((s, j) => (j === i ? { ...s, status: 'running' } : s));
        onFrame({ ...run, status: 'running', output: null, steps: shown });
      }, 450 * i));
    });
    timers.current.push(window.setTimeout(() => onFrame(run), 450 * steps.length + 300));
  };
  useEffect(() => stop, []);
  return { play, stop };
}

export function App({ embed = false }: { embed?: boolean }) {
  const [dark, setDark] = useTheme();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [mode, setMode] = useState<'live' | 'replay'>(embed ? 'replay' : 'replay');
  const [run, setRun] = useState<Run | null>(null);
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(window.location.search).get('tab') as Tab) ?? 'brief');
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(!embed);
  const [evidence, setEvidence] = useState<{ ns: number[]; focus?: number; label?: string } | null>(null);
  const [example, setExample] = useState(() => new URLSearchParams(window.location.search).get('example') ?? EXAMPLES[0].slug);
  const replay = useReplay();
  const poll = useRef<number | null>(null);

  useEffect(() => { api.meta().then(setMeta).catch(() => setMeta(null)); }, []);

  const loadExample = useCallback(async (slug: string) => {
    setError(null);
    setExample(slug);
    try {
      const r = await loadBundledExample(slug);
      replay.play(r, setRun);
    } catch (e) {
      setError(`Could not load example: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => { if (mode === 'replay') loadExample(example); }, [mode]);

  const startLive = async (workflow: string, profile: Profile | null, question: string | null) => {
    replay.stop();
    setError(null);
    setEvidence(null);
    try {
      const { run_id } = await api.run(workflow, profile, question);
      setRun({ id: run_id, created_at: new Date().toISOString(), workflow_id: workflow, profile, question, status: 'queued', output: null, steps: [] });
      if (poll.current) clearInterval(poll.current);
      poll.current = window.setInterval(async () => {
        try {
          const r = await api.getRun(run_id);
          setRun(r);
          if (r.status === 'done' || r.status === 'error') {
            clearInterval(poll.current!);
            if (r.status === 'error') setError(r.error ?? 'Run failed');
          }
        } catch { /* keep polling */ }
      }, 2000);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => () => { if (poll.current) clearInterval(poll.current); }, []);

  const o = run?.output ?? null;
  const busy = !!run && (run.status === 'running' || run.status === 'queued');
  const needs = meta?.workflows.find((w) => w.id === run?.workflow_id)?.needs ?? { cost: !!o?.sections.some((s) => s.kind === 'cost'), sourcing: !!o?.sections.some((s) => s.kind === 'sourcing') };
  const evidenceCol = tab !== 'how';
  const show = useCallback((ns: number[], focus?: number, label?: string) => setEvidence({ ns, focus, label }), []);

  return (
    <EvidenceCtx.Provider value={{ show }}>
      <div className="min-h-screen">
        {/* Header */}
        <header className="no-print sticky top-0 z-20 border-b border-line bg-surface">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
            <div className="flex items-center gap-2.5">
              <img src="/favicon.svg" alt="" className="h-6 w-6" />
              <div className="leading-tight">
                <div className="text-[14px] font-semibold">Packaging Transition Advisor</div>
                <div className="kicker normal-case tracking-normal">RAG research agent · cited · US-first</div>
              </div>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2 text-xs2 text-sub">
              <span>Corpus last updated: <b className="text-ink">{dateLabel(meta?.corpus_updated ?? o?.corpus_updated ?? null)}</b>{meta ? ` · ${meta.documents_excluding_news} documents` : ''}</span>
              {!embed && (
                <div className="flex gap-1 rounded-[8px] border border-line bg-surface p-1" role="tablist" aria-label="Mode">
                  {(['replay', 'live'] as const).map((m) => (
                    <button key={m} role="tab" aria-selected={mode === m} className={`h-7 rounded-[6px] px-3 text-[12px] font-medium ${mode === m ? 'bg-primary text-bg' : 'text-sub hover:bg-raised hover:text-ink'}`} onClick={() => setMode(m)}>
                      {m === 'replay' ? 'Replay examples' : 'Live run'}
                    </button>
                  ))}
                </div>
              )}
              <button className="btn-ghost px-2 py-1.5" onClick={() => setDark(!dark)} aria-label="Toggle dark mode"><Icon name={dark ? 'sun' : 'moon'} /></button>
            </div>
          </div>
          <div className="kicker border-t border-line px-4 py-1 normal-case tracking-normal">
            Research aid, not legal or financial advice · Estimates are order-of-magnitude · Every claim links to its source passage
          </div>
        </header>

        <div className={`grid min-h-[calc(100vh-74px)] ${panelOpen ? (evidenceCol ? 'lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_380px]' : 'lg:grid-cols-[300px_minmax(0,1fr)]') : evidenceCol ? 'xl:grid-cols-[minmax(0,1fr)_380px]' : ''}`}>
          {/* Left panel */}
          {panelOpen && (
            <aside className="no-print border-b border-line p-4 lg:sticky lg:top-[74px] lg:h-[calc(100vh-74px)] lg:overflow-y-auto lg:border-b-0 lg:border-r">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-[13px] font-semibold">{mode === 'live' ? 'Package profile' : 'Example runs'}</div>
                <button className="btn-ghost px-2 py-1 text-xs2" onClick={() => setPanelOpen(false)}>Hide</button>
              </div>
              {mode === 'live' ? (
                <ProfileForm meta={meta} busy={busy} onRun={startLive} />
              ) : (
                <div className="space-y-2">
                  <p className="text-sm2 text-sub">Saved, complete runs of the real pipeline. Replaying uses no LLM quota.</p>
                  {EXAMPLES.map((e) => (
                    <button key={e.slug} className={`w-full border p-2.5 text-left text-[13px] ${example === e.slug ? 'border-strong bg-primary text-bg' : 'border-line hover:border-strong'}`} onClick={() => loadExample(e.slug)}>
                      <div className="font-semibold">{e.label}</div>
                    </button>
                  ))}
                  <button className="btn-ghost mt-2 w-full" onClick={() => loadExample(example)}><Icon name="play" /> Replay again</button>
                </div>
              )}
            </aside>
          )}

          {/* Center */}
          <main className="min-w-0 space-y-3 p-3">
            {!panelOpen && <button className="no-print btn-ghost" onClick={() => setPanelOpen(true)}>Show {mode === 'live' ? 'profile form' : 'examples'}</button>}
            {error && <div className="card border-danger/40 p-3 text-sm2 text-danger" role="alert">{error}</div>}
            {run && <div className="no-print card p-2"><ProgressStrip steps={run.steps} status={run.status} /></div>}
            {!run && !error && (
              <div className="card p-6">
                <h1 className="mb-2 text-h1 font-semibold">What happens if we move our packaging to a sustainable alternative?</h1>
                <p className="text-sub">Ask a question or describe a package. The agent searches a curated, dated library of public documents (laws, agency data, recycling program lists, open-access research, SEC filings, price statistics), keeps the relevant passages, and writes a brief where every sentence is cited. When the documents do not cover something, it says so.</p>
              </div>
            )}

            {o && (
              <>
                <div className="no-print flex flex-wrap items-center gap-2">
                  <div className="flex gap-1 rounded-[8px] border border-line bg-surface p-1" role="tablist">
                    {([['brief', 'Brief'], ['how', 'How this answer was made'], ['sources', 'Sources']] as const).map(([t, l]) => (
                      <button key={t} role="tab" aria-selected={tab === t} className={`h-8 rounded-[6px] px-3 text-[12.5px] font-medium ${tab === t ? 'bg-primary text-bg' : 'text-sub hover:bg-raised hover:text-ink'}`} onClick={() => setTab(t)}>{l}</button>
                    ))}
                  </div>
                  <div className="ml-auto flex gap-2">
                    <button className="btn-ghost" onClick={() => download(`brief-${run!.id.slice(0, 8)}.md`, toMarkdown(o), 'text/markdown')}><Icon name="download" /> Markdown</button>
                    <button className="btn-ghost" onClick={() => exportJson(run!)}><Icon name="download" /> JSON</button>
                    <button className="btn-primary" onClick={() => { setTab('brief'); setTimeout(() => window.print(), 300); }}><Icon name="report" /> PDF report</button>
                  </div>
                </div>

                {/* Print cover page */}
                <div className="print-only">
                  <div style={{ minHeight: '90vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <div className="kicker">Sustainable packaging transition brief</div>
                    <h1 className="mt-3 text-[34px] font-semibold leading-tight">{o.profile?.company_description ?? o.question ?? o.workflow.name}</h1>
                    <div className="mt-4 text-body">{o.profile ? `${o.profile.package_type ?? ''} · current material: ${o.profile.current_material ?? 'n/a'} · sales: ${(o.profile.sales_states ?? []).join(', ') || 'nationwide'}` : ''}</div>
                    <div className="mt-8 text-sm2 text-sub">{o.workflow.name} · generated {dateLabel(o.generated_at)} · corpus updated {dateLabel(o.corpus_updated)}</div>
                    <div className="mt-2 text-sm2 text-sub">Research aid, not legal or financial advice. Estimates are order-of-magnitude.</div>
                  </div>
                </div>

                {tab === 'brief' && (
                  <div className="space-y-3">
                    {o.question && <div className="card p-3"><span className="label">Question</span><div className="text-[16px] font-semibold">{o.question}</div></div>}
                    {o.sections.length > 2 && <div className="print-page"><KpiTiles o={o} /></div>}
                    <div className="print-grid grid gap-3 xl:grid-cols-2">
                      {o.sections.map((s, i) => <SectionCard key={s.id} s={s} o={o} index={i + 1} />)}
                      <SourcesList o={o} />
                    </div>
                  </div>
                )}
                {tab === 'how' && (
                  <div className="space-y-3">
                    <div className="card p-4 text-sm2">
                      <b>The loop:</b> question → search reference documents → relevant passages → cited summary report. Each box below is a real, logged step of this run (Cloudflare Workflows). Click one to see its actual inputs and outputs.
                    </div>
                    <WorkflowGraph steps={run!.steps} needs={needs} />
                  </div>
                )}
                {tab === 'sources' && <SourcesList o={o} />}
              </>
            )}
          </main>

          {/* Evidence drawer */}
          {evidenceCol && <div className={`no-print ${evidence ? 'fixed inset-y-0 right-0 z-30 w-full max-w-md border-l border-strong bg-bg xl:static xl:z-auto xl:w-auto xl:max-w-none' : 'hidden xl:block'} xl:border-l xl:border-line`}>
            <div className="h-full bg-surface xl:sticky xl:top-[74px] xl:h-[calc(100vh-74px)]">
              <EvidenceDrawer passages={o?.passages ?? []} ns={evidence?.ns ?? []} focus={evidence?.focus} label={evidence?.label} onClose={() => setEvidence(null)} />
            </div>
          </div>}
        </div>
        <footer className="no-print border-t border-line px-4 py-3 text-xs2 text-sub">
          Built on Cloudflare free tier (Workers, Workflows, D1, Vectorize, Workers AI) with Gemini for writing. Sources are public documents; link-only sources show metadata only.{' '}
          <a className="underline" href="https://github.com/robbiecharlesschwartz-sudo/packaging-transition-advisor" target="_blank" rel="noreferrer">Source code</a>
        </footer>
      </div>
    </EvidenceCtx.Provider>
  );
}
