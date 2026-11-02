'use client';

import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Copy, Trash2, AlertCircle, ArrowRight, Flag, MousePointerClick, X } from 'lucide-react';
import type { WaComponent, WaFlow, WaScreen } from './wa-flow-types';
import { paletteItem } from './wa-component-registry';
import { WaComponentRenderer } from './WaComponentRenderer';

export const SCREEN_DROP_ID = 'screen-drop-zone';

interface ItemProps {
  component: WaComponent;
  selected: boolean;
  errorCount: number;
  showInsertBefore: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  sortable: boolean;
}

function InsertIndicator() {
  return <div className="h-0.5 -my-px rounded-full bg-[#3440a8] shadow-[0_0_0_2px_rgba(52,64,168,0.15)]" />;
}

function CanvasItem({ component, selected, errorCount, showInsertBefore, onSelect, onDuplicate, onDelete, sortable }: ItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: component.uid,
    data: { source: 'canvas' },
    disabled: !sortable,
  });

  return (
    <>
      {showInsertBefore && <InsertIndicator />}
      <div
        ref={setNodeRef}
        style={{ transform: CSS.Translate.toString(transform), transition }}
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
        className={`group relative rounded-lg px-2 py-2 -mx-2 cursor-pointer transition-colors
          ${selected ? 'ring-2 ring-[#3440a8] bg-[#3440a8]/[0.03]' : errorCount ? 'ring-1 ring-red-300 bg-red-50/40' : 'hover:ring-1 hover:ring-slate-300'}
          ${isDragging ? 'opacity-40 z-10' : ''}`}
      >
        {/* Type tag + actions */}
        <div
          className={`absolute -top-2.5 right-1 z-10 items-center gap-0.5 bg-white border border-slate-200 rounded-md shadow-sm px-0.5
            ${selected ? 'flex' : 'hidden group-hover:flex'}`}
        >
          <span className="px-1 text-[9px] font-semibold text-slate-400 uppercase tracking-wide">{paletteItem(component.type).label}</span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
            className="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            title="Duplicate"
          >
            <Copy className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50"
            title="Delete"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>

        {sortable && (
          <button
            type="button"
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            className={`absolute -left-5 top-1/2 -translate-y-1/2 w-5 h-7 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-grab active:cursor-grabbing touch-none
              ${selected ? 'flex' : 'hidden group-hover:flex'}`}
            title="Drag to reorder"
            aria-label="Drag to reorder"
          >
            <GripVertical className="w-4 h-4" />
          </button>
        )}

        {errorCount > 0 && (
          <span className="absolute -top-2 -left-2 z-10 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center" title={`${errorCount} issue(s)`}>
            <AlertCircle className="w-3 h-3" />
          </span>
        )}

        <WaComponentRenderer component={component} />
      </div>
    </>
  );
}

export function WaScreenCanvas({
  flow,
  screen,
  selectedUid,
  componentErrors,
  insertBeforeUid,
  isDraggingFromPalette,
  onSelectComponent,
  onSelectScreen,
  onDuplicate,
  onDelete,
}: {
  flow: WaFlow;
  screen: WaScreen;
  selectedUid: string | null;
  componentErrors: Map<string, number>;
  /** While dragging from the palette: uid to show the insertion line before, or SCREEN_DROP_ID for the end. */
  insertBeforeUid: string | null;
  isDraggingFromPalette: boolean;
  onSelectComponent: (uid: string) => void;
  onSelectScreen: () => void;
  onDuplicate: (uid: string) => void;
  onDelete: (uid: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: SCREEN_DROP_ID });
  const body = screen.components.filter((c) => c.type !== 'footer');
  const footer = screen.components.find((c) => c.type === 'footer');
  const nextScreen = footer?.type === 'footer' && footer.action === 'navigate'
    ? flow.screens.find((s) => s.uid === footer.nextScreenUid)
    : undefined;

  const renderItem = (c: WaComponent, sortable: boolean) => (
    <CanvasItem
      key={c.uid}
      component={c}
      sortable={sortable}
      selected={selectedUid === c.uid}
      errorCount={componentErrors.get(c.uid) ?? 0}
      showInsertBefore={isDraggingFromPalette && insertBeforeUid === c.uid}
      onSelect={() => onSelectComponent(c.uid)}
      onDuplicate={() => onDuplicate(c.uid)}
      onDelete={() => onDelete(c.uid)}
    />
  );

  return (
    <div className="flex-1 overflow-auto bg-[#f8fafc]" onClick={onSelectScreen}>
      <div className="min-h-full flex items-start justify-center py-8 px-4">
        <div className="w-full max-w-[380px]">
          {/* Phone frame */}
          <div className="rounded-[28px] border-[6px] border-slate-800 bg-white shadow-xl overflow-hidden flex flex-col min-h-[560px]">
            {/* Flow header (as rendered by WhatsApp) */}
            <div
              className={`h-12 px-3 flex items-center gap-2 border-b border-slate-100 cursor-pointer ${selectedUid === null ? 'bg-[#3440a8]/[0.04]' : ''}`}
              onClick={(e) => { e.stopPropagation(); onSelectScreen(); }}
              title="Edit screen properties"
            >
              <X className="w-4 h-4 text-slate-500" />
              <span className="flex-1 text-center text-[14px] font-semibold text-slate-800 truncate">{screen.title || 'Untitled screen'}</span>
              <span className="w-4" />
            </div>

            {/* Body */}
            <div
              ref={setNodeRef}
              className={`flex-1 px-7 py-5 space-y-4 transition-colors ${isOver && isDraggingFromPalette ? 'bg-[#3440a8]/[0.03]' : ''}`}
            >
              <SortableContext items={body.map((c) => c.uid)} strategy={verticalListSortingStrategy}>
                {body.map((c) => renderItem(c, true))}
              </SortableContext>

              {isDraggingFromPalette && insertBeforeUid === SCREEN_DROP_ID && <InsertIndicator />}

              {body.length === 0 && (
                <div
                  className={`flex flex-col items-center justify-center text-center gap-2 py-12 rounded-xl border-2 border-dashed transition-colors
                    ${isDraggingFromPalette ? 'border-[#3440a8]/40 bg-[#3440a8]/[0.03]' : 'border-slate-200'}`}
                >
                  <MousePointerClick className="w-6 h-6 text-slate-300" />
                  <p className="text-[12px] font-semibold text-slate-500">This screen is empty</p>
                  <p className="text-[11px] text-slate-400 max-w-[220px]">Drag components from the left panel, or click one to add it here.</p>
                </div>
              )}
            </div>

            {/* Footer — always pinned to the bottom, as in WhatsApp */}
            <div className="px-7 pt-2 pb-4 border-t border-slate-100">
              {footer ? (
                renderItem(footer, false)
              ) : (
                <div className="flex items-center gap-2 text-[11px] text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  Add a Footer button to continue or submit.
                </div>
              )}
              <p className="mt-2 text-[10px] text-center text-slate-400">Managed by the business. Learn more</p>
            </div>
          </div>

          {/* Navigation summary */}
          {footer?.type === 'footer' && (
            <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
              {footer.action === 'complete' ? (
                <><Flag className="w-3.5 h-3.5 text-emerald-500" /> Footer submits the flow ({screen.success ? 'success' : 'unsuccessful'} outcome)</>
              ) : (
                <><ArrowRight className="w-3.5 h-3.5 text-[#3440a8]" /> Footer navigates to <strong className="text-slate-700">{nextScreen?.title || nextScreen?.id || 'no screen selected'}</strong></>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
