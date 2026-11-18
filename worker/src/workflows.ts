import { parse } from 'yaml';
import alternatives from '../../workflows/alternatives_fit.yaml';
import claims from '../../workflows/claims_check.yaml';
import competitor from '../../workflows/competitor_scan.yaml';
import cost from '../../workflows/cost_estimate.yaml';
import eol from '../../workflows/end_of_life_check.yaml';
import free from '../../workflows/free_question.yaml';
import full from '../../workflows/full_transition_brief.yaml';
import market from '../../workflows/market_entry_overview.yaml';
import regulatory from '../../workflows/regulatory_scan.yaml';
import sourcing from '../../workflows/sourcing_search.yaml';
import type { WorkflowDef } from './types';

const RAW: string[] = [full, free, regulatory, alternatives, eol, claims, cost, competitor, sourcing, market];

let cache: Map<string, WorkflowDef> | null = null;

export function workflows(): Map<string, WorkflowDef> {
  if (!cache) {
    cache = new Map();
    for (const text of RAW) {
      const w = parse(text) as WorkflowDef;
      cache.set(w.id, w);
    }
  }
  return cache;
}

export function getWorkflow(id: string): WorkflowDef | undefined {
  return workflows().get(id);
}
