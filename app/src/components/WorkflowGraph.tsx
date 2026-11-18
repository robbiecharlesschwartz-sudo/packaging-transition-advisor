import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMemo, useState } from 'react';
import { STEPS } from '../../../pipeline/steps';
import type { Step, StepDef } from '../lib/types';
import { StepDetail } from './panels';
import { Icon } from './ui';

type Data = { def: StepDef; step?: Step; active: boolean; count: string };

function countFor(def: StepDef, step?: Step): string {
  const s = step?.summary ?? {};
  switch (def.id) {
    case 'input': return s.workflow ? String(s.workflow).replace(/_/g, ' ') : '';
    case 'plan': return s.sub_queries ? `${s.sub_queries} sub-queries` : '';
    case 'retrieve': return s.searched_chunks ? `searched ${Number(s.searched_chunks).toLocaleString('en-US')} chunks across ${s.documents} docs` : '';
    case 'passages': return s.kept ? `${s.kept} passages kept` : '';
    case 'cost': return s.options ? `${s.options} options · ${s.cited_inputs} cited inputs` : '';
    case 'sourcing': return s.suppliers_matched !== undefined ? `${s.suppliers_matched} suppliers matched` : '';
    case 'write': return s.claims !== undefined ? `${s.claims} claims drafted` : '';
    case 'verify': return s.checked !== undefined ? `${s.removed} claims removed as unsupported` : '';
    case 'report': return s.sections ? `${s.sections} sections · ${s.cited ?? 0} sources cited` : '';
    default: return '';
  }
}

function StepNode({ data, selected }: NodeProps<Node<Data>>) {
  const st = data.step?.status;
  const dot = st === 'done' ? 'bg-primary' : st === 'running' ? 'bg-accent animate-pulse' : st === 'error' ? 'bg-danger' : 'bg-line';
  return (
    <div className={`w-[190px] rounded-xl border bg-surface px-3 py-2 shadow-sm transition-all ${selected ? 'border-primary ring-2 ring-primary/30' : 'border-line'} ${data.active ? '' : 'opacity-40'}`}>
      <Handle type="target" position={Position.Left} className="!bg-line" />
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-soft text-primary"><Icon name={data.def.icon} /></span>
        <span className="text-sm2 font-semibold text-ink">{data.def.label}</span>
        <span className={`ml-auto h-2.5 w-2.5 rounded-full ${dot}`} aria-label={st ?? 'not run'} />
      </div>
      {data.count && <div className="mt-1 text-[11px] leading-4 text-sub">{data.count}</div>}
      <Handle type="source" position={Position.Right} className="!bg-line" />
    </div>
  );
}

const nodeTypes = { step: StepNode };

/** The pipeline as a live node graph, drawn from pipeline/steps.ts and lit by the run's real step logs. */
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
  const nodes: Node<Data>[] = STEPS.map((d) => ({
    id: d.id, type: 'step', position: { x: d.column * 230, y: d.row * 110 },
    data: { def: d as StepDef, step: byId.get(d.id), active: !d.optional || needs[d.optional], count: countFor(d as StepDef, byId.get(d.id)) },
    selected: sel === d.id,
  }));
  const edges: Edge[] = STEPS.flatMap((d) => d.next.map((n) => {
    const target = STEPS.find((x) => x.id === n)!;
    const active = (!d.optional || needs[d.optional]) && (!target.optional || needs[target.optional]);
    const done = byId.get(n)?.status === 'done';
    return { id: `${d.id}-${n}`, source: d.id, target: n, animated: byId.get(n)?.status === 'running', style: { stroke: done ? 'rgb(var(--primary))' : 'rgb(var(--line))', strokeWidth: 2, opacity: active ? 1 : 0.25 } };
  }));
  const def = STEPS.find((s) => s.id === sel) as StepDef;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="card h-[360px] overflow-hidden md:h-[420px]">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.15 }} onNodeClick={(_, n) => setSel(n.id)}
          nodesDraggable={false} nodesConnectable={false} proOptions={{ hideAttribution: true }} minZoom={0.3}>
          <Background color="rgb(var(--line))" gap={18} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <div className="card max-h-[420px] overflow-y-auto p-4"><StepDetail def={def} step={byId.get(sel)} /></div>
    </div>
  );
}
