import plantsData from '../../corpus/structured/supplier_plants.json';
import suppliersData from '../../corpus/structured/suppliers.json';
import { materialByKey } from './catalog';
import centers from './data/state_centers.json';
import type { Alternative, Profile } from './types';

interface Supplier {
  id: string;
  company_name: string;
  inquiry_url: string | null;
  material_tags: string[];
  product_tags: string[];
  certifications: string[];
  scale_tier: string;
  source_doc_ids: string[];
  evidence: { what: string; chunk_id: string; quote: string }[];
  us_plants_listed: number;
}
interface Plant { id: string; supplier_id: string; city: string; state: string; lat: number; lng: number }

const SUPPLIERS = suppliersData as unknown as Supplier[];
const PLANTS = plantsData as unknown as Plant[];
const CENTERS = centers as Record<string, { lat: number; lng: number; name: string }>;

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface SupplierMatch {
  supplier_id: string;
  company_name: string;
  alternative: string;
  material_key: string;
  certifications: string[];
  scale_tier: string;
  nearest: { city: string; state: string; km: number; to_state: string } | null;
  us_plants: number;
  score: number;
  match: string;
  cost_evidence: string;
  inquiry_url: string | null;
  evidence_chunk_ids: string[];
  source_doc_id: string;
}

/** Ranks suppliers from the structured table (never from model memory) for each alternative. */
export function runSourcing(profile: Profile, alternatives: Alternative[]) {
  const sales = (profile.sales_states ?? []).filter((s) => s && s !== 'nationwide' && CENTERS[s]);
  const targetStates = sales.length ? sales : Object.keys(CENTERS);
  const wantCerts = profile.sourcing_preferences?.certifications ?? [];
  const usOnly = !!profile.sourcing_preferences?.us_made;
  const pt = profile.package_type ?? '';
  const byAlt: Record<string, SupplierMatch[]> = {};
  const gaps: string[] = [];
  const usedChunks = new Set<string>();

  for (const alt of alternatives) {
    if (alt.material_key === 'reuse_refill') continue;
    const rows: SupplierMatch[] = [];
    for (const s of SUPPLIERS) {
      if (!s.material_tags.includes(alt.material_key)) continue;
      const plants = PLANTS.filter((p) => p.supplier_id === s.id);
      if (usOnly && !plants.length) continue;
      let nearest: SupplierMatch['nearest'] = null;
      for (const p of plants)
        for (const st of targetStates) {
          const c = CENTERS[st];
          const km = haversineKm(p.lat, p.lng, c.lat, c.lng);
          if (!nearest || km < nearest.km) nearest = { city: p.city, state: p.state, km: Math.round(km), to_state: st };
        }
      const productMatch = s.product_tags.includes(pt);
      const certMatch = wantCerts.length ? wantCerts.filter((c) => s.certifications.includes(c)).length / wantCerts.length : 1;
      const dist = nearest ? 1 - Math.min(nearest.km, 2000) / 2000 : 0;
      const score = 0.4 + 0.15 * (productMatch ? 1 : 0) + 0.2 * certMatch + 0.2 * dist + 0.05 * (s.evidence.length ? 1 : 0);
      const parts = ['material'];
      if (productMatch) parts.push('product type');
      if (wantCerts.length && certMatch === 1) parts.push('certification');
      if (nearest && nearest.km < 500) parts.push('location');
      const strength = score >= 0.8 ? 'Strong' : score >= 0.6 ? 'Good' : 'Partial';
      s.evidence.forEach((e) => usedChunks.add(e.chunk_id));
      rows.push({
        supplier_id: s.id, company_name: s.company_name, alternative: alt.name, material_key: alt.material_key,
        certifications: s.certifications, scale_tier: s.scale_tier, nearest, us_plants: plants.length,
        score: Math.round(score * 100) / 100,
        match: `${strength} match on ${parts.join(', ')}${!plants.length ? ' (no US plant list in filing)' : ''}`,
        cost_evidence: 'price on request (no public catalog price captured)',
        inquiry_url: s.inquiry_url, evidence_chunk_ids: s.evidence.map((e) => e.chunk_id), source_doc_id: s.source_doc_ids[0],
      });
    }
    rows.sort((a, b) => b.score - a.score);
    byAlt[alt.name] = rows.slice(0, 10);
    if (!rows.length) gaps.push(`No supplier in the structured table makes ${materialByKey(alt.material_key)?.label ?? alt.name}; registries (BPI, FSC, USDA BioPreferred) are link-only next steps.`);
    else if (rows.length < 5) gaps.push(`Only ${rows.length} supplier(s) found for ${alt.name}; the table covers large SEC filers only.`);
  }
  const shortlisted = new Set(Object.values(byAlt).flat().map((r) => r.supplier_id));
  const plants = PLANTS.filter((p) => shortlisted.has(p.supplier_id)).map((p) => ({
    supplier_id: p.supplier_id, company: SUPPLIERS.find((s) => s.id === p.supplier_id)?.company_name, city: p.city, state: p.state, lat: p.lat, lng: p.lng,
  }));
  return {
    by_alternative: byAlt,
    plants,
    sales_states: sales,
    rfq_checklist: rfqChecklist(profile, alternatives),
    gaps,
    note: `Supplier list is from public SEC filings as of ${new Date().toISOString().slice(0, 10)}; verify capability and pricing directly.`,
    evidence_chunk_ids: [...usedChunks],
  };
}

function rfqChecklist(p: Profile, alts: Alternative[]): string[] {
  const d = p.dimensions ?? {};
  const dims = [d.l_cm && `${d.l_cm} cm`, d.w_cm && `${d.w_cm} cm`, d.h_cm && `${d.h_cm} cm`].filter(Boolean).join(' x ');
  return [
    `Package: ${p.package_type ?? 'n/a'}${dims ? `, ${dims}` : ''}${d.volume_ml ? `, ${d.volume_ml} ml` : ''}${d.gusset_cm ? `, gusset ${d.gusset_cm} cm` : ''}`,
    `Material options to quote: ${alts.map((a) => a.name).join('; ')}`,
    `Current spec for comparison: ${p.current_material ?? 'n/a'}${p.unit_weight_g ? `, ${p.unit_weight_g} g` : ''}${p.thickness ? `, ${p.thickness.value} ${p.thickness.unit}` : ''}`,
    `Functional requirements: ${(p.functional_needs ?? []).join(', ') || 'state barrier and shelf-life needs'}`,
    `Volumes: ${p.annual_units ? `${p.annual_units.toLocaleString('en-US')} units/year` : 'annual units'}, plus MOQ and price breaks`,
    `Print: colors, coverage, and whether printing affects recyclability claims`,
    `Certifications required: ${(p.sourcing_preferences?.certifications ?? []).join(', ') || 'list any (BPI, FSC, How2Recycle, APR)'}`,
    `Ship-to: ${(p.sales_states ?? []).join(', ') || 'distribution centers'}; lead time and capacity commitment`,
    'Target dates: sampling, line trials, first production',
  ];
}
