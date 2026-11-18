import { MATERIALS } from './catalog';
import type { NumberedPassage, Profile, SectionDef, WorkflowDef } from './types';

// Section 11 of the brief: these rules go into every system prompt.
export const RULES = `Rules (follow all of them):
- Answer only from the numbered passages provided. If they do not support a claim, do not make it.
- Cite every factual sentence with passage numbers in "cites" (e.g. [3, 7]). A claim with no cites will be deleted. Put numbers only in "cites", never inside "text".
- Prefer primary sources; when sources conflict, state both with their dates.
- Default to US federal and the selected US states. Mention other jurisdictions only if they were selected.
- Never produce a number (price, fee, date, percentage, weight) unless it appears in a cited passage or in the CALCULATOR OUTPUT block.
- Say what is missing. An honest evidence gap is a correct answer.
- Never use ranking language like "best supplier"; never give legal or investment advice.
- Return valid JSON exactly matching the requested shape. No markdown, no commentary.`;

export const KIND_SCHEMAS: Record<SectionDef['kind'], string> = {
  summary: `{"id","takeaway","claims":[{"text","cites":[n]}],"gaps":[]}  (4-6 claims)`,
  narrative: `{"id","takeaway","claims":[{"text","cites":[n]}],"gaps":["..."]}`,
  current: `{"id","takeaway","claims":[{"text","cites":[n]}],"gaps":[]}  (describe the CURRENT package as it is today for THIS product: whether its material is accepted for recycling where it is sold, which fee or ban rules already apply to it, and what its functional role is for this product; 3-5 claims; do not restate the profile itself (it is shown separately) and do not discuss alternatives here)`,
  gaps: `{"id","takeaway","claims":[],"gaps":["what the corpus could not answer"],"data":{"next_questions":["research to-do"],"documents_needed":["document that would answer it"]}}`,
  alternatives: `{"id","takeaway","claims":[{"text","cites"}],"gaps":[],
  "data":{"options":[{"name","material_key","fit":"Strong|Possible|Weak","reasons":[{"text","cites":[n]}],
    "needs":[{"need","rating":"Strong|Possible|Weak|Unknown","note","cites":[n]}]}]}}  (2-4 options; one "needs" row per functional need)`,
  regulatory: `{"id","takeaway","claims":[{"text","cites"}],"gaps":[],
  "data":{"rows":[{"jurisdiction":"US-XX|US|CA|EU|UK","epr_status":"none|enacted|fees_in_effect|unknown",
    "key_dates":[{"date":"YYYY-MM-DD or YYYY","event","cites":[n]}],
    "recycled_content":{"text","cites"},"bans":{"text","cites"},"labeling":{"text","cites"}}]}}  (one row per selected state, then US federal. If no passage states a rule for that state, set "text":"" and "cites":[]; NEVER write filler such as "being developed", "none known" or "no bans" without a passage that says so)`,
  eol: `{"id","takeaway","claims":[{"text","cites"}],"gaps":[],
  "data":{"rows":[{"alternative","location":"state or city","pathway":"curbside recycling|composting|drop-off|deposit",
    "status":"accepted|limited|not_accepted|unknown","note","cites":[n]}]}}  (flag "technically recyclable but not practically recyclable here" in note when true)`,
  claims: `{"id","takeaway","claims":[{"text","cites"}],"gaps":[],
  "data":{"safe":[{"claim":"example on-pack wording","why","cites":[n]}],"risky":[{"claim","why","cites":[n]}]}}`,
  cost: `{"id","takeaway","claims":[{"text","cites"}],"gaps":[]}  (explain the CALCULATOR OUTPUT; do not restate the table; numbers only from it or passages)`,
  sourcing: `{"id","takeaway","claims":[{"text","cites"}],"gaps":[]}  (explain the SUPPLIER SHORTLIST; include the verify-directly note)`,
  competitor: `{"id","takeaway","claims":[{"text","cites"}],"gaps":[],
  "data":{"examples":[{"company","action","year","cites":[n]}]}}`,
};

