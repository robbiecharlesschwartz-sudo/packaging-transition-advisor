import { useState } from 'react';
import snack from '../../../eval/profiles/snack_pouch.json';
import cosmetics from '../../../eval/profiles/cosmetics_bottle.json';
import mailer from '../../../eval/profiles/ecommerce_mailer.json';
import { CATEGORIES, CERTS, MATERIALS_ENUM, NEEDS, PACKAGE_TYPES, STATE_NAMES } from '../lib/format';
import type { Meta, Profile } from '../lib/types';

const PRESETS: Record<string, Profile> = { 'Snack pouch': snack as Profile, 'Cosmetics bottle': cosmetics as Profile, 'E-commerce mailer': mailer as Profile };

function Multi({ options, value, onChange, labels }: { options: string[]; value: string[]; onChange: (v: string[]) => void; labels?: Record<string, string> }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button key={o} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            className={`rounded-[4px] border px-1.5 py-0.5 text-[11px] ${on ? 'border-primary bg-primary text-white' : 'border-line bg-raised text-ink hover:border-sub'}`}>
            {labels?.[o] ?? o}
          </button>
        );
      })}
    </div>
  );
}

const num = (v: string) => (v === '' ? undefined : Number(v));

export function ProfileForm({ meta, busy, onRun }: { meta: Meta | null; busy: boolean; onRun: (workflow: string, profile: Profile | null, question: string | null) => void }) {
  const [workflow, setWorkflow] = useState('full_transition_brief');
  const [question, setQuestion] = useState('');
  const [p, setP] = useState<Profile>(snack as Profile);
  const set = (patch: Partial<Profile>) => setP((x) => ({ ...x, ...patch }));
  const dims = p.dimensions ?? {};
  const isFree = workflow === 'free_question';
  const wf = meta?.workflows.find((w) => w.id === workflow);
  const states = p.sales_states ?? [];
  const nationwide = !states.length || states.includes('nationwide');

  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onRun(workflow, isFree ? null : p, question.trim() || null); }}>
      <div>
        <label className="label" htmlFor="wf">Workflow</label>
        <select id="wf" className="field" value={workflow} onChange={(e) => setWorkflow(e.target.value)}>
          {(meta?.workflows ?? [{ id: 'full_transition_brief', name: 'Full transition brief' }, { id: 'free_question', name: 'Free question' }]).map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        {wf && <p className="mt-1 text-xs2 text-sub">{wf.description}</p>}
      </div>

      <div>
        <label className="label" htmlFor="q">{isFree ? 'Your question' : 'Optional question'}</label>
        <textarea id="q" className="field min-h-[72px]" placeholder={isFree ? 'e.g. Is PLA compostable in New York City\'s program?' : 'Anything specific the brief should address'} value={question} onChange={(e) => setQuestion(e.target.value)} />
      </div>

      {!isFree && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="label mb-0">Load example</span>
            {Object.keys(PRESETS).map((k) => <button key={k} type="button" className="btn-ghost px-2 py-1 text-xs2" onClick={() => setP(PRESETS[k])}>{k}</button>)}
          </div>
          <div>
            <label className="label" htmlFor="co">Company description</label>
            <textarea id="co" className="field min-h-[60px]" value={p.company_description ?? ''} onChange={(e) => set({ company_description: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="cat">Product category</label>
              <select id="cat" className="field" value={p.product_category ?? ''} onChange={(e) => set({ product_category: e.target.value })}><option value="">—</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
            </div>
            <div>
              <label className="label" htmlFor="pt">Package type *</label>
              <select id="pt" className="field" required value={p.package_type ?? ''} onChange={(e) => set({ package_type: e.target.value })}><option value="">—</option>{PACKAGE_TYPES.map((c) => <option key={c}>{c}</option>)}</select>
            </div>
            <div>
              <label className="label" htmlFor="mat">Current material</label>
              <select id="mat" className="field" value={p.current_material ?? ''} onChange={(e) => set({ current_material: e.target.value })}><option value="">—</option>{MATERIALS_ENUM.map((c) => <option key={c}>{c}</option>)}</select>
            </div>
            <div>
              <label className="label" htmlFor="w">Unit weight (g)</label>
              <input id="w" type="number" min={0} step="any" className="field" value={p.unit_weight_g ?? ''} onChange={(e) => set({ unit_weight_g: num(e.target.value) })} />
            </div>
          </div>
          <div>
            <span className="label">Dimensions (height L × width W × depth H cm, or volume)</span>
            <div className="grid grid-cols-5 gap-2">
              {(['l_cm', 'w_cm', 'h_cm', 'gusset_cm', 'volume_ml'] as const).map((k) => (
                <input key={k} aria-label={k} placeholder={{ l_cm: 'L', w_cm: 'W', h_cm: 'H', gusset_cm: 'gusset', volume_ml: 'ml' }[k]} type="number" min={0} step="any" className="field px-2"
                  value={dims[k] ?? ''} onChange={(e) => set({ dimensions: { ...dims, [k]: num(e.target.value) } })} />
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="th">Wall / film thickness</label>
              <div className="flex gap-1">
                <input id="th" type="number" min={0} step="any" className="field" value={p.thickness?.value ?? ''} onChange={(e) => set({ thickness: e.target.value ? { value: Number(e.target.value), unit: p.thickness?.unit ?? 'micron' } : undefined })} />
                <select aria-label="thickness unit" className="field w-24" value={p.thickness?.unit ?? 'micron'} onChange={(e) => p.thickness && set({ thickness: { ...p.thickness, unit: e.target.value as any } })}><option value="micron">µm</option><option value="mm">mm</option></select>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="u">Annual units</label>
              <input id="u" type="number" min={0} className="field" value={p.annual_units ?? ''} onChange={(e) => set({ annual_units: num(e.target.value) })} />
            </div>
          </div>
          <div>
            <span className="label">Sales states</span>
            <label className="mb-2 flex items-center gap-2 text-sm2"><input type="checkbox" checked={nationwide} onChange={(e) => set({ sales_states: e.target.checked ? ['nationwide'] : [] })} /> Nationwide</label>
            {!nationwide || states.length === 0 ? null : null}
            <Multi options={Object.keys(STATE_NAMES)} value={states.filter((s) => s !== 'nationwide')} onChange={(v) => set({ sales_states: v })} />
          </div>
          <div>
            <span className="label">Other markets (optional)</span>
            <Multi options={['CA', 'EU', 'UK']} labels={{ CA: 'Canada', EU: 'EU', UK: 'UK' }} value={p.other_markets ?? []} onChange={(v) => set({ other_markets: v })} />
          </div>
          <div>
            <span className="label">Functional needs</span>
            <Multi options={NEEDS} value={p.functional_needs ?? []} onChange={(v) => set({ functional_needs: v })} />
          </div>
          <div>
            <span className="label">Force candidate alternatives (optional)</span>
            <Multi options={(meta?.materials ?? []).map((m) => m.key)} labels={Object.fromEntries((meta?.materials ?? []).map((m) => [m.key, m.label]))} value={p.candidate_alternatives ?? []} onChange={(v) => set({ candidate_alternatives: v })} />
          </div>
          <div>
            <span className="label">Sourcing preferences</span>
            <div className="mb-2 flex flex-wrap gap-4 text-sm2">
              <label className="flex items-center gap-2"><input type="checkbox" checked={!!p.sourcing_preferences?.us_made} onChange={(e) => set({ sourcing_preferences: { ...p.sourcing_preferences, us_made: e.target.checked } })} /> US plants only</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={!!p.sourcing_preferences?.near_sales_states} onChange={(e) => set({ sourcing_preferences: { ...p.sourcing_preferences, near_sales_states: e.target.checked } })} /> Near sales states</label>
              <select aria-label="scale" className="field w-28 py-1" value={p.sourcing_preferences?.scale ?? ''} onChange={(e) => set({ sourcing_preferences: { ...p.sourcing_preferences, scale: (e.target.value || undefined) as any } })}><option value="">any scale</option><option value="small">small</option><option value="mid">mid</option><option value="large">large</option></select>
            </div>
            <Multi options={CERTS} value={p.sourcing_preferences?.certifications ?? []} onChange={(v) => set({ sourcing_preferences: { ...p.sourcing_preferences, certifications: v } })} />
          </div>
        </>
      )}
      <button type="submit" className="btn-primary w-full" disabled={busy || (isFree && !question.trim()) || (!isFree && !p.package_type)}>
        {busy ? 'Running…' : 'Run'}
      </button>
      <p className="text-xs2 text-sub">Live runs use the free LLM quota (limited per day). Replay mode shows complete example runs instantly.</p>
    </form>
  );
}
