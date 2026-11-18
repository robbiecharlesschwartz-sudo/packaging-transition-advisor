// Material keys shared by the planner, the cost calculator and the sourcing search.
// Labels only: every number attached to a key lives in cost/price_inputs.json with a citation.

export interface MaterialDef {
  key: string;
  label: string;
  family: 'plastic_rigid' | 'plastic_flexible' | 'glass' | 'metal' | 'fiber' | 'system';
  tags: string[];
}

export const MATERIALS: MaterialDef[] = [
  { key: 'pet', label: 'PET (virgin)', family: 'plastic_rigid', tags: ['PET'] },
  { key: 'rpet', label: 'Recycled PET (rPET)', family: 'plastic_rigid', tags: ['PET', 'rPET'] },
  { key: 'hdpe', label: 'HDPE', family: 'plastic_rigid', tags: ['HDPE', 'PE'] },
  { key: 'pp_rigid', label: 'PP (rigid)', family: 'plastic_rigid', tags: ['PP'] },
  { key: 'ps_eps', label: 'Expanded polystyrene (EPS) foam', family: 'plastic_rigid', tags: ['PS/EPS'] },
  { key: 'pvc', label: 'PVC', family: 'plastic_rigid', tags: ['PVC'] },
  { key: 'pla_rigid', label: 'PLA (compostable, rigid)', family: 'plastic_rigid', tags: ['PLA', 'compostable', 'bio-based'] },
  { key: 'glass', label: 'Glass', family: 'glass', tags: ['glass'] },
  { key: 'aluminum', label: 'Aluminum', family: 'metal', tags: ['aluminum'] },
  { key: 'steel', label: 'Steel / tinplate', family: 'metal', tags: ['steel'] },
  { key: 'pe_film', label: 'Mono-material PE film (LDPE/LLDPE)', family: 'plastic_flexible', tags: ['LDPE/LLDPE', 'PE'] },
  { key: 'pp_film', label: 'Mono-material PP film', family: 'plastic_flexible', tags: ['PP'] },
  { key: 'multilayer_film', label: 'Multilayer laminate film', family: 'plastic_flexible', tags: ['multilayer laminate'] },
  { key: 'pla_film', label: 'Compostable film (PLA/PHA)', family: 'plastic_flexible', tags: ['PLA', 'PHA', 'compostable'] },
  { key: 'paper_kraft', label: 'Kraft paper', family: 'fiber', tags: ['paper'] },
  { key: 'paper_barrier', label: 'Barrier-coated paper', family: 'fiber', tags: ['paper', 'multilayer laminate'] },
  { key: 'paperboard', label: 'Paperboard', family: 'fiber', tags: ['paperboard'] },
  { key: 'corrugated', label: 'Corrugated board', family: 'fiber', tags: ['corrugated'] },
  { key: 'molded_fiber', label: 'Molded fiber', family: 'fiber', tags: ['molded fiber'] },
  { key: 'reuse_refill', label: 'Reusable / refill system', family: 'system', tags: [] },
];

export const MATERIAL_KEYS = MATERIALS.map((m) => m.key);
export const materialByKey = (k: string) => MATERIALS.find((m) => m.key === k);

const FLEXIBLE = new Set(['flexible pouch/film', 'mailer', 'label/sleeve']);

/** Maps the profile's current_material enum (brief section 3) to a catalog key. */
export function currentMaterialKey(material?: string, packageType?: string): string | null {
  const flex = FLEXIBLE.has(packageType ?? '');
  switch (material) {
    case 'PET': return 'pet';
    case 'HDPE': return 'hdpe';
    case 'LDPE/LLDPE': return 'pe_film';
    case 'PP': return flex ? 'pp_film' : 'pp_rigid';
    case 'PS/EPS': return 'ps_eps';
    case 'PVC': return 'pvc';
    case 'multilayer laminate': return 'multilayer_film';
    case 'glass': return 'glass';
    case 'aluminum': return 'aluminum';
    case 'steel': return 'steel';
    case 'paperboard': return 'paperboard';
    case 'corrugated': return 'corrugated';
    default: return null;
  }
}
