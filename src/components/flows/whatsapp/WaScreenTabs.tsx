'use client';

import React, { useState } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Copy, Trash2, Plus, Flag, CheckCircle2 } from 'lucide-react';
import type { WaScreen } from '@/lib/whatsapp-flows/wa-flow-types';
import { footerOf } from '@/lib/whatsapp-flows/wa-flow-json';

interface TabProps {
  screen: WaScreen;
  index: number;
  active: boolean;
  errorCount: number;
  canDelete: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function ScreenTab({ screen, index, active, errorCount, canDelete, onSelect, onRename, onDuplicate, onDelete }: TabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: screen.uid });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(screen.title);
  const terminal = footerOf(screen)?.action === 'complete';

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft !== screen.title) onRename(draft.trim());
    else setDraft(screen.title);
  };

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`group relative shrink-0 flex items-center gap-1.5 pl-2.5 pr-1.5 h-8 rounded-lg border text-[11px] select-none transition-colors
        ${active ? 'bg-white border-[#3440a8]/40 shadow-sm text-slate-800' : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-white'}
        ${isDragging ? 'z-10 opacity-80 shadow-md' : ''}`}
      onClick={onSelect}
      onDoubleClick={() => { setDraft(screen.title); setEditing(true); }}
      {...attributes}
      {...listeners}
    >
      <span className={`w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center ${active ? 'bg-[#3440a8] text-white' : 'bg-slate-200 text-slate-600'}`}>
        {index + 1}
      </span>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') { setDraft(screen.title); setEditing(false); }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="w-28 px-1 py-0.5 text-[11px] rounded border border-[#3440a8]/40 focus:outline-none"
        />
      ) : (
        <span className="font-semibold max-w-[140px] truncate" title="Double-click to rename">{screen.title || screen.id}</span>
      )}
      {terminal && <span title="Submits the flow"><Flag className="w-3 h-3 text-emerald-500" /></span>}
      {errorCount > 0 ? (
        <span className="min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center" title={`${errorCount} error(s)`}>
          {errorCount}
        </span>
      ) : (
        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
      )}
      <span className={`flex items-center ${active ? '' : 'hidden group-hover:flex'}`}>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
          className="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100"
          title="Duplicate screen"
        >
          <Copy className="w-3 h-3" />
        </button>
        {canDelete && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50"
            title="Delete screen"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </span>
    </div>
  );
}

export function WaScreenTabs({
  screens,
  activeUid,
  errorCounts,
  onSelect,
  onAdd,
  onRename,
  onDuplicate,
  onDelete,
  onReorder,
}: {
  screens: WaScreen[];
  activeUid: string;
  errorCounts: Map<string, number>;
  onSelect: (uid: string) => void;
  onAdd: () => void;
  onRename: (uid: string, title: string) => void;
  onDuplicate: (uid: string) => void;
  onDelete: (uid: string) => void;
  onReorder: (fromUid: string, toUid: string) => void;
}) {
  // Own DndContext: screen reordering never interacts with component drag-and-drop.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) onReorder(String(active.id), String(over.id));
  };

  return (
    <div className="h-12 px-3 bg-white border-b border-slate-200 flex items-center gap-2 shrink-0 overflow-x-auto">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={screens.map((s) => s.uid)} strategy={horizontalListSortingStrategy}>
          {screens.map((s, i) => (
            <ScreenTab
              key={s.uid}
              screen={s}
              index={i}
              active={s.uid === activeUid}
              errorCount={errorCounts.get(s.uid) ?? 0}
              canDelete={screens.length > 1}
              onSelect={() => onSelect(s.uid)}
              onRename={(t) => onRename(s.uid, t)}
              onDuplicate={() => onDuplicate(s.uid)}
              onDelete={() => onDelete(s.uid)}
            />
          ))}
        </SortableContext>
      </DndContext>
      <button
        type="button"
        onClick={onAdd}
        className="shrink-0 flex items-center gap-1 h-8 px-2.5 rounded-lg border border-dashed border-slate-300 text-[11px] font-semibold text-slate-500 hover:text-[#3440a8] hover:border-[#3440a8]/50 transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
        Add screen
      </button>
    </div>
  );
}
