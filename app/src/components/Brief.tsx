import { useContext } from 'react';
import { range } from '../lib/format';
import type { Output, Section } from '../lib/types';
import { ClaimList, Cites, EvidenceCtx, Gaps, Removed, SourceLine, StatusBadge } from './ui';
import { CostRangeChart, CostStackChart, EvidenceCharts, PpiChart } from './viz/charts';
import { StateMap, SupplierMap, Timeline } from './viz/maps';
import { ClaimsRisk, CostTable, EolTable, FitMatrix, SupplierTable } from './viz/tables';

const PPI_LABELS: Record<string, string> = {
  PCU325211325211: 'Plastics resins', PCU326111326111: 'Plastic bags & pouches', PCU326112326112: 'Plastic film & sheet',
  PCU326160326160: 'Plastic bottles', PCU322211322211: 'Corrugated boxes', PCU322212322212: 'Folding paperboard boxes',
  PCU322220322220: 'Paper bags & coated paper', PCU322130322130: 'Paperboard mills', PCU327213327213: 'Glass containers',
  PCU331315331315: 'Aluminum sheet & foil', PCU332431332431: 'Metal cans', PCU484121484121: 'Truckload freight',
};

function SectionVisual({ s, o }: { s: Section; o: Output }) {
  const d = s.data ?? {};
  switch (s.kind) {
    case 'alternatives':
      return <FitMatrix options={d.options ?? []} needs={o.profile?.functional_needs ?? []} />;
    case 'regulatory':
      return (
        <>
          <StateMap selected={d.selected_states ?? []} cited={d.state_laws ?? []} />
          <Timeline laws={d.state_laws ?? []} />
          {(d.rows ?? []).length > 0 && (
            <div className="mt-6 overflow-x-auto">
              <table className="tbl min-w-[640px]">
                <thead><tr><th>Jurisdiction</th><th>EPR status</th><th>Key dates</th><th>Recycled content</th><th>Bans</th><th>Labeling</th></tr></thead>
                <tbody>
                  {d.rows.map((r: any, i: number) => (
                    <tr key={i}>
                      <td className="font-medium">{r.jurisdiction}</td>
                      <td>{String(r.epr_status ?? 'unknown').replace(/_/g, ' ')}</td>
                      <td>{(r.key_dates ?? []).map((k: any, j: number) => <div key={j}>{k.date}: {k.event}<Cites ns={k.cites} /></div>)}</td>
                      {['recycled_content', 'bans', 'labeling'].map((f) => <td key={f}>{r[f]?.text || <span className="text-sub">—</span>}<Cites ns={r[f]?.cites} /></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      );
    case 'eol':
      return <EolTable rows={d.rows ?? []} />;
    case 'claims':
      return <ClaimsRisk safe={d.safe ?? []} risky={d.risky ?? []} />;
    case 'cost': {
      if (!d.available) return <p className="text-sm2 text-sub">{d.reason ?? 'Cost calculator did not run.'}</p>;
      const inputN = new Map<string, number>((d.inputs ?? []).filter((i: any) => i.n).map((i: any) => [i.id, i.n]));
      const series = [...new Set((d.inputs ?? []).map((i: any) => i.ppi_series).filter(Boolean))].slice(0, 5) as string[];
      return (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm2">
            <span className={`chip ${d.confidence === 'Medium' ? 'border-strong bg-primary text-white' : 'border-strong'}`}>Confidence: {d.confidence}</span>
            <span className="text-sub">{d.note}</span>
          </div>
          <CostTable d={d} inputN={inputN} />
          <SourceLine ns={[...inputN.values()]} />
          <div className="mt-6"><CostRangeChart options={d.options} /></div>
          <CostStackChart options={d.options} states={d.states} />
          <PpiChart series={series} labels={PPI_LABELS} />
          <Gaps gaps={d.gaps ?? []} title="Limits of this estimate" />
        </>
      );
    }
    case 'sourcing':
      if (!d.by_alternative) return null;
      return (
        <>
          <SupplierMap plants={d.plants ?? []} salesStates={d.sales_states ?? []} />
          <div className="mt-6"><SupplierTable byAlt={d.by_alternative} /></div>
          <p className="mt-3 text-sm2 italic text-sub">{d.note}</p>
          <details className="mt-3">
            <summary className="cursor-pointer text-sm2 font-semibold">How to engage: request-for-quote checklist</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm2">{(d.rfq_checklist ?? []).map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>
          </details>
        </>
      );
    case 'competitor':
      return (d.examples ?? []).length ? (
        <ul className="grid gap-3 md:grid-cols-2">
          {d.examples.map((e: any, i: number) => (
            <li key={i} className="border border-line p-2.5 text-[12.5px]">
              <div className="font-semibold">{e.company} <span className="font-normal text-sub">{e.year ?? ''}</span></div>
              <div>{e.action}<Cites ns={e.cites} /></div>
            </li>
          ))}
        </ul>
      ) : null;
    case 'gaps':
      return (
        <div className="grid gap-4 md:grid-cols-2">
          <div><div className="label">Open questions</div><ul className="list-disc space-y-1 pl-5 text-sm2">{s.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul></div>
          <div>
            {(d.next_questions ?? []).length > 0 && (<><div className="label">Research to-do</div><ul className="mb-3 list-disc space-y-1 pl-5 text-sm2">{d.next_questions.map((g: string, i: number) => <li key={i}>{g}</li>)}</ul></>)}
            {(d.documents_needed ?? []).length > 0 && (<><div className="label">Documents that would answer them</div><ul className="list-disc space-y-1 pl-5 text-sm2">{d.documents_needed.map((g: string, i: number) => <li key={i}>{g}</li>)}</ul></>)}
          </div>
        </div>
      );
    default:
      return null;
  }
}

const WIDE = new Set(['summary', 'regulatory', 'cost', 'sourcing', 'alternatives', 'gaps']);

export function SectionCard({ s, o, index }: { s: Section; o: Output; index: number }) {
  const { show } = useContext(EvidenceCtx);
  return (
    <section id={`sec-${s.id}`} className={`card print-page scroll-mt-16 p-4 ${WIDE.has(s.kind) ? 'xl:col-span-2' : ''}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
        <div className="kicker"><span className="mr-1.5 text-primary">{String(index).padStart(2, '0')}</span>{s.title}</div>
        <div className="flex items-center gap-2">
          {s.passages?.length > 0 && <button className="no-print text-[11px] font-medium text-primary hover:underline" onClick={() => show(s.passages, undefined, s.title)}>{s.passages.length} passages</button>}
          <StatusBadge s={s.status} />
        </div>
      </div>
      <h2 className="mb-3 text-h2 font-semibold">{s.takeaway}</h2>
      {s.kind !== 'gaps' && <ClaimList claims={s.claims} />}
      <div className={s.claims.length ? 'mt-4' : ''}><SectionVisual s={s} o={o} /></div>
      {s.kind !== 'gaps' && s.kind !== 'cost' && <Gaps gaps={s.gaps} />}
      <Removed items={s.removed} />
    </section>
  );
}

export function KpiTiles({ o }: { o: Output }) {
  const k = o.kpis;
  const tiles = [
    { label: 'Recommended alternative', value: k.recommended_alternative?.name ?? '—', sub: k.recommended_alternative ? `${k.recommended_alternative.fit} fit` : 'none rated Strong or Possible' },
    { label: 'Cost change per unit', value: k.cost_change_per_unit ? range(k.cost_change_per_unit) : '—', sub: k.cost_change_per_unit ? `${k.cost_change_per_unit.alternative} vs current · ${k.cost_change_per_unit.confidence} confidence` : 'not estimated' },
    { label: 'States with EPR fees in effect', value: k.states_with_fees.length ? k.states_with_fees.join(', ') : 'None', sub: 'among the selected sales states' },
    { label: 'Evidence strength', value: k.evidence_strength.label, sub: `${k.evidence_strength.supported_share}% of claims verified · ${k.evidence_strength.primary_share}% primary sources`, meter: k.evidence_strength.supported_share },
  ];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="card p-3">
          <div className="label">{t.label}</div>
          <div className="tabular text-[18px] font-semibold leading-6">{t.value}</div>
          <div className="mt-0.5 text-xs2 text-sub">{t.sub}</div>
          {t.meter !== undefined && (
            <div className="mt-2 h-1 w-full rounded-full bg-muted" role="meter" aria-valuenow={t.meter} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-1 rounded-full bg-primary" style={{ width: `${t.meter}%` }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function SourcesList({ o }: { o: Output }) {
  const cited = o.passages.filter((p) => p.cited);
  return (
    <section id="sec-sources" className="card print-page p-4 xl:col-span-2">
      <div className="kicker mb-2 border-b border-line pb-2">Sources</div>
      <h2 className="mb-3 text-h2 font-semibold">{cited.length} cited passages from {new Set(cited.map((p) => p.document_id)).size} documents</h2>
      <EvidenceCharts passages={o.passages} />
      <ol className="mt-4 grid gap-x-6 gap-y-1 text-[12.5px] lg:grid-cols-2">
        {cited.map((p) => (
          <li key={p.n} className="flex gap-2">
            <Cites ns={[p.n]} />
            <span>
              <a className="font-medium text-primary underline-offset-2 hover:underline" href={p.source_url} target="_blank" rel="noreferrer">{p.title}</a>. {p.publisher}, {p.doc_date ?? 'n.d.'}.
              <span className="ml-1 chip bg-muted text-sub">{p.reliability}</span> <span className="chip bg-muted text-sub">{p.layer}</span>{p.license === 'link_only' && <span className="ml-1 chip bg-muted text-sub">link only</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
