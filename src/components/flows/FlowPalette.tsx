'use client';

import React, { useState } from 'react';
import {
  MessageCircle, Hash, Bell, GitBranch, Search, UserCheck,
  Send, FileText, UserPlus, PenLine, Clock, Shuffle, StopCircle,
} from 'lucide-react';
import { PALETTE_ITEMS, CATEGORY_META } from './palette-config';
import type { PaletteItem, NodeCategory } from './flow-types';

// ─── Icon registry ────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  MessageCircle, Hash, Bell, GitBranch, Search, UserCheck,
  Send, FileText, UserPlus, PenLine, Clock, Shuffle, StopCircle,
};

function NodeIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICON_MAP[name] ?? MessageCircle;
  return <Icon className={className} />;
}

// ─── Category header ──────────────────────────────────────────────────────────

function CategoryHeader({ label, onToggle }: { label: string; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-0 my-2.5 select-none"
    >
      {/* thin left accent */}
      <span className="w-[3px] h-5 rounded-full bg-[#3440a8] shrink-0" />
      <span className="flex-1 h-5 flex items-center justify-center text-[11px] font-semibold text-slate-600 bg-slate-100 border-y border-slate-200">
        {label}
      </span>
      {/* thin right accent */}
      <span className="w-[3px] h-5 rounded-full bg-[#3440a8] shrink-0" />
    </button>
  );
}

// ─── 2-col grid card ─────────────────────────────────────────────────────────

function PaletteNodeCard({ item }: { item: PaletteItem }) {
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/reactflow-type', item.type);
    e.dataTransfer.setData('application/reactflow-label', item.label);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      title={item.description}
      className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg bg-white border border-slate-200
                 cursor-grab active:cursor-grabbing select-none
                 hover:border-slate-300 hover:shadow-sm
                 transition-all duration-150"
    >
      <div style={{ color: item.textColor }}>
        <NodeIcon name={item.icon} className="w-4 h-4" />
      </div>
      <p className="text-[10px] font-medium text-slate-600 text-center leading-tight line-clamp-2 w-full">
        {item.label}
      </p>
    </div>
  );
}

// ─── Flat search row ─────────────────────────────────────────────────────────

function PaletteSearchCard({ item }: { item: PaletteItem }) {
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/reactflow-type', item.type);
    e.dataTransfer.setData('application/reactflow-label', item.label);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      title={item.description}
      className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-white border border-slate-200
                 cursor-grab active:cursor-grabbing select-none
                 hover:border-slate-300 hover:shadow-sm transition-all duration-150"
    >
      <div
        className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
        style={{ backgroundColor: item.color, color: item.textColor }}
      >
        <NodeIcon name={item.icon} className="w-3.5 h-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-slate-700 truncate">{item.label}</p>
        <p className="text-[10px] text-slate-400 truncate">{item.description}</p>
      </div>
    </div>
  );
}

// ─── Category order ───────────────────────────────────────────────────────────

const CATEGORY_ORDER: NodeCategory[] = ['triggers', 'conditions', 'actions', 'flow-controls'];

// ─── Main palette ─────────────────────────────────────────────────────────────

export function FlowPalette() {
  const [collapsed, setCollapsed] = useState<Set<NodeCategory>>(new Set());
  const [search, setSearch] = useState('');

  const toggle = (cat: NodeCategory) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });

  const filtered = search.trim()
    ? PALETTE_ITEMS.filter(
        (i) =>
          i.label.toLowerCase().includes(search.toLowerCase()) ||
          i.description.toLowerCase().includes(search.toLowerCase()),
      )
    : null;

  return (
    <aside
      className="w-48 shrink-0 flex flex-col h-full overflow-hidden"
      style={{ background: '#f4f6fb', borderRight: '1px solid #e2e8f0' }}
    >
      {/* Search */}
      <div className="px-2.5 pt-3 pb-1.5 shrink-0">
        <input
          type="search"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-2.5 py-1.5 text-[11px] rounded-lg border border-slate-200 bg-white
                     focus:outline-none focus:ring-2 focus:ring-[#3440a8]/20 focus:border-[#3440a8]/40
                     placeholder:text-slate-400 transition-all"
        />
      </div>

      {/* Node list */}
      <div className="flex-1 overflow-y-auto px-2.5 pb-3">
        {filtered ? (
          filtered.length === 0 ? (
            <p className="text-[11px] text-slate-400 text-center py-6">No nodes found</p>
          ) : (
            <div className="space-y-1 pt-1">
              {filtered.map((item) => (
                <PaletteSearchCard key={item.type} item={item} />
              ))}
            </div>
          )
        ) : (
          CATEGORY_ORDER.map((cat) => {
            const meta = CATEGORY_META[cat];
            const items = PALETTE_ITEMS.filter((i) => i.category === cat);
            const isCollapsed = collapsed.has(cat);
            return (
              <div key={cat}>
                <CategoryHeader label={meta.label} onToggle={() => toggle(cat)} />
                {!isCollapsed && (
                  <div className="grid grid-cols-2 gap-1.5">
                    {items.map((item) => (
                      <PaletteNodeCard key={item.type} item={item} />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="px-2.5 py-2 border-t border-slate-200 shrink-0">
        <p className="text-[9px] text-slate-400 text-center">Drag nodes onto the canvas</p>
      </div>
    </aside>
  );
}
