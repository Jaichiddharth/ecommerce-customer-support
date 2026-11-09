'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Check, Download, Loader2, MoreHorizontal, Pause, Play, Redo2,
  RotateCcw, Save, Undo2, Upload,
} from 'lucide-react';

interface Props {
  name: string;
  onNameChange: (v: string) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
  /** Not saved to the workspace yet. */
  isNew: boolean;
  isActive: boolean;
  isDirty: boolean;
  syncing: boolean;
  issueCount: number;
  issuesOpen: boolean;
  onToggleIssues: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onActivate: () => void;
  /** Why Activate is unavailable (unsaved, unsaved changes, issues); null when it can be used. */
  activateBlockedReason: string | null;
  onPause: () => void;
  onBack: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onDiscard: () => void;
}

const iconBtn =
  'w-8 h-8 inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors disabled:opacity-35 disabled:hover:bg-transparent disabled:cursor-not-allowed';

function StatusBadge({ isNew, isActive }: { isNew: boolean; isActive: boolean }) {
  if (isActive) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5 shrink-0">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
      {isNew ? 'Draft' : 'Inactive'}
    </span>
  );
}

function SaveState({ isDirty, syncing, isNew }: { isDirty: boolean; syncing: boolean; isNew: boolean }) {
  if (syncing) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
        <Loader2 className="w-3 h-3 animate-spin" /> Saving…
      </span>
    );
  }
  if (isDirty || isNew) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-700" role="status">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        {isNew ? 'Not saved yet' : 'Unsaved changes'}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-slate-500" role="status">
      <Check className="w-3 h-3 text-emerald-500" /> All changes saved
    </span>
  );
}

/** Builder toolbar: identity and status on the left, editing tools in the middle, Save / Activate on the right. */
export function BuilderHeader(p: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as globalThis.Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const menuItem = 'w-full flex items-center gap-2 px-3 py-2 text-[12px] text-slate-700 hover:bg-slate-50 text-left disabled:opacity-40 disabled:hover:bg-transparent';

  return (
    <header className="h-14 px-3 bg-white border-b border-slate-200 flex items-center gap-3 shrink-0 z-20">
      {/* Identity */}
      <button
        type="button"
        onClick={p.onBack}
        className={iconBtn}
        title="Back to automations"
        aria-label="Back to automations"
      >
        <ArrowLeft className="w-4 h-4" />
      </button>
      <div className="w-px h-7 bg-slate-200" />
      <div className="min-w-0 flex-1 flex flex-col justify-center">
        <div className="flex items-center gap-2 min-w-0">
          <input
            value={p.name}
            onChange={(e) => p.onNameChange(e.target.value)}
            placeholder="Name this automation"
            aria-label="Automation name"
            className={`min-w-0 w-[min(22rem,100%)] text-[14px] font-semibold text-slate-800 bg-transparent border border-transparent rounded-md px-1.5 py-0.5 -ml-1.5 hover:border-slate-200 focus:border-[#3440a8]/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#3440a8]/15 ${
              p.name.trim() ? '' : 'placeholder:text-red-400'
            }`}
          />
          <StatusBadge isNew={p.isNew} isActive={p.isActive} />
          <span className="hidden md:inline-flex"><SaveState isDirty={p.isDirty} syncing={p.syncing} isNew={p.isNew} /></span>
        </div>
        <input
          value={p.description}
          onChange={(e) => p.onDescriptionChange(e.target.value)}
          placeholder="Add a description…"
          maxLength={500}
          aria-label="Automation description"
          className="hidden lg:block min-w-0 w-[min(32rem,100%)] text-[11.5px] text-slate-500 bg-transparent border border-transparent rounded-md px-1.5 py-0 -ml-1.5 hover:border-slate-200 focus:border-[#3440a8]/40 focus:bg-white focus:outline-none"
        />
      </div>

      {/* Editing tools */}
      <div className="flex items-center gap-0.5">
        <button type="button" className={iconBtn} onClick={p.onUndo} disabled={!p.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
          <Undo2 className="w-4 h-4" />
        </button>
        <button type="button" className={iconBtn} onClick={p.onRedo} disabled={!p.canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
          <Redo2 className="w-4 h-4" />
        </button>
        {p.issueCount > 0 && (
          <button
            type="button"
            onClick={p.onToggleIssues}
            aria-pressed={p.issuesOpen}
            className={`ml-1 inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12px] font-semibold border transition-colors ${
              p.issuesOpen ? 'text-red-700 bg-red-100 border-red-300' : 'text-red-600 bg-red-50 border-red-200 hover:bg-red-100'
            }`}
            title="Show what needs fixing before saving or activating"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            {p.issueCount}<span className="hidden sm:inline"> {p.issueCount === 1 ? 'issue' : 'issues'}</span>
          </button>
        )}
        <div className="relative ml-0.5" ref={menuRef}>
          <button
            type="button"
            className={iconBtn}
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="More actions"
            aria-label="More actions"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {menuOpen && (
            <div role="menu" className="absolute right-0 top-full mt-1 w-52 bg-white border border-slate-200 rounded-xl shadow-xl py-1 z-50 af-pop-in">
              <button role="menuitem" type="button" className={menuItem} onClick={() => { setMenuOpen(false); p.onExport(); }}>
                <Download className="w-3.5 h-3.5 text-slate-400" /> Export as JSON
              </button>
              <button role="menuitem" type="button" className={menuItem} onClick={() => { setMenuOpen(false); fileRef.current?.click(); }}>
                <Upload className="w-3.5 h-3.5 text-slate-400" /> Import from JSON
              </button>
              <div className="h-px bg-slate-100 my-1" />
              <button
                role="menuitem"
                type="button"
                className={menuItem}
                disabled={!p.isDirty}
                onClick={() => {
                  setMenuOpen(false);
                  if (window.confirm('Discard all changes since the last save?')) p.onDiscard();
                }}
              >
                <RotateCcw className="w-3.5 h-3.5 text-slate-400" /> Discard unsaved changes
              </button>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) p.onImport(file);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {/* Primary actions */}
      <div className="flex items-center gap-2 pl-1">
        <button
          type="button"
          onClick={p.onSave}
          disabled={p.syncing}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 transition-colors"
          title="Save (Ctrl+S)"
        >
          <Save className="w-3.5 h-3.5" />
          Save
        </button>
        {p.isActive ? (
          <button
            type="button"
            onClick={p.onPause}
            disabled={p.syncing}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 transition-colors"
            title="Stop running this automation"
          >
            {p.syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pause className="w-3.5 h-3.5" />}
            Deactivate
          </button>
        ) : (
          <button
            type="button"
            onClick={p.onActivate}
            disabled={p.syncing || !!p.activateBlockedReason}
            className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-[12px] font-semibold text-white bg-[#3440a8] hover:bg-[#2a3490] disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors"
            title={p.activateBlockedReason ?? 'Start running this automation'}
          >
            {p.syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Activate
          </button>
        )}
      </div>
    </header>
  );
}
