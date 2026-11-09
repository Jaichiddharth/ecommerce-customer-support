'use client';

import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AlertTriangle, Pencil, Plus, Square, Trash2 } from 'lucide-react';
import type { AutomationNodeData } from './flow-types';
import { PALETTE_ITEMS, themeOf } from './palette-config';
import { NodeTypeIcon } from './node-icons';
import { nodeSummary } from './node-options';
import { END_SIZE, NODE_HEIGHT, NODE_WIDTH, sourceHandlesOf, type BranchHandle } from './graph-ops';
import { useBuilder } from './builder-context';
import { nodeConfigIssues } from '@/lib/automation/validate';

/** UI-only fields FlowView adds to each node's data before rendering (never saved). */
export interface NodeUiData {
  /** Issues to flag on the card (shown once the user has tried to save/activate). */
  _issues?: string[];
  /** The step open in the properties panel. */
  _active?: boolean;
  /** Outputs with nothing connected yet. */
  _free?: (BranchHandle | null)[];
}

type Props = NodeProps & { data: AutomationNodeData & NodeUiData };

export const BRANCH_META: Record<BranchHandle, { label: string; left: string; color: string; soft: string }> = {
  true: { label: 'True', left: '30%', color: '#16a34a', soft: '#ecfdf3' },
  false: { label: 'False', left: '70%', color: '#dc2626', soft: '#fef2f2' },
};

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

function AddButton({ nodeId, handle, style }: { nodeId: string; handle: string | null; style: React.CSSProperties }) {
  const { openPicker } = useBuilder();
  return (
    <button
      type="button"
      onClick={(e) => {
        stop(e);
        openPicker({ kind: 'append', sourceId: nodeId, handle }, { x: e.clientX, y: e.clientY });
      }}
      onMouseDown={stop}
      className="af-add nodrag nopan absolute -translate-x-1/2 w-5 h-5 rounded-full bg-white border border-slate-400 text-slate-600 flex items-center justify-center hover:border-[#3440a8] hover:text-white hover:bg-[#3440a8] transition-colors"
      style={style}
      title="Add a step here"
      aria-label="Add a step here"
    >
      <Plus className="w-3 h-3" strokeWidth={2.5} />
    </button>
  );
}

