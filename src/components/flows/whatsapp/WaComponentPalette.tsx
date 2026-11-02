'use client';

import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import {
  Heading1, Heading2, AlignLeft, Type, TextCursorInput, FileText, Calendar,
  SquareChevronDown, CircleDot, SquareCheck, ShieldCheck, RectangleHorizontal,
} from 'lucide-react';
import { WA_GROUP_LABELS, WA_PALETTE_ITEMS, type WaPaletteGroup, type WaPaletteItem } from '@/lib/whatsapp-flows/wa-component-registry';
import type { WaComponentType } from '@/lib/whatsapp-flows/wa-flow-types';

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  Heading1, Heading2, AlignLeft, Type, TextCursorInput, FileText, Calendar,
  SquareChevronDown, CircleDot, SquareCheck, ShieldCheck, RectangleHorizontal,
};

export function WaPaletteIcon({ type, className }: { type: WaComponentType; className?: string }) {
  const Icon = ICON_MAP[WA_PALETTE_ITEMS.find((i) => i.type === type)?.icon ?? ''] ?? Type;
  return <Icon className={className} />;
}

export const PALETTE_DRAG_PREFIX = 'palette:';

function PaletteCard({
  item,
  disabledReason,
  onAdd,
}: {
  item: WaPaletteItem;
  disabledReason?: string;
  onAdd: (type: WaComponentType) => void;
}) {
  const disabled = !!disabledReason;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${PALETTE_DRAG_PREFIX}${item.type}`,
    data: { source: 'palette', type: item.type },
    disabled,
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onClick={() => !disabled && onAdd(item.type)}
      title={disabledReason ?? `${item.description} — drag onto the screen or click to add`}
      aria-disabled={disabled}
      className={`flex flex-col items-center justify-center gap-1 p-2 rounded-lg bg-white border border-slate-200 select-none
                  transition-all duration-150 touch-none
                  ${disabled
                    ? 'opacity-40 cursor-not-allowed'
                    : 'cursor-grab active:cursor-grabbing hover:border-slate-300 hover:shadow-sm'}
                  ${isDragging ? 'opacity-50' : ''}`}
    >
      <WaPaletteIcon type={item.type} className="w-4 h-4 text-[#3440a8]" />
      <span className="text-[10px] font-medium text-slate-600 text-center leading-tight line-clamp-2 w-full">
        {item.label}
      </span>
    </button>
  );
}

const GROUP_ORDER: WaPaletteGroup[] = ['text', 'inputs', 'selection', 'actions'];

export function WaComponentPalette({
  disabledReasons,
  onAdd,
}: {
  /** type → reason the component can't be added to the current screen. */
  disabledReasons: Partial<Record<WaComponentType, string>>;
  onAdd: (type: WaComponentType) => void;
}) {
  return (
    <aside
      className="w-48 shrink-0 flex flex-col h-full overflow-hidden"
      style={{ background: '#f4f6fb', borderRight: '1px solid #e2e8f0' }}
    >
      <div className="flex-1 overflow-y-auto px-2.5 pb-3">
        {GROUP_ORDER.map((group) => (
          <div key={group}>
            <div className="w-full flex items-center gap-0 my-2.5 select-none">
              <span className="w-[3px] h-5 rounded-full bg-[#3440a8] shrink-0" />
              <span className="flex-1 h-5 flex items-center justify-center text-[11px] font-semibold text-slate-600 bg-slate-100 border-y border-slate-200">
                {WA_GROUP_LABELS[group]}
              </span>
              <span className="w-[3px] h-5 rounded-full bg-[#3440a8] shrink-0" />
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {WA_PALETTE_ITEMS.filter((i) => i.group === group).map((item) => (
                <PaletteCard key={item.type} item={item} disabledReason={disabledReasons[item.type]} onAdd={onAdd} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="px-2.5 py-2 border-t border-slate-200 shrink-0">
        <p className="text-[9px] text-slate-400 text-center">Drag onto the screen or click to add</p>
      </div>
    </aside>
  );
}
