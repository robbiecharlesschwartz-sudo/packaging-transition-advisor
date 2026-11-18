import {
  Background, BackgroundVariant, BaseEdge, Controls, EdgeLabelRenderer, getBezierPath, Handle, Position, ReactFlow,
  type Edge, type EdgeProps, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMemo, useState } from 'react';
import { STEPS } from '../../../pipeline/steps';
import type { Step, StepDef } from '../lib/types';
import { StepDetail } from './panels';
import { Icon } from './ui';

// What each node is, in workflow-builder terms (type line under the node name).
const KIND: Record<string, { type: string; tone: string }> = {
  input: { type: 'Trigger · form / question', tone: 'bg-ok/15 text-ok' },
  plan: { type: 'LLM · Gemini (lite)', tone: 'bg-raised text-ink border border-line' },
  retrieve: { type: 'Vectorize + D1 FTS5 · RRF', tone: 'bg-warn/15 text-warn' },
  passages: { type: 'Code · dedupe + number', tone: 'bg-raised text-sub' },
  cost: { type: 'Code · cited calculator', tone: 'bg-raised text-sub' },
  sourcing: { type: 'Code · suppliers table', tone: 'bg-raised text-sub' },
  write: { type: 'LLM · Gemini', tone: 'bg-raised text-ink border border-line' },
  verify: { type: 'Code + LLM · fact-check', tone: 'bg-raised text-ink border border-line' },
  report: { type: 'Output · cited brief', tone: 'bg-ok/15 text-ok' },
};

type Data = { def: StepDef; step?: Step; active: boolean; count: string; ms: number | null };

function countFor(id: string, s: any = {}): string {
  switch (id) {
    case 'input': return s.workflow ? String(s.workflow).replace(/_/g, ' ') : '';
    case 'plan': return s.sub_queries ? `${s.sub_queries} sub-queries` : '';
    case 'retrieve': return s.searched_chunks ? `${Number(s.searched_chunks).toLocaleString('en-US')} chunks · ${s.documents} docs` : '';
    case 'passages': return s.kept ? `${s.kept} passages kept` : '';
    case 'cost': return s.options ? `${s.options} options · ${s.cited_inputs} cited inputs` : '';
    case 'sourcing': return s.suppliers_matched !== undefined ? `${s.suppliers_matched} suppliers matched` : '';
    case 'write': return s.claims !== undefined ? `${s.claims} claims drafted` : '';
    case 'verify': return s.checked !== undefined ? `${s.supported}/${s.checked} supported · ${s.removed} removed` : '';
    case 'report': return s.sections ? `${s.sections} sections · ${s.cited ?? 0} sources` : '';
    default: return '';
  }
}

/** Label on the edge leaving a node: what actually flowed to the next step. */
function flowLabel(id: string, s: any = {}): string {
  switch (id) {
    case 'input': return s.profile ? 'profile' : 'question';
    case 'plan': return s.sub_queries ? `${s.sub_queries} queries` : '';
    case 'retrieve': return s.candidates ? `${s.candidates} candidates` : '';
    case 'passages': return s.kept ? `${s.kept} passages` : '';
    case 'cost': return s.options ? 'cost table' : '';
    case 'sourcing': return s.suppliers_matched !== undefined ? `${s.suppliers_matched} suppliers` : '';
    case 'write': return s.claims !== undefined ? `${s.claims} claims` : '';
    case 'verify': return s.checked !== undefined ? `${s.checked - s.removed} kept` : '';
    default: return '';
  }
}

