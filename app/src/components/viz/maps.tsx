import { useMemo, useState } from 'react';
import { ComposableMap, Geographies, Geography, Marker } from 'react-simple-maps';
import statesTopo from 'us-atlas/states-10m.json';
import allLaws from '../../../../corpus/structured/state_laws.json';
import { NAME_TO_ABBR, STATE_NAMES, dateLabel } from '../../lib/format';
import { Cites } from '../ui';

type Law = { id: string; state: string; law_type: string; status: string; title: string; enacted_date: string | null; key_date: string | null; key_date_event: string | null; cite?: number | null };

const css = (v: string) => `rgb(var(--${v}))`;
const STATUS_COLOR: Record<string, string> = { fees_in_effect: css('map-fees'), enacted: css('map-enacted'), none: css('map-none') };
const STATUS_LABEL: Record<string, string> = { fees_in_effect: 'EPR fees in effect', enacted: 'EPR law enacted', none: 'No packaging EPR law in corpus' };

function eprStatus(laws: Law[], st: string): 'fees_in_effect' | 'enacted' | 'none' {
  const l = laws.find((x) => x.state === st && x.law_type === 'epr');
  return (l?.status === 'fees_in_effect' ? 'fees_in_effect' : l ? 'enacted' : 'none');
}

/** US map colored by packaging EPR status (from the cited state_laws table). Selected states are outlined. */
export function StateMap({ selected, cited }: { selected: string[]; cited: Law[] }) {
  const laws = allLaws as Law[];
  const [focus, setFocus] = useState<string | null>(selected[0] ?? null);
  const citeOf = useMemo(() => new Map(cited.map((l) => [l.id, l.cite])), [cited]);
  const focusLaws = laws.filter((l) => l.state === focus);
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_260px]">
      <div>
        <ComposableMap projection="geoAlbersUsa" width={800} height={470} style={{ width: '100%', height: 'auto' }} aria-label="Map of US states colored by packaging EPR status">
          <Geographies geography={statesTopo as any}>
            {({ geographies }) =>
              geographies.map((g) => {
                const ab = NAME_TO_ABBR[g.properties.name as string];
                if (!ab) return null;
                const st = eprStatus(laws, ab);
                const sel = selected.includes(ab);
                const hasBan = laws.some((l) => l.state === ab && l.law_type !== 'epr');
                return (
                  <Geography
                    key={g.rsmKey}
                    geography={g}
                    onClick={() => setFocus(ab)}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && setFocus(ab)}
                    aria-label={`${STATE_NAMES[ab]}: ${STATUS_LABEL[st]}${hasBan ? '; other packaging rules in corpus' : ''}`}
                    style={{
                      default: { fill: STATUS_COLOR[st], stroke: sel ? css('ink') : css('surface'), strokeWidth: sel ? 2 : 0.6, outline: 'none' },
                      hover: { fill: STATUS_COLOR[st], stroke: css('ink'), strokeWidth: 1.5, outline: 'none', cursor: 'pointer' },
                      pressed: { fill: STATUS_COLOR[st], outline: 'none' },
                    }}
                  />
                );
              })
            }
          </Geographies>
        </ComposableMap>
        <div className="mt-1 flex flex-wrap gap-4 text-xs2 text-sub">
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: STATUS_COLOR[k] }} />{v}</span>
          ))}
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border-2 border-ink" />Selected sales state</span>
        </div>
      </div>
      <div className="rounded-md border border-line p-3 text-sm2">
        <div className="label">{focus ? STATE_NAMES[focus] : 'Click a state'}</div>
        {focus && !focusLaws.length && <p className="text-sub">No packaging law for this state in the corpus. That is a coverage gap, not proof there is none.</p>}
        <ul className="space-y-3">
          {focusLaws.map((l) => (
            <li key={l.id}>
              <div className="font-medium">{l.title}</div>
              <div className="text-sub">{l.status.replace(/_/g, ' ')}{l.enacted_date ? ` · enacted ${dateLabel(l.enacted_date)}` : ''}</div>
              {l.key_date && <div>{dateLabel(l.key_date)}: {l.key_date_event} {citeOf.get(l.id) ? <Cites ns={[citeOf.get(l.id)!]} /> : null}</div>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Horizontal timeline of key effective dates across the selected states. */
export function Timeline({ laws }: { laws: Law[] }) {
  const items = laws.filter((l) => l.key_date).sort((a, b) => a.key_date!.localeCompare(b.key_date!));
  if (!items.length) return null;
  const years = items.map((l) => parseInt(l.key_date!.slice(0, 4), 10));
  const y0 = Math.min(...years, new Date().getFullYear()), y1 = Math.max(...years, new Date().getFullYear()) + 1;
  const W = 800, pad = 40;
  const x = (d: string) => pad + ((new Date(d).getTime() - new Date(`${y0}-01-01`).getTime()) / (new Date(`${y1}-01-01`).getTime() - new Date(`${y0}-01-01`).getTime())) * (W - 2 * pad);
  const now = new Date().toISOString().slice(0, 10);
  return (
    <figure className="mt-6">
      <figcaption className="mb-2 text-sm2 font-semibold">Key dates: {items.length} milestones from {y0} to {y1 - 1}</figcaption>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${60 + items.length * 26}`} className="min-w-[560px] w-full" role="img" aria-label="Timeline of key regulatory dates">
          <line x1={pad} x2={W - pad} y1={30} y2={30} stroke="rgb(var(--line))" strokeWidth={2} />
          {Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i).map((y) => (
            <g key={y}><line x1={x(`${y}-01-01`)} x2={x(`${y}-01-01`)} y1={24} y2={36} stroke="rgb(var(--sub))" /><text x={x(`${y}-01-01`)} y={16} textAnchor="middle" fontSize={11} fill="rgb(var(--sub))">{y}</text></g>
          ))}
          <line x1={x(now)} x2={x(now)} y1={22} y2={52 + items.length * 26} stroke="rgb(var(--accent))" strokeDasharray="4 3" />
          <text x={x(now) + 4} y={50} fontSize={10} fill="rgb(var(--accent))">today</text>
          {items.map((l, i) => (
            <g key={l.id}>
              <circle cx={x(l.key_date!)} cy={30} r={5} fill={l.law_type === 'epr' ? 'rgb(var(--map-fees))' : 'rgb(var(--map-ban))'} />
              <line x1={x(l.key_date!)} x2={x(l.key_date!)} y1={35} y2={58 + i * 26} stroke="rgb(var(--line))" />
              <text x={Math.min(x(l.key_date!) + 6, W - 330)} y={62 + i * 26} fontSize={12} fill="rgb(var(--ink))">
                <tspan fontWeight={600}>{l.state} · {dateLabel(l.key_date)}</tspan> — {(l.key_date_event ?? '').slice(0, 70)}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <div className="mt-1 text-xs2 text-sub">Source: <Cites ns={[...new Set(items.map((l) => l.cite).filter(Boolean) as number[])]} /></div>
    </figure>
  );
}

const PALETTE = ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#D55E00', '#56B4E9', '#F0E442', '#000000'];

/** Supplier plant pins (10-K Item 2 locations, Census-geocoded) over the sales states. */
export function SupplierMap({ plants, salesStates }: { plants: { company?: string; supplier_id: string; city: string; state: string; lat: number; lng: number }[]; salesStates: string[] }) {
  const companies = [...new Set(plants.map((p) => p.company ?? p.supplier_id))];
  const color = (c: string) => PALETTE[companies.indexOf(c) % PALETTE.length];
  return (
    <figure>
      <figcaption className="mb-2 text-sm2 font-semibold">{plants.length} listed US facilities of shortlisted suppliers{salesStates.length ? ', with sales states shaded' : ''}</figcaption>
      <ComposableMap projection="geoAlbersUsa" width={800} height={470} style={{ width: '100%', height: 'auto' }} aria-label="Map of supplier facilities">
        <Geographies geography={statesTopo as any}>
          {({ geographies }) => geographies.map((g) => {
            const ab = NAME_TO_ABBR[g.properties.name as string];
            const sel = salesStates.includes(ab);
            return <Geography key={g.rsmKey} geography={g} style={{ default: { fill: sel ? 'rgb(var(--primary-soft))' : 'rgb(var(--muted))', stroke: 'rgb(var(--line))', strokeWidth: 0.6, outline: 'none' }, hover: { fill: sel ? 'rgb(var(--primary-soft))' : 'rgb(var(--muted))', outline: 'none' }, pressed: { outline: 'none' } }} />;
          })}
        </Geographies>
        {plants.map((p, i) => (
          <Marker key={i} coordinates={[p.lng, p.lat]}>
            <circle r={4} fill={color(p.company ?? p.supplier_id)} stroke="#fff" strokeWidth={1}><title>{`${p.company}: ${p.city}, ${p.state}`}</title></circle>
          </Marker>
        ))}
      </ComposableMap>
      <div className="mt-1 flex flex-wrap gap-3 text-xs2 text-sub">
        {companies.map((c) => <span key={c} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: color(c) }} />{c}</span>)}
      </div>
    </figure>
  );
}
