export const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};
export const NAME_TO_ABBR = Object.fromEntries(Object.entries(STATE_NAMES).map(([k, v]) => [v, k]));

export function usd(x: number | null | undefined, digits?: number): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  const a = Math.abs(x);
  const d = digits ?? (a >= 100 ? 0 : a >= 1 ? 2 : a >= 0.01 ? 3 : 4);
  return `${x < 0 ? '−' : ''}$${a.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

export function range(r: { low: number; high: number } | null | undefined, digits?: number): string {
  if (!r) return '—';
  if (Math.abs(r.low - r.high) < 1e-9) return usd(r.low, digits);
  return `${usd(r.low, digits)} – ${usd(r.high, digits)}`;
}

export function grams(lo: number | null, hi: number | null): string {
  if (lo === null || hi === null) return '—';
  const f = (x: number) => (x >= 100 ? x.toFixed(0) : x.toFixed(1));
  return lo === hi ? `${f(lo)} g` : `${f(lo)}–${f(hi)} g`;
}

export function compact(n: number): string {
  return n.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 });
}

export function dateLabel(d: string | null | undefined): string {
  if (!d) return 'n.d.';
  if (/^\d{4}$/.test(d)) return d;
  const t = new Date(d.length === 7 ? `${d}-01` : d);
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString('en-US', { year: 'numeric', month: 'short', ...(d.length > 7 ? { day: 'numeric' } : {}) });
}

export const PACKAGE_TYPES = ['flexible pouch/film', 'rigid bottle', 'jar', 'tray/clamshell', 'folding carton', 'corrugated box', 'mailer', 'cup/lid', 'can', 'label/sleeve', 'other'];
export const CATEGORIES = ['food & beverage', 'personal care/cosmetics', 'household', 'apparel/e-commerce', 'electronics', 'pharma/health', 'other'];
export const MATERIALS_ENUM = ['PET', 'HDPE', 'LDPE/LLDPE', 'PP', 'PS/EPS', 'PVC', 'multilayer laminate', 'glass', 'aluminum', 'steel', 'paperboard', 'corrugated', 'other'];
export const NEEDS = ['moisture barrier', 'oxygen barrier', 'grease resistance', 'shelf life > 6 months', 'microwavable', 'child-resistant', 'tamper-evident', 'heavy load'];
export const CERTS = ['BPI compostable', 'FSC', 'How2Recycle', 'APR recognition', 'USDA BioPreferred'];
