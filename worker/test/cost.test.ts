import { describe, expect, it } from 'vitest';
import cases from '../../cost/tests/cases.json';
import catalogLive from '../../cost/price_inputs.json';
import { areaCm2, estimate } from '../src/cost/calculator';

const pair = (x: any) => (x == null ? null : [x.low, x.high]);
const close = (a: (number | null)[] | null, b: (number | null)[] | null, tol: number) => {
  if (b === null) return expect(a).toBeNull();
  b.forEach((v, i) => (v === null ? expect(a![i]).toBeNull() : expect(Math.abs((a![i] as number) - v)).toBeLessThanOrEqual(tol)));
};

describe('geometry matches the Python implementation', () => {
  for (const c of (cases as any).geometry) {
    it(`${c.package_type}: ${c.why}`, () => {
      const [a] = areaCm2(c.package_type, c.dims);
      if (c.area === null) expect(a).toBeNull();
      else expect(Math.abs((a as number) - c.area)).toBeLessThan(0.01);
    });
  }
});

describe('calculator matches hand-checked cases', () => {
  for (const c of (cases as any).estimates) {
    it(c.name, () => {
      const res = estimate(c.profile, c.options, (cases as any).catalog, (cases as any).laws, c.ppi);
      const by = Object.fromEntries(res.options.map((o: any) => [o.key, o]));
      for (const [key, exp] of Object.entries<any>(c.expect)) {
        const o = by[key];
        if (exp.weight) close([o.weight_g.low, o.weight_g.high], exp.weight, 1e-3);
        if ('material' in exp) close(pair(o.material_cost), exp.material, 1e-5);
        if (exp.total) close(pair(o.total_per_unit), exp.total, 1e-5);
        if (exp.annual) close(pair(o.annual), exp.annual, 0.5);
        for (const [k, v] of Object.entries<any>(exp)) {
          if (k.startsWith('epr_status_')) expect(o.epr[k.slice(-2)].status).toBe(v);
          else if (k.startsWith('epr_')) close(pair(o.epr[k.slice(-2)]), v, 1e-5);
        }
      }
    });
  }
});

describe('live catalog', () => {
  it('every input and fee is cited to a chunk', () => {
    for (const i of [...(catalogLive as any).inputs, ...(catalogLive as any).epr_fees]) expect(i.chunk_id).toBeTruthy();
  });
});
