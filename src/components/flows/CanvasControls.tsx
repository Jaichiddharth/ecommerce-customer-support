'use client';

import React from 'react';
import { Panel, useReactFlow, useViewport } from '@xyflow/react';
import { Map as MapIcon, Maximize, Minus, Plus } from 'lucide-react';

const btn =
  'w-8 h-8 inline-flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors disabled:opacity-35 disabled:hover:bg-transparent';

/** Zoom out / zoom level / zoom in, Fit to view and the overview map toggle (bottom-left of the canvas). */
export function CanvasControls({ minimap, onToggleMinimap }: { minimap: boolean; onToggleMinimap: () => void }) {
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow();
  const { zoom } = useViewport();

  return (
    <Panel position="bottom-left" className="!m-3">
      <div className="flex items-center bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <button type="button" className={btn} onClick={() => zoomOut({ duration: 200 })} disabled={zoom <= 0.21} title="Zoom out" aria-label="Zoom out">
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => zoomTo(1, { duration: 200 })}
          className="h-8 min-w-[52px] px-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 tabular-nums transition-colors"
          title="Reset to 100%"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" className={btn} onClick={() => zoomIn({ duration: 200 })} disabled={zoom >= 1.99} title="Zoom in" aria-label="Zoom in">
          <Plus className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-5 bg-slate-200" />
        <button
          type="button"
          className={`${btn} w-auto px-2.5 gap-1.5 text-[11px] font-semibold`}
          onClick={() => fitView({ padding: 0.25, duration: 400 })}
          title="Fit the whole automation on screen"
        >
          <Maximize className="w-3.5 h-3.5" />
          Fit
        </button>
        <div className="w-px h-5 bg-slate-200" />
        <button
          type="button"
          className={`${btn} ${minimap ? '!text-[#3440a8] bg-[#3440a8]/[0.07]' : ''}`}
          onClick={onToggleMinimap}
          aria-pressed={minimap}
          title={minimap ? 'Hide overview map' : 'Show overview map'}
          aria-label="Toggle overview map"
        >
          <MapIcon className="w-3.5 h-3.5" />
        </button>
      </div>
    </Panel>
  );
}