export function profileText(p: Profile | null, question?: string | null): string {
  const lines: string[] = [];
  if (question) lines.push(`Question: ${question}`);
  if (!p) return lines.join('\n');
  const d = p.dimensions ?? {};
  const dims = [d.l_cm && `L ${d.l_cm} cm`, d.w_cm && `W ${d.w_cm} cm`, d.h_cm && `H ${d.h_cm} cm`,
    d.gusset_cm && `gusset ${d.gusset_cm} cm`, d.volume_ml && `${d.volume_ml} ml`].filter(Boolean).join(', ');
  const add = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return;
    lines.push(`${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
  };
  add('Company', p.company_description);
  add('Product category', p.product_category);
  add('Package type', p.package_type);
  add('Current material', p.current_material);
  add('Dimensions', dims);
  if (p.thickness) add('Wall/film thickness', `${p.thickness.value} ${p.thickness.unit}`);
  add('Unit weight (g)', p.unit_weight_g);
  add('Annual units', p.annual_units);
  add('Components', (p.components ?? []).map((c) => `${c.name}${c.material ? ` (${c.material})` : ''}`));
  add('Sales states', p.sales_states?.length ? p.sales_states : ['nationwide']);
  add('Other markets', p.other_markets);
  add('Functional needs', p.functional_needs);
  add('Candidate alternatives (user forced)', p.candidate_alternatives);
  const sp = p.sourcing_preferences;
  if (sp) add('Sourcing preferences', [sp.us_made && 'US-made only', sp.near_sales_states && 'near sales states',
    ...(sp.certifications ?? []), sp.scale && `scale: ${sp.scale}`].filter(Boolean) as string[]);
  return lines.join('\n');
}

export function plannerPrompt(w: WorkflowDef, profile: Profile | null, question: string | null, hints: Record<string, string>) {
  const searchable = w.sections.filter((s) => s.kind !== 'summary' && s.kind !== 'gaps');
  const system = `You plan searches for a research agent over a library of public documents on sustainable packaging
(laws, agency pages, recycling program lists, open-access papers, SEC filings, price data, news headlines).
Write search queries a keyword + semantic search engine will match well: concrete nouns, material names, state names,
program names. ${RULES.split('\n')[0]}
Return JSON: {"queries":[{"section":"<section id>","query":"..."}], "alternatives":[{"name":"...","material_key":"..."}]}`;
  const user = `${profileText(profile, question)}

Workflow: ${w.name}
Sections to search for (one or two queries each; for a free question write 1-3 queries that cover its parts):
${searchable.map((s) => `- ${s.id} (${s.title}): starting point "${hints[s.id] ?? ''}"`).join('\n')}

${profile ? `Also choose 2-4 sustainable alternatives to evaluate for this package (fewer if the user forced candidates; keep theirs).
Use material_key values from this list only: ${MATERIALS.map((m) => `${m.key} (${m.label})`).join('; ')}.` : 'Return "alternatives": [].'}`;
  return { system, user };
}

export function passageBlock(ps: NumberedPassage[], maxChars = 2600): string {
  return ps
    .map((p) => {
      const body = p.content.length > maxChars ? p.content.slice(0, maxChars) + ' ...' : p.content;
      return `[${p.n}] ${p.title} | ${p.publisher} | ${p.doc_date || 'n.d.'} | ${p.jurisdiction} | ${p.reliability}${p.section ? ' | ' + p.section : ''}\n${body}`;
    })
    .join('\n\n');
}

export function writerPrompt(
  w: WorkflowDef,
  sections: SectionDef[],
  passagesBySection: Record<string, NumberedPassage[]>,
  profile: Profile | null,
  question: string | null,
  extra: { calculator?: string; suppliers?: string; alternatives?: string },
) {
  const system = `${w.system_prompt}\n${RULES}`;
  const blocks = sections
    .map((s) => {
      const ps = passagesBySection[s.id] ?? [];
      return `=== SECTION "${s.id}" (${s.title}) ===
Return shape: ${KIND_SCHEMAS[s.kind]}
Passages for this section:
${ps.length ? passageBlock(ps) : '(no passages were retrieved: return no claims, a takeaway saying the corpus does not cover this, and gaps)'}`;
    })
    .join('\n\n');
  const user = `${profileText(profile, question)}
${extra.alternatives ? `\nAlternatives being evaluated: ${extra.alternatives}` : ''}
${extra.calculator ? `\nCALCULATOR OUTPUT (deterministic code; authoritative for every cost number):\n${extra.calculator}` : ''}
${extra.suppliers ? `\nSUPPLIER SHORTLIST (from the suppliers table, each row cited):\n${extra.suppliers}` : ''}

Write these sections. Cite only passage numbers shown in that section's block.
${blocks}

Return JSON: {"sections":[ ...one object per section above, in order... ]}`;
  return { system, user };
}

export function verifierPrompt(items: { id: number; text: string; passages: string }[]) {
  const system = `You are a strict fact-checker. For each claim, decide whether the quoted passages support it.
"supported": every fact in the claim (including each number, date, place and name) is stated in or directly implied by the passages.
"partial": the main point is supported but a detail (a number, date, scope or qualifier) is not.
"unsupported": the passages do not support the claim, or contradict it.
A TOOL OUTPUT block (cost calculator or supplier table) is deterministic code output: numbers and supplier facts stated there count as supported.
Return JSON: {"verdicts":[{"id":<number>,"verdict":"supported|partial|unsupported","note":"short reason"}]}`;
  const user = items
    .map((i) => `CLAIM ${i.id}: ${i.text}\nPASSAGES:\n${i.passages}`)
    .join('\n\n---\n\n');
  return { system, user };
}

export function summaryPrompt(w: WorkflowDef, profile: Profile | null, question: string | null, digest: string) {
  const system = `${w.system_prompt}\n${RULES}\nYou write the executive summary of a brief from its already-verified sections.`;
  const user = `${profileText(profile, question)}

Verified section claims (each already carries its passage numbers):
${digest}

Write the Summary: 4 to 6 sentences covering the recommended alternatives, the biggest risks and the rough cost
direction (only if the cost section states one). Reuse the passage numbers of the claims you rely on.
${w.sections.some((s) => s.kind === 'summary') ? '' : 'This workflow has no summary section: return "claims": [] and only fill next_questions and documents_needed.'}
Also list the research to-do: questions the evidence left open, and documents that would answer them.
Return JSON: {"id":"summary","takeaway","claims":[{"text","cites":[n]}],"next_questions":["..."],"documents_needed":["..."]}`;
  return { system, user };
}
