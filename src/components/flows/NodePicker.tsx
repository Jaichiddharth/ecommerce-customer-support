'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { PaletteItem } from './flow-types';
import { PICKABLE_ITEMS } from './palette-config';
import { NodeCatalogList } from './NodeCatalogList';
import type { PickerRequest } from './builder-context';

const WIDTH = 340;
const HEIGHT = 440;
const MARGIN = 12;

/** Which step types make sense for where the step goes. */
function itemsFor(request: PickerRequest): PaletteItem[] {
  switch (request.kind) {
    case 'start':
      return PICKABLE_ITEMS.filter((i) => i.category === 'triggers');
    case 'append':
      // Triggers can't have anything leading into them
      return PICKABLE_ITEMS.filter((i) => i.category !== 'triggers');
    case 'insert':
      // …and an End step in the middle would cut off the steps after it
      return PICKABLE_ITEMS.filter((i) => i.category !== 'triggers' && i.type !== 'flow_end');
    default:
      return PICKABLE_ITEMS;
  }
}

function titleFor(request: PickerRequest): { title: string; subtitle: string } {
  switch (request.kind) {
    case 'start':
      return { title: 'Choose a trigger', subtitle: 'What should start this automation?' };
    case 'append':
      return {
        title: request.handle === 'true' ? 'Add to the True path' : request.handle === 'false' ? 'Add to the False path' : 'Add the next step',
        subtitle: 'It is connected automatically.',
      };
    case 'insert':
      return { title: 'Insert a step', subtitle: 'It goes between the two connected steps.' };
    default:
      return { title: 'Add a step', subtitle: 'Place it on the canvas, then connect it.' };
  }
}

interface Props {
  request: PickerRequest;
  /** Screen point the picker opens next to. */
  anchor: { x: number; y: number };
  onPick: (type: string) => void;
  onClose: () => void;
}

/** Searchable step chooser that opens next to the "+" (or toolbar button) that was clicked. */
export function NodePicker({ request, anchor, onPick, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.x, top: anchor.y });
  const { title, subtitle } = titleFor(request);

  // Keep the popover on screen: prefer below-right of the anchor, flip when there's no room
  useLayoutEffect(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const h = Math.min(HEIGHT, vh - MARGIN * 2);
    let left = anchor.x + 14;
    let top = anchor.y - 24;
    if (left + WIDTH > vw - MARGIN) left = anchor.x - WIDTH - 14;
    left = Math.max(MARGIN, Math.min(left, vw - WIDTH - MARGIN));
    top = Math.max(MARGIN, Math.min(top, vh - h - MARGIN));
    setPos({ left, top });
  }, [anchor.x, anchor.y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as globalThis.Node)) onClose();
    };
    // Escape inside the search box is handled there (first clears the query, then closes)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !ref.current?.contains(e.target as globalThis.Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={title}
      className="fixed z-50 bg-white rounded-xl border border-slate-200 shadow-2xl flex flex-col overflow-hidden af-pop-in"
      style={{ left: pos.left, top: pos.top, width: WIDTH, maxHeight: `min(${HEIGHT}px, calc(100vh - ${MARGIN * 2}px))` }}
    >
      <div className="px-4 pt-3 pb-2 flex items-start gap-2 shrink-0">
        <div className="flex-1 min-w-0">
          <h3 className="text-[13px] font-semibold text-slate-800">{title}</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100"
          aria-label="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <NodeCatalogList
        items={itemsFor(request)}
        onPick={(item) => onPick(item.type)}
        autoFocus
        onEscape={onClose}
        className="flex-1 px-3 pb-3"
      />
    </div>
  );
}
