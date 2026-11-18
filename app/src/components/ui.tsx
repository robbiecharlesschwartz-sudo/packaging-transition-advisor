import { createContext, useContext, type ReactNode } from 'react';
import type { Claim, Status } from '../lib/types';

export const EvidenceCtx = createContext<{ show: (ns: number[], focus?: number, label?: string) => void }>({ show: () => {} });

export function Cites({ ns }: { ns?: number[] }) {
  const { show } = useContext(EvidenceCtx);
  if (!ns?.length) return null;
  return (
    <span className="whitespace-nowrap">
      {ns.map((n) => (
        <button key={n} type="button" className="cite" aria-label={`Show source passage ${n}`} onClick={(e) => { e.stopPropagation(); show(ns, n); }}>
          {n}
        </button>
      ))}
    </span>
  );
}

const STATUS_STYLE: Record<Status, string> = {
  Grounded: 'pill-ok',
  Partial: 'pill-warn',
  'Evidence Gap': 'pill-gap',
};
const STATUS_TIP: Record<Status, string> = {
  Grounded: 'Every claim is supported by a retrieved passage',
  Partial: 'Some claims are supported; unsupported ones were removed or flagged',
  'Evidence Gap': 'Nothing in the corpus supports an answer',
};

export function StatusBadge({ s }: { s?: Status }) {
  if (!s) return null;
  return <span className={`chip gap-1 ${STATUS_STYLE[s]}`} title={STATUS_TIP[s]}><span className="h-1.5 w-1.5 rounded-full bg-current" />{s}</span>;
}

export function ClaimList({ claims }: { claims: Claim[] }) {
  if (!claims.length) return null;
  return (
    <ul className="space-y-1.5">
      {claims.map((c, i) => (
        <li key={i} className="flex gap-2 text-[13.5px] leading-5">
          <span className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full bg-primary" aria-hidden />
          <span>
            {c.text}
            <Cites ns={c.cites} />
            {c.verdict === 'partial' && <span className="ml-1 chip pill-warn" title={c.note}>partial</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Gaps({ gaps, title = 'Not covered by the evidence' }: { gaps: string[]; title?: string }) {
  if (!gaps.length) return null;
  return (
    <div className="mt-3 rounded-[6px] border border-dashed border-line bg-raised/50 p-2.5">
      <div className="label">{title}</div>
      <ul className="list-[square] space-y-0.5 pl-4 text-[12.5px] text-sub">{gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
    </div>
  );
}

export function Removed({ items }: { items?: Claim[] }) {
  if (!items?.length) return null;
  return (
    <details className="mt-3 text-sm2 text-sub">
      <summary className="cursor-pointer select-none">{items.length} claim{items.length > 1 ? 's' : ''} removed by the evidence check</summary>
      <ul className="mt-2 space-y-1 pl-4">
        {items.map((c, i) => <li key={i}><s>{c.text}</s> <span className="italic">— {c.note}</span></li>)}
      </ul>
    </details>
  );
}

export function SourceLine({ ns }: { ns: number[] }) {
  const u = [...new Set(ns)].filter(Boolean).sort((a, b) => a - b);
  if (!u.length) return null;
  return <div className="mt-2 text-xs2 text-sub">Source: <Cites ns={u} /></div>;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}

const PATHS: Record<string, string> = {
  clipboard: 'M9 4h6m-6 0a2 2 0 0 0-2 2v0H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-1a2 2 0 0 0-2-2M9 12h6m-6 4h4',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  search: 'M21 21l-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5M9 13h6M9 17h6',
  calculator: 'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01',
  factory: 'M3 21h18M5 21V10l5 3V10l5 3V6h4v15',
  pen: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4',
  report: 'M4 4h16v16H4zM8 8h8M8 12h8M8 16h5',
  sun: 'M12 3v2M12 19v2M5 5l1.4 1.4M17.6 17.6L19 19M3 12h2M19 12h2M5 19l1.4-1.4M17.6 6.4L19 5M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
  download: 'M12 3v12m0 0l-4-4m4 4l4-4M4 21h16',
  play: 'M8 5v14l11-7z',
  x: 'M6 6l12 12M18 6L6 18',
  chevron: 'M9 6l6 6-6 6',
};

export function Icon({ name, className = 'h-4 w-4' }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name] ?? PATHS.file} />
    </svg>
  );
}
