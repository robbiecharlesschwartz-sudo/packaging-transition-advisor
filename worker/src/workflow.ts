import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { Env } from './env';

export class BriefWorkflow extends WorkflowEntrypoint<Env, { runId: string }> {
  async run(_event: WorkflowEvent<{ runId: string }>, _step: WorkflowStep) {
    return { ok: true };
  }
}