/** Edit / delete, shown above the step on hover or while it's selected. */
function NodeToolbar({ id, visible, compact }: { id: string; visible: boolean; compact?: boolean }) {
  const { openNode, deleteNode } = useBuilder();
  return (
    <div
      className={`nodrag absolute -top-8 flex items-center gap-1 transition-opacity duration-150 ${
        compact ? 'left-1/2 -translate-x-1/2' : 'right-0'
      } ${visible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
      onClick={stop}
    >
      {!compact && (
        <button
          type="button"
          onClick={(e) => { stop(e); openNode(id); }}
          className="h-6 px-2 rounded-md bg-white border border-slate-200 flex items-center gap-1 text-[11px] font-medium text-slate-600 hover:text-[#3440a8] hover:border-[#3440a8]/40 shadow-sm transition-colors"
          title="Edit step"
        >
          <Pencil className="w-3 h-3" />
          Edit
        </button>
      )}
      <button
        type="button"
        onClick={(e) => { stop(e); deleteNode(id); }}
        className="w-6 h-6 rounded-md bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-red-600 hover:border-red-200 shadow-sm transition-colors"
        title="Delete step"
        aria-label="Delete step"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

/** End of a path: a small stop marker, like a flowchart terminator. */
function EndNode({ id, data, selected }: Props) {
  const highlighted = selected || data._active;
  const issues = data._issues ?? [];
  return (
    <div className="af-node group relative" style={{ width: END_SIZE, height: END_SIZE }} title={data.label || 'End'}>
      <NodeToolbar id={id} visible={!!highlighted} compact />
      <Handle type="target" position={Position.Top} className="af-handle af-handle-end" style={{ top: -4 }} />
      <div
        className="w-full h-full rounded-full flex items-center justify-center text-white transition-shadow"
        style={{
          backgroundColor: issues.length ? '#dc2626' : '#be123c',
          boxShadow: highlighted ? '0 0 0 3px #fff, 0 0 0 5px #3440a8' : '0 0 0 3px #fff, 0 1px 3px 3px rgba(15,23,42,0.12)',
        }}
      >
        <Square className="w-3 h-3 fill-current" />
      </div>
      <span className="absolute left-full top-1/2 -translate-y-1/2 ml-2 text-[10.5px] font-medium text-slate-400 whitespace-nowrap select-none pointer-events-none">
        End
      </span>
    </div>
  );
}

function StepNode({ id, data, selected }: Props) {
  const theme = themeOf(data.type);
  const issues = data._issues ?? [];
  const needsSetup = nodeConfigIssues(data.type, data).length > 0;
  const summary = nodeSummary(data);
  const isTrigger = data.type.startsWith('trigger_');
  const handles = sourceHandlesOf(data.type);
  const free = new Set(data._free ?? []);
  const highlighted = selected || data._active;
  const hasError = issues.length > 0;

  const borderColor = hasError ? '#f87171' : highlighted ? '#3440a8' : '#d5dae3';
  const shadow = hasError
    ? '0 0 0 3px rgba(248,113,113,0.18)'
    : highlighted
      ? '0 0 0 3px rgba(52,64,168,0.16), 0 6px 16px -6px rgba(15,23,42,0.2)'
      : undefined;

  return (
    <div className="af-node group relative" style={{ width: NODE_WIDTH }}>
      <NodeToolbar id={id} visible={!!highlighted} />

      {!isTrigger && <Handle type="target" position={Position.Top} className="af-handle" style={{ top: -4 }} />}

      <div
        className="flex items-center gap-2.5 px-2.5 rounded-lg bg-white border transition-[box-shadow,border-color] duration-150 shadow-[0_1px_2px_rgba(15,23,42,0.08)] group-hover:shadow-[0_4px_12px_-4px_rgba(15,23,42,0.22)]"
        style={{ height: NODE_HEIGHT, borderColor, boxShadow: shadow }}
      >
        <div
          className={`w-8 h-8 flex items-center justify-center shrink-0 text-white ${isTrigger ? 'rounded-full' : 'rounded-lg'}`}
          style={{ backgroundColor: theme.accent }}
          title={theme.singular}
        >
          <NodeTypeIcon type={data.type} className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[12.5px] font-semibold text-slate-800 truncate leading-tight" title={data.label}>
            {data.label || 'Untitled step'}
          </p>
          {hasError ? (
            <p className="text-[11px] text-red-600 truncate leading-tight mt-0.5" title={issues.join('\n')}>
              {issues[0]}
            </p>
          ) : needsSetup ? (
            <p className="text-[11px] text-amber-700 truncate leading-tight mt-0.5">Needs setup · click to configure</p>
          ) : (
            <p className="text-[11px] text-slate-500 truncate leading-tight mt-0.5" title={summary}>
              {isTrigger ? `Start · ${summary}` : summary || theme.singular}
            </p>
          )}
        </div>
        {hasError && (
          <span
            className="inline-flex items-center gap-0.5 text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 rounded-full px-1.5 py-px shrink-0"
            title={issues.join('\n')}
          >
            <AlertTriangle className="w-3 h-3" />
            {issues.length}
          </span>
        )}
        {!hasError && needsSetup && <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" title="Needs setup" />}
      </div>

      {/* Outputs. Connected True/False paths are labelled on their connector; free ones here. */}
      {handles.map((h) => {
        if (h === null) {
          return (
            <React.Fragment key="out">
              <Handle type="source" position={Position.Bottom} className="af-handle" style={{ bottom: -4 }} />
              {free.has(null) && <AddButton nodeId={id} handle={null} style={{ left: '50%', top: 'calc(100% + 18px)' }} />}
            </React.Fragment>
          );
        }
        const b = BRANCH_META[h];
        return (
          <React.Fragment key={h}>
            <Handle
              type="source"
              id={h}
              position={Position.Bottom}
              className="af-handle"
              style={{ left: b.left, bottom: -4, backgroundColor: b.color }}
            />
            {free.has(h) && (
              <>
                <span
                  className="absolute -translate-x-1/2 text-[10px] font-semibold px-2 py-px rounded border bg-white pointer-events-none select-none"
                  style={{ left: b.left, top: 'calc(100% + 12px)', color: b.color, borderColor: `${b.color}55` }}
                >
                  {b.label}
                </span>
                <AddButton nodeId={id} handle={h} style={{ left: b.left, top: 'calc(100% + 38px)' }} />
              </>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function AutomationNodeView(props: Props) {
  return props.data.type === 'flow_end' ? <EndNode {...props} /> : <StepNode {...props} />;
}

const MemoNode = memo(AutomationNodeView);
MemoNode.displayName = 'AutomationNode';

/** React Flow node types: every step type renders with the same component. */
export const NODE_TYPES = Object.fromEntries(PALETTE_ITEMS.map((i) => [i.type, MemoNode]));
