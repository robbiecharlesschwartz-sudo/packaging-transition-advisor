// Single source of truth for the pipeline. The Cloudflare Workflow runs these steps
// by id, and the site's node graph is drawn from the same list.

export type StepId =
  | 'input'
  | 'plan'
  | 'retrieve'
  | 'passages'
  | 'cost'
  | 'sourcing'
  | 'write'
  | 'verify'
  | 'report';

export type StepIcon =
  | 'clipboard'
  | 'list'
  | 'search'
  | 'file'
  | 'calculator'
  | 'factory'
  | 'pen'
  | 'shield'
  | 'report';

export interface StepDef {
  id: StepId;
  label: string;
  icon: StepIcon;
  description: string;
  inputs: string[];
  outputs: string[];
  next: StepId[];
  /** Only runs when the workflow needs it (cost or sourcing). */
  optional?: 'cost' | 'sourcing';
  column: number;
  row: number;
}

export const STEPS: StepDef[] = [
  {
    id: 'input',
    label: 'Question & profile',
    icon: 'clipboard',
    description: 'The package profile and/or free question entered by the user.',
    inputs: ['user form'],
    outputs: ['profile', 'question', 'workflow'],
    next: ['plan'],
    column: 0,
    row: 1,
  },
  {
    id: 'plan',
    label: 'Plan sub-queries',
    icon: 'list',
    description:
      'The LLM turns the profile into one search query per brief section, each with metadata filters (layer, jurisdiction).',
    inputs: ['profile', 'question', 'workflow sections'],
    outputs: ['sub-queries', 'candidate alternatives'],
    next: ['retrieve'],
    column: 1,
    row: 1,
  },
  {
    id: 'retrieve',
    label: 'Search corpus',
    icon: 'search',
    description:
      'Each sub-query runs a vector search (Vectorize) and a keyword search (D1 FTS5); results are merged with reciprocal rank fusion.',
    inputs: ['sub-queries', 'filters'],
    outputs: ['ranked chunks per section'],
    next: ['passages'],
    column: 2,
    row: 1,
  },
  {
    id: 'passages',
    label: 'Passages found',
    icon: 'file',
    description:
      'Deduplicate, cap chunks per document, number each passage [n] so every sentence can cite it.',
    inputs: ['ranked chunks'],
    outputs: ['numbered passages'],
    next: ['cost', 'sourcing', 'write'],
    column: 3,
    row: 1,
  },
  {
    id: 'cost',
    label: 'Cost calculator',
    icon: 'calculator',
    description:
      'Deterministic code: weight from geometry x thickness x density, cited $/kg ranges adjusted by BLS PPI, EPR fees by state. The LLM never produces these numbers.',
    inputs: ['profile', 'alternatives', 'cited price inputs'],
    outputs: ['cost range table'],
    next: ['write'],
    optional: 'cost',
    column: 4,
    row: 0,
  },
  {
    id: 'sourcing',
    label: 'Sourcing search',
    icon: 'factory',
    description:
      'Filters the suppliers table by material, certification and plant location; ranks by match and distance to sales states.',
    inputs: ['alternatives', 'sourcing preferences', 'sales states'],
    outputs: ['supplier shortlist', 'plant map'],
    next: ['write'],
    optional: 'sourcing',
    column: 4,
    row: 2,
  },
  {
    id: 'write',
    label: 'Write cited brief',
    icon: 'pen',
    description:
      'The LLM writes each section only from its numbered passages, returning JSON with [n] citations.',
    inputs: ['numbered passages', 'calculator output', 'supplier shortlist'],
    outputs: ['draft sections'],
    next: ['verify'],
    column: 5,
    row: 1,
  },
  {
    id: 'verify',
    label: 'Verify evidence',
    icon: 'shield',
    description:
      'A second pass checks every claim against its cited passage (plus a number check in code) and labels sections Grounded / Partial / Evidence Gap. Unsupported claims are removed.',
    inputs: ['draft sections', 'cited passages'],
    outputs: ['verdicts', 'status labels'],
    next: ['report'],
    column: 6,
    row: 1,
  },
  {
    id: 'report',
    label: 'Report',
    icon: 'report',
    description: 'The final brief, every sentence linked to the passages that support it.',
    inputs: ['verified sections'],
    outputs: ['brief', 'sources list'],
    next: [],
    column: 7,
    row: 1,
  },
];

export function stepsFor(needs: { cost?: boolean; sourcing?: boolean }): StepDef[] {
  return STEPS.filter((s) => !s.optional || needs[s.optional]);
}
