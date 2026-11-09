'use client';

import React, { memo, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import { Plus, X } from 'lucide-react';
import { useBuilder } from './builder-context';
import { EDGE_COLORS, isBranchHandle } from './graph-ops';
import { BRANCH_META } from './AutomationNode';

/** Distance below a step where a split (True/False) or above it where a merge bends. */
const BEND = 22;

/**
 * Connector between two steps, drawn like a flowchart: True/False paths split right under the
 * condition and carry their label; merging paths join just above the step they lead into. Every
 * connector has a "+" to insert a step, and a remove button while selected.
 */
function AutomationEdgeView({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, sourceHandleId, style, markerEnd, selected,
}: EdgeProps) {
  const { openPicker, deleteEdge } = useBuilder();
  const [hover, setHover] = useState(false);
  const branch = isBranchHandle(sourceHandleId) ? sourceHandleId : null;
  const span = targetY - sourceY;
  const downward = span > BEND * 3;

  const centerY = !downward ? undefined : branch ? sourceY + BEND : targetY - BEND;
  const [path] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 8, offset: 16, centerY,
  });

  // Label and "+" sit on the vertical run of the connector
  const pillY = branch && downward ? sourceY + BEND + 20 : null;
  const plusX = branch ? targetX : sourceX;
  const plusY = !downward
    ? (sourceY + targetY) / 2
    : pillY !== null
      ? (pillY + 10 + targetY) / 2
      : (sourceY + targetY - BEND) / 2;

  const active = selected || hover;
  const edgeStyle: React.CSSProperties = {
    ...style,
    strokeWidth: active ? 2.25 : 1.5,
    ...(selected || hover ? { stroke: EDGE_COLORS.selected } : {}),
  };
  const b = branch ? BRANCH_META[branch] : null;
  const hoverProps = { onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false) };

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={edgeStyle} interactionWidth={0} />
      {/* Wide invisible hit area: hover feedback, and clicks bubble to React Flow for selection */}
      <path d={path} fill="none" stroke="transparent" strokeWidth={20} {...hoverProps} />
      <EdgeLabelRenderer>
        {b && pillY !== null && (
          <div
            className="absolute text-[10px] font-semibold px-2 py-px rounded border bg-white select-none pointer-events-none"
            style={{
              transform: `translate(-50%, -50%) translate(${targetX}px, ${pillY}px)`,
              color: b.color,
              borderColor: `${b.color}55`,
            }}
          >
            {b.label}
          </div>
        )}
        <div
          className="nodrag nopan absolute flex items-center gap-1"
          style={{ transform: `translate(-50%, -50%) translate(${plusX}px, ${plusY}px)`, pointerEvents: 'all' }}
          {...hoverProps}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openPicker({ kind: 'insert', edgeId: id }, { x: e.clientX, y: e.clientY });
            }}
            className={`af-add w-5 h-5 rounded-full border flex items-center justify-center transition-all ${
              active
                ? 'bg-[#3440a8] border-[#3440a8] text-white scale-110'
                : 'bg-white border-slate-400 text-slate-600 hover:bg-[#3440a8] hover:border-[#3440a8] hover:text-white'
            }`}
            title="Insert a step here"
            aria-label="Insert a step here"
          >
            <Plus className="w-3 h-3" strokeWidth={2.5} />
          </button>
          {selected && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); deleteEdge(id); }}
              className="absolute left-full ml-1 w-5 h-5 rounded-full bg-white border border-slate-300 text-slate-500 hover:text-red-600 hover:border-red-300 flex items-center justify-center shadow-sm transition-colors"
              title="Remove connection"
              aria-label="Remove connection"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const EDGE_TYPES = { automation: memo(AutomationEdgeView) };