function StepNode({ data, selected }: NodeProps<Node<Data>>) {
  const st = data.step?.status;
  const k = KIND[data.def.id];
  const badge = !data.active ? ['skipped', 'pill-gap'] : st === 'done' ? ['success', 'pill-ok'] : st === 'running' ? ['running', 'border-sub text-ink animate-pulse'] : st === 'error' ? ['error', 'border-danger/40 bg-danger/10 text-danger'] : ['waiting', 'pill-gap'];
  const trigger = data.def.id === 'input';
  return (
    <div className={`w-[228px] rounded-[10px] border bg-surface shadow-[0_6px_24px_-12px_rgba(0,0,0,0.6)] transition-all ${selected ? 'border-ink' : st === 'error' ? 'border-danger/60' : 'border-line'} ${data.active ? '' : 'opacity-35'}`}>
      {!trigger && <Handle id="l" type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-surface !bg-sub" />}
      {data.def.id === 'write' && <Handle id="t" type="target" position={Position.Top} className="!h-3 !w-3 !border-2 !border-surface !bg-sub" />}
      <div className="flex items-center gap-2.5 p-2.5">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center ${trigger ? 'rounded-l-full rounded-r-[8px]' : 'rounded-[8px]'} ${k.tone}`}><Icon name={data.def.icon} className="h-[18px] w-[18px]" /></span>
        <div className="min-w-0">
          <div className="truncate text-[12.5px] font-semibold text-ink">{data.def.label}</div>
          <div className="truncate text-[10.5px] text-sub">{k.type}</div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-line px-2.5 py-1.5">
        <span className="truncate text-[10.5px] text-sub">{data.count || '—'}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {data.ms !== null && <span className="text-[10px] tabular-nums text-sub">{data.ms < 1000 ? `${data.ms} ms` : `${(data.ms / 1000).toFixed(1)} s`}</span>}
          <span className={`chip ${badge[1]}`}>{badge[0]}</span>
        </span>
      </div>
      {data.def.id !== 'report' && <Handle id="r" type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-surface !bg-primary" />}
      {['passages', 'cost', 'sourcing'].includes(data.def.id) && <Handle id="b" type="source" position={Position.Bottom} className="!h-3 !w-3 !border-2 !border-surface !bg-primary" />}
    </div>
  );
}

function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, label, data }: EdgeProps) {
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.35 });
  return (
    <>
      <BaseEdge id={id} path={path} style={style} />
      {label && (data as any)?.active ? (
        <EdgeLabelRenderer>
          <div style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }} className="nodrag nopan pointer-events-none absolute rounded-full border border-line bg-raised px-2 py-0.5 text-[10px] font-medium text-sub">
            {label as string}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const nodeTypes = { step: StepNode };
const edgeTypes = { flow: FlowEdge };
// Two rows: retrieval on top, writing and checking below (keeps nodes readable without horizontal scrolling).
const POS: Record<string, [number, number]> = {
  input: [0, 0], plan: [310, 0], retrieve: [620, 0], passages: [930, 0],
  cost: [1240, -105], sourcing: [1240, 105], write: [620, 320], verify: [930, 320], report: [1240, 320],
};

/** The pipeline as an executable-looking workflow, drawn from pipeline/steps.ts and lit by this run's real step logs. */
export function WorkflowGraph({ steps, needs }: { steps: Step[]; needs: { cost: boolean; sourcing: boolean } }) {
  const [sel, setSel] = useState<string>('retrieve');
  const byId = useMemo(() => {
    const m = new Map<string, Step>();
    for (const s of steps) {
      const id = s.step_id.replace(/-\d+$/, '');
      if (!m.has(id) || s.status === 'done') m.set(id, s);
    }
    return m;
  }, [steps]);
  const ms = (s?: Step) => (s?.started_at && s?.ended_at ? Math.max(0, new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) : null);
  const activeOf = (d: (typeof STEPS)[number]) => !d.optional || needs[d.optional];

  const nodes: Node<Data>[] = STEPS.map((d) => ({
    id: d.id, type: 'step', position: { x: POS[d.id][0], y: POS[d.id][1] },
    data: { def: d as StepDef, step: byId.get(d.id), active: activeOf(d), count: countFor(d.id, byId.get(d.id)?.summary), ms: ms(byId.get(d.id)) },
    selected: sel === d.id,
  }));
  const edges: Edge[] = STEPS.flatMap((d) => d.next.map((n) => {
    const target = STEPS.find((x) => x.id === n)!;
    const active = activeOf(d) && activeOf(target);
    const done = byId.get(d.id)?.status === 'done' && !!byId.get(n);
    const down = n === 'write';
    return {
      id: `${d.id}-${n}`, source: d.id, target: n, type: 'flow', sourceHandle: down && d.id !== 'passages' ? 'b' : down ? 'b' : 'r', targetHandle: down ? 't' : 'l', label: flowLabel(d.id, byId.get(d.id)?.summary), data: { active },
      animated: byId.get(n)?.status === 'running',
      style: { stroke: done ? 'rgb(var(--primary))' : 'rgb(var(--line))', strokeWidth: 2, opacity: active ? 1 : 0.2 },
    };
  }));
  const def = STEPS.find((s) => s.id === sel) as StepDef;
  const done = [...byId.values()].filter((s) => s.status === 'done').length;
  const total = STEPS.filter(activeOf).length;
  const starts = steps.map((s) => (s.started_at ? new Date(s.started_at).getTime() : NaN)).filter(Number.isFinite);
  const ends = steps.map((s) => (s.ended_at ? new Date(s.ended_at).getTime() : NaN)).filter(Number.isFinite);
  const totalMs = starts.length && ends.length ? Math.max(...ends) - Math.min(...starts) : 0;

  return (
    <div className="grid gap-3">
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2">
          <span className="flex items-center gap-1.5 text-[12.5px] font-semibold"><span className="h-2 w-2 rounded-full bg-ok" />Execution</span>
          <span className="text-[11px] text-sub">{done}/{total} nodes succeeded{totalMs > 0 ? ` · ${(totalMs / 1000).toFixed(1)} s total` : ''}</span>
          <span className="ml-auto text-[11px] text-sub">Cloudflare Workflows · each node is a durable, logged step · click a node to inspect it</span>
        </div>
        <div className="h-[440px] md:h-[500px]">
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={{ padding: 0.08 }}
            onNodeClick={(_, n) => setSel(n.id)} nodesDraggable nodesConnectable={false} proOptions={{ hideAttribution: true }} minZoom={0.25}
            colorMode="dark">
            <Background variant={BackgroundVariant.Dots} color="rgb(var(--line))" gap={20} size={1.4} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </div>
      <div className="card max-h-[520px] overflow-y-auto p-3"><StepDetail def={def} step={byId.get(sel)} /></div>
    </div>
  );
}
