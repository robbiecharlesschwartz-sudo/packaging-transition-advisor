import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../../lib/api';
import { range, usd } from '../../lib/format';
import type { Passage } from '../../lib/types';

const C = { ink: 'rgb(var(--ink))', sub: 'rgb(var(--sub))', line: 'rgb(var(--line))', primary: 'rgb(var(--primary))', accent: 'rgb(var(--accent))' };
const SERIES = ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#D55E00', '#56B4E9'];
const tip = { contentStyle: { background: 'rgb(var(--surface))', border: '1px solid rgb(var(--line))', borderRadius: 8, fontSize: 12, color: 'rgb(var(--ink))' } };

/** Range bars (low–high per unit) for each option: the visual equivalent of the cost table's total line. */
export function CostRangeChart({ options }: { options: any[] }) {
  const data = options.filter((o) => o.total_per_unit).map((o) => ({ name: o.label.replace('Current: ', 'Current · '), range: [o.total_per_unit.low, o.total_per_unit.high], current: o.is_current }));
  if (!data.length) return null;
  const lowest = [...data].sort((a, b) => a.range[1] - b.range[1])[0];
  return (
    <figure>
      <figcaption className="mb-2 text-sm2 font-semibold">Estimated total cost per unit (range): {lowest.name} has the lowest upper bound</figcaption>
      <ResponsiveContainer width="100%" height={60 + data.length * 44}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }}>
          <CartesianGrid horizontal={false} stroke={C.line} />
          <XAxis type="number" tickFormatter={(v) => usd(v)} stroke={C.sub} fontSize={11} label={{ value: 'USD per unit', position: 'insideBottom', offset: -2, fill: C.sub, fontSize: 11 }} />
          <YAxis type="category" dataKey="name" width={190} stroke={C.sub} fontSize={11} />
          <Tooltip {...tip} formatter={(v: any) => (Array.isArray(v) ? `${usd(v[0])} – ${usd(v[1])}` : usd(v))} />
          <Bar dataKey="range" radius={4} barSize={18}>
            {data.map((d, i) => <Cell key={i} fill={d.current ? C.sub : SERIES[i % SERIES.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}

/** Stacked per-unit components at range midpoints: material vs. EPR fee (highest fee among sales states). */
export function CostStackChart({ options, states }: { options: any[]; states: string[] }) {
  const mid = (r: any) => (r ? (r.low + r.high) / 2 : 0);
  const data = options.filter((o) => o.material_cost).map((o) => {
    const fees = states.map((s) => o.epr[s]).filter((e: any) => e && 'low' in e);
    return { name: o.label.replace('Current: ', 'Current · '), material: mid(o.material_cost), epr: fees.length ? Math.max(...fees.map(mid)) : 0 };
  });
  if (!data.length) return null;
  return (
    <figure className="mt-6">
      <figcaption className="mb-2 text-sm2 font-semibold">What drives the per-unit cost (range midpoints)</figcaption>
      <ResponsiveContainer width="100%" height={60 + data.length * 44}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }}>
          <CartesianGrid horizontal={false} stroke={C.line} />
          <XAxis type="number" tickFormatter={(v) => usd(v)} stroke={C.sub} fontSize={11} />
          <YAxis type="category" dataKey="name" width={190} stroke={C.sub} fontSize={11} />
          <Tooltip {...tip} formatter={(v: any) => usd(v)} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="material" name="Material" stackId="a" fill={SERIES[0]} barSize={18} />
          <Bar dataKey="epr" name="EPR fee (highest sales state)" stackId="a" fill={SERIES[1]} radius={[0, 4, 4, 0]} barSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}

/** BLS PPI trend for the price series the calculator used. */
export function PpiChart({ series, labels, fallback }: { series: string[]; labels: Record<string, string>; fallback?: any[] }) {
  const [rows, setRows] = useState<any[] | null>(fallback ?? null);
  useEffect(() => {
    if (!series.length) return;
    api.ppi(series).then(setRows).catch(() => setRows(fallback ?? []));
  }, [series.join(',')]);
  if (!rows?.length) return null;
  const since = `${new Date().getFullYear() - 4}-01`;
  const periods = [...new Set(rows.filter((r) => r.period >= since).map((r) => r.period))].sort();
  const data = periods.map((p) => {
    const o: any = { period: p };
    for (const s of series) {
      const pts = rows.filter((r) => r.series_id === s);
      const base = pts.find((r) => r.period >= since)?.value;
      const v = pts.find((r) => r.period === p)?.value;
      if (base && v) o[s] = (v / base) * 100;
    }
    return o;
  });
  return (
    <figure className="mt-6">
      <figcaption className="mb-2 text-sm2 font-semibold">Producer price trend for these materials (BLS PPI, rebased to 100 in {since.slice(0, 4)})</figcaption>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ right: 24 }}>
          <CartesianGrid stroke={C.line} />
          <XAxis dataKey="period" stroke={C.sub} fontSize={11} minTickGap={40} />
          <YAxis stroke={C.sub} fontSize={11} domain={['auto', 'auto']} label={{ value: 'index', angle: -90, position: 'insideLeft', fill: C.sub, fontSize: 11 }} />
          <Tooltip {...tip} formatter={(v: any) => Number(v).toFixed(1)} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {series.map((s, i) => <Line key={s} type="monotone" dataKey={s} name={labels[s] ?? s} stroke={SERIES[i % SERIES.length]} dot={false} strokeWidth={2} />)}
        </LineChart>
      </ResponsiveContainer>
      <div className="text-xs2 text-sub">Source: US Bureau of Labor Statistics, Producer Price Index (series {series.join(', ')}).</div>
    </figure>
  );
}

/** Evidence mix: cited passages by reliability tier and by layer. */
export function EvidenceCharts({ passages }: { passages: Passage[] }) {
  const cited = passages.filter((p) => p.cited);
  const base = cited.length ? cited : passages;
  const count = (k: keyof Passage) => Object.entries(base.reduce((a: Record<string, number>, p) => ((a[String(p[k])] = (a[String(p[k])] ?? 0) + 1), a), {})).map(([name, value]) => ({ name, value }));
  const rel = count('reliability'), layer = count('layer').sort((a, b) => b.value - a.value);
  const primaryPct = Math.round(((rel.find((r) => r.name === 'primary')?.value ?? 0) / Math.max(base.length, 1)) * 100);
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <figure>
        <figcaption className="mb-2 text-sm2 font-semibold">{primaryPct}% of cited passages come from primary sources</figcaption>
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie data={rel} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
              {rel.map((r, i) => <Cell key={r.name} fill={r.name === 'primary' ? SERIES[2] : r.name === 'secondary' ? SERIES[1] : SERIES[i % 6]} />)}
            </Pie>
            <Tooltip {...tip} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
      </figure>
      <figure>
        <figcaption className="mb-2 text-sm2 font-semibold">Cited passages by corpus layer</figcaption>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={layer} layout="vertical" margin={{ left: 8, right: 16 }}>
            <XAxis type="number" allowDecimals={false} stroke={C.sub} fontSize={11} />
            <YAxis type="category" dataKey="name" width={100} stroke={C.sub} fontSize={11} />
            <Tooltip {...tip} />
            <Bar dataKey="value" name="passages" fill={SERIES[0]} radius={4} barSize={14} />
          </BarChart>
        </ResponsiveContainer>
      </figure>
    </div>
  );
}

export { range };
