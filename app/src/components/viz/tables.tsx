import { grams, range } from '../../lib/format';
import { Cites } from '../ui';

const RATING: Record<string, string> = {
  Strong: 'bg-primary text-white dark:text-bg',
  Possible: 'bg-accent-soft text-accent',
  Weak: 'bg-danger/15 text-danger',
  Unknown: 'border border-dashed border-line text-sub',
};

/** Alternatives x functional needs heatmap (Strong / Possible / Weak / Unknown). */
export function FitMatrix({ options, needs }: { options: any[]; needs: string[] }) {
  if (!options?.length) return null;
  const cols = needs.length ? needs : [...new Set(options.flatMap((o) => (o.needs ?? []).map((n: any) => n.need)))];
  return (
    <figure className="overflow-x-auto">
      <figcaption className="mb-2 text-sm2 font-semibold">Fit against functional needs: {options.filter((o) => o.fit === 'Strong').length} strong, {options.filter((o) => o.fit === 'Possible').length} possible</figcaption>
      <table className="tbl min-w-[520px]">
        <thead><tr><th>Alternative</th><th>Overall fit</th>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {options.map((o, i) => (
            <tr key={i}>
              <td className="font-medium">{o.name}</td>
              <td><span className={`chip ${RATING[o.fit] ?? RATING.Unknown}`}>{o.fit}</span></td>
              {cols.map((c) => {
                const n = (o.needs ?? []).find((x: any) => x.need === c);
                const r = n?.rating ?? 'Unknown';
                return <td key={c} title={n?.note}><span className={`chip ${RATING[r] ?? RATING.Unknown}`}>{r}</span>{n?.cites?.length ? <Cites ns={n.cites} /> : null}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 space-y-2">
        {options.map((o, i) => (o.reasons ?? []).length ? (
          <div key={i} className="text-sm2"><span className="font-semibold">{o.name}:</span> {(o.reasons ?? []).map((r: any, j: number) => <span key={j}>{r.text}<Cites ns={r.cites} /> </span>)}</div>
        ) : null)}
      </div>
    </figure>
  );
}

const EOL: Record<string, [string, string]> = {
  accepted: ['✓', 'text-primary'], limited: ['◐', 'text-accent'], not_accepted: ['✕', 'text-danger'], unknown: ['?', 'text-sub'],
};

export function EolTable({ rows }: { rows: any[] }) {
  if (!rows?.length) return null;
  const n = (s: string) => rows.filter((r) => r.status === s).length;
  return (
    <figure className="overflow-x-auto">
      <figcaption className="mb-2 text-sm2 font-semibold">{n('accepted')} accepted, {n('limited')} limited, {n('not_accepted')} not accepted across the locations checked</figcaption>
      <table className="tbl min-w-[560px]">
        <thead><tr><th>Alternative</th><th>Where</th><th>Pathway</th><th>Status</th><th>Note</th></tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const [ic, cls] = EOL[r.status] ?? EOL.unknown;
            return (
              <tr key={i}>
                <td className="font-medium">{r.alternative}</td><td>{r.location}</td><td>{r.pathway}</td>
                <td className={`whitespace-nowrap font-semibold ${cls}`}><span aria-hidden>{ic}</span> {String(r.status).replace('_', ' ')}</td>
                <td>{r.note}<Cites ns={r.cites} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </figure>
  );
}

export function ClaimsRisk({ safe, risky }: { safe: any[]; risky: any[] }) {
  if (!safe?.length && !risky?.length) return null;
  const Col = ({ title, items, tone }: { title: string; items: any[]; tone: string }) => (
    <div className={`rounded-md border p-3 ${tone}`}>
      <div className="label">{title} ({items.length})</div>
      <ul className="space-y-3 text-sm2">
        {items.map((c, i) => <li key={i}><div className="font-semibold">“{c.claim}”</div><div className="text-sub">{c.why}<Cites ns={c.cites} /></div></li>)}
      </ul>
    </div>
  );
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Col title="Claims that can be supported" items={safe ?? []} tone="border-primary/40 bg-primary-soft/40" />
      <Col title="Risky claims" items={risky ?? []} tone="border-accent/40 bg-accent-soft/40" />
    </div>
  );
}

export function CostTable({ d, inputN }: { d: any; inputN: Map<string, number> }) {
  const opts: any[] = d.options;
  const cite = (ids: string[] = []) => ids.map((i) => inputN.get(i)).filter(Boolean) as number[];
  return (
    <div className="overflow-x-auto">
      <table className="tbl min-w-[640px]">
        <thead><tr><th>Line item</th>{opts.map((o) => <th key={o.key} className="num">{o.label}</th>)}</tr></thead>
        <tbody>
          <tr><td>Unit weight (g)</td>{opts.map((o) => <td key={o.key} className="num" title={o.weight_g.method + (o.weight_g.assumption ? ` — ${o.weight_g.assumption}` : '')}>{grams(o.weight_g.low, o.weight_g.high)}<Cites ns={cite(o.weight_g.inputs)} /></td>)}</tr>
          <tr><td>Material cost / unit</td>{opts.map((o) => <td key={o.key} className="num" title={o.material_cost?.basis}>{range(o.material_cost)}<Cites ns={cite(o.material_cost?.inputs)} /></td>)}</tr>
          {d.states.map((s: string) => (
            <tr key={s}><td>EPR fee / unit ({s})</td>{opts.map((o) => { const e = o.epr[s]; return <td key={o.key} className="num">{'low' in e ? <>{range(e)}<Cites ns={cite(e.inputs)} /></> : <span className="text-xs2 text-sub">{e.status}</span>}</td>; })}</tr>
          ))}
          <tr><td>Freight delta / unit</td>{opts.map((o) => <td key={o.key} className="num text-xs2 text-sub">{o.freight.weight_delta_g ? `${o.freight.weight_delta_g.low > 0 ? '+' : ''}${o.freight.weight_delta_g.low.toFixed(1)} to ${o.freight.weight_delta_g.high.toFixed(1)} g; $ not cited` : '—'}</td>)}</tr>
          <tr className="font-semibold"><td>Estimated total / unit</td>{opts.map((o) => <td key={o.key} className="num">{range(o.total_per_unit)}</td>)}</tr>
          {d.annual_units ? <tr className="font-semibold"><td>Annual (× {Number(d.annual_units).toLocaleString('en-US')} units)</td>{opts.map((o) => <td key={o.key} className="num">{range(o.annual, 0)}</td>)}</tr> : null}
        </tbody>
      </table>
    </div>
  );
}

export function SupplierTable({ byAlt }: { byAlt: Record<string, any[]> }) {
  return (
    <div className="space-y-4">
      {Object.entries(byAlt).map(([alt, rows]) => (
        <div key={alt} className="overflow-x-auto">
          <div className="mb-1 text-sm2 font-semibold">{alt}: {rows.length} supplier{rows.length === 1 ? '' : 's'} in the table</div>
          {rows.length ? (
            <table className="tbl min-w-[640px]">
              <thead><tr><th>Supplier</th><th>Match</th><th>Certifications</th><th>Nearest listed US plant</th><th>Scale</th><th>Public cost evidence</th><th>Source</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.supplier_id}>
                    <td className="font-medium">{r.company_name}</td>
                    <td>{r.match}</td>
                    <td>{r.certifications.join(', ') || '—'}</td>
                    <td>{r.nearest ? `${r.nearest.city}, ${r.nearest.state} (${r.nearest.km.toLocaleString('en-US')} km from ${r.nearest.to_state})` : `— (${r.us_plants} listed)`}</td>
                    <td>{r.scale_tier}</td>
                    <td className="text-sub">{r.cost_evidence}</td>
                    <td><Cites ns={r.cites} />{r.inquiry_url && <a className="ml-1 text-xs2 text-primary underline" href={r.inquiry_url} target="_blank" rel="noreferrer">filing</a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm2 text-sub">No supplier in the structured table makes this alternative.</p>}
        </div>
      ))}
    </div>
  );
}
