'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import {
  Save, Download, Copy, Eye, PencilRuler, Braces, Plus, Trash2, AlertTriangle,
  CheckCircle2, ChevronUp, ChevronDown, Sparkles, FilePlus2, MessageSquareText,
} from 'lucide-react';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { EmptyState, LoadingState } from '@/components/ui/states';

import type { WaComponent, WaComponentType, WaFlow, WaScreen } from './wa-flow-types';
import {
  LIMITS,
  allFieldNames,
  cloneComponent,
  createBlankFlow,
  createComponent,
  createSampleFlow,
  createScreen,
  normalizeOrder,
  paletteItem,
  toScreenId,
  uid,
  uniqueName,
} from './wa-component-registry';
import { buildFlowJson } from './wa-flow-json';
import { validateFlow, validateMetaJson } from './wa-flow-validation';
import { deleteFlow, loadFlows, saveFlow } from './wa-flow-storage';
import { WaComponentPalette, WaPaletteIcon } from './WaComponentPalette';
import { WaScreenTabs } from './WaScreenTabs';
import { WaScreenCanvas, SCREEN_DROP_ID } from './WaScreenCanvas';
import { WaPropertiesPanel } from './WaPropertiesPanel';
import { WaFlowPreview } from './WaFlowPreview';
import { WaComponentRenderer } from './WaComponentRenderer';

type Mode = 'edit' | 'preview' | 'json';

type ActiveDrag =
  | { source: 'palette'; type: WaComponentType }
  | { source: 'canvas'; uid: string };

/** Comparable snapshot for dirty tracking (ignores the save timestamp). */
const snapshot = (f: WaFlow | null) => (f ? JSON.stringify({ ...f, updatedAt: '' }) : '');

const fileSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'whatsapp-flow';

// ─── Collision detection ─────────────────────────────────────────────────────
// Palette drags only drop where the pointer actually is (preferring a specific
// component over the screen body); canvas reorders snap to the closest component.
const collisionDetection: CollisionDetection = (args) => {
  if (args.active.data.current?.source === 'palette') {
    const hits = pointerWithin(args);
    const item = hits.find((h) => h.id !== SCREEN_DROP_ID);
    return item ? [item] : hits;
  }
  return closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter((c) => c.id !== SCREEN_DROP_ID),
  });
};

export default function WhatsAppFlowBuilder() {
  const [savedFlows, setSavedFlows] = useState<WaFlow[] | null>(null);
  const [flow, setFlow] = useState<WaFlow | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [activeScreenUid, setActiveScreenUid] = useState('');
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('edit');
  const [showIssues, setShowIssues] = useState(false);
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const [insertBeforeUid, setInsertBeforeUid] = useState<string | null>(null);

  // ── Load saved flows (client-only storage) ─────────────────────────────
  const openFlow = useCallback((f: WaFlow, persisted: boolean) => {
    setFlow(f);
    setSavedSnapshot(persisted ? snapshot(f) : '');
    setActiveScreenUid(f.screens[0]?.uid ?? '');
    setSelectedUid(null);
    setMode('edit');
  }, []);

  useEffect(() => {
    const flows = loadFlows();
    setSavedFlows(flows);
    const latest = [...flows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (latest) openFlow(latest, true);
  }, [openFlow]);

  // ── Derived state ──────────────────────────────────────────────────────
  const issues = useMemo(() => (flow ? validateFlow(flow) : []), [flow]);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const metaJson = useMemo(() => (flow ? buildFlowJson(flow) : null), [flow]);
  const isDirty = !!flow && snapshot(flow) !== savedSnapshot;

  const screen = flow?.screens.find((s) => s.uid === activeScreenUid) ?? flow?.screens[0];
  const selected = screen?.components.find((c) => c.uid === selectedUid) ?? null;

  const screenErrorCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of errors) if (i.screenUid) m.set(i.screenUid, (m.get(i.screenUid) ?? 0) + 1);
    return m;
  }, [errors]);
  const componentErrorCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of errors) if (i.componentUid) m.set(i.componentUid, (m.get(i.componentUid) ?? 0) + 1);
    return m;
  }, [errors]);

  const disabledReasons = useMemo(() => {
    const r: Partial<Record<WaComponentType, string>> = {};
    if (!screen) return r;
    if (screen.components.length >= LIMITS.componentsPerScreen) {
      for (const t of ['heading', 'subheading', 'body', 'caption', 'text_input', 'text_area', 'dropdown', 'radio', 'checkbox', 'date', 'opt_in', 'footer'] as WaComponentType[]) {
        r[t] = `A screen can have at most ${LIMITS.componentsPerScreen} components`;
      }
    }
    if (screen.components.some((c) => c.type === 'footer')) r.footer = 'This screen already has a Footer';
    if (screen.components.filter((c) => c.type === 'opt_in').length >= LIMITS.optInsPerScreen) {
      r.opt_in = `At most ${LIMITS.optInsPerScreen} Opt-ins per screen`;
    }
    return r;
  }, [screen]);

  // ── Mutation helpers ───────────────────────────────────────────────────
  const updateFlow = useCallback((fn: (f: WaFlow) => WaFlow) => {
    setFlow((f) => (f ? fn(f) : f));
  }, []);

  const updateScreens = useCallback(
    (fn: (screens: WaScreen[]) => WaScreen[]) => updateFlow((f) => ({ ...f, screens: fn(f.screens) })),
    [updateFlow],
  );

  const updateActiveComponents = useCallback(
    (fn: (components: WaComponent[], flow: WaFlow) => WaComponent[]) =>
      updateFlow((f) => ({
        ...f,
        screens: f.screens.map((s) => (s.uid === screen?.uid ? { ...s, components: normalizeOrder(fn(s.components, f)) } : s)),
      })),
    [updateFlow, screen?.uid],
  );

  // ── Component operations ───────────────────────────────────────────────
  const addComponent = useCallback(
    (type: WaComponentType, beforeUid?: string | null) => {
      if (!flow || !screen || disabledReasons[type]) return;
      const c = createComponent(type, allFieldNames(flow));
      updateActiveComponents((list) => {
        const idx = beforeUid ? list.findIndex((x) => x.uid === beforeUid) : -1;
        return idx >= 0 ? [...list.slice(0, idx), c, ...list.slice(idx)] : [...list, c];
      });
      setSelectedUid(c.uid);
    },
    [flow, screen, disabledReasons, updateActiveComponents],
  );

  const duplicateComponent = useCallback(
    (cUid: string) => {
      if (!flow || !screen) return;
      const src = screen.components.find((c) => c.uid === cUid);
      if (!src || disabledReasons[src.type]) {
        if (src) gooeyToast.info(`Can't duplicate ${paletteItem(src.type).label}`, { description: disabledReasons[src.type] });
        return;
      }
      const copy = cloneComponent(src, allFieldNames(flow));
      updateActiveComponents((list) => {
        const idx = list.findIndex((c) => c.uid === cUid);
        return [...list.slice(0, idx + 1), copy, ...list.slice(idx + 1)];
      });
      setSelectedUid(copy.uid);
    },
    [flow, screen, disabledReasons, updateActiveComponents],
  );

  const deleteComponent = useCallback(
    (cUid: string) => {
      updateActiveComponents((list) => list.filter((c) => c.uid !== cUid));
      setSelectedUid((s) => (s === cUid ? null : s));
    },
    [updateActiveComponents],
  );

  const updateComponent = useCallback(
    (cUid: string, patch: Partial<WaComponent>) =>
      updateActiveComponents((list) => list.map((c) => (c.uid === cUid ? ({ ...c, ...patch } as WaComponent) : c))),
    [updateActiveComponents],
  );

  // ── Screen operations ──────────────────────────────────────────────────
  const addScreen = useCallback(() => {
    if (!flow) return;
    const s = createScreen(flow.screens, `Screen ${flow.screens.length + 1}`);
    const head = s.components[0];
    if (head.type === 'heading') head.text = s.title;
    updateScreens((list) => [...list, s]);
    setActiveScreenUid(s.uid);
    setSelectedUid(null);
  }, [flow, updateScreens]);

  const renameScreen = useCallback(
    (sUid: string, title: string) =>
      updateScreens((list) =>
        list.map((s) => {
          if (s.uid !== sUid) return s;
          // Keep the id in step with the title until the user customises it.
          const idFollowsTitle = s.id === toScreenId(s.title);
          const id = idFollowsTitle
            ? uniqueName(toScreenId(title), [...list.filter((x) => x.uid !== sUid).map((x) => x.id), 'SUCCESS'])
            : s.id;
          return { ...s, title, id };
        }),
      ),
    [updateScreens],
  );

  const duplicateScreen = useCallback(
    (sUid: string) => {
      if (!flow) return;
      const src = flow.screens.find((s) => s.uid === sUid);
      if (!src) return;
      const taken = allFieldNames(flow);
      const components = src.components.map((c) => {
        const copy = cloneComponent(c, taken);
        if ('name' in copy) taken.push(copy.name);
        return copy;
      });
      const title = `${src.title} copy`;
      const copy: WaScreen = {
        ...src,
        uid: uid('s'),
        title,
        id: uniqueName(toScreenId(`${src.id}_COPY`), [...flow.screens.map((s) => s.id), 'SUCCESS']),
        components,
      };
      updateScreens((list) => {
        const idx = list.findIndex((s) => s.uid === sUid);
        return [...list.slice(0, idx + 1), copy, ...list.slice(idx + 1)];
      });
      setActiveScreenUid(copy.uid);
      setSelectedUid(null);
    },
    [flow, updateScreens],
  );

  const deleteScreen = useCallback(
    (sUid: string) => {
      if (!flow || flow.screens.length <= 1) return;
      const target = flow.screens.find((s) => s.uid === sUid);
      if (!target || !window.confirm(`Delete screen "${target.title || target.id}"? Footers that navigate to it will need a new target.`)) return;
      const idx = flow.screens.findIndex((s) => s.uid === sUid);
      updateScreens((list) =>
        list
          .filter((s) => s.uid !== sUid)
          .map((s) => ({
            ...s,
            components: s.components.map((c) =>
              c.type === 'footer' && c.nextScreenUid === sUid ? { ...c, nextScreenUid: undefined } : c,
            ),
          })),
      );
      if (activeScreenUid === sUid) {
        const remaining = flow.screens.filter((s) => s.uid !== sUid);
        setActiveScreenUid(remaining[Math.max(0, idx - 1)].uid);
        setSelectedUid(null);
      }
    },
    [flow, activeScreenUid, updateScreens],
  );

  const reorderScreens = useCallback(
    (from: string, to: string) =>
      updateScreens((list) => arrayMove(list, list.findIndex((s) => s.uid === from), list.findIndex((s) => s.uid === to))),
    [updateScreens],
  );

  // ── Flow operations ────────────────────────────────────────────────────
  const confirmDiscard = useCallback(
    () => !isDirty || window.confirm('You have unsaved changes. Discard them?'),
    [isDirty],
  );

  const onSave = useCallback(() => {
    if (!flow) return;
    try {
      const saved = saveFlow(flow);
      setFlow(saved);
      setSavedSnapshot(snapshot(saved));
      setSavedFlows(loadFlows());
      if (errors.length) {
        gooeyToast.warning('Draft saved', { description: `${errors.length} validation error(s) must be fixed before export.` });
      } else {
        gooeyToast.success('Flow saved');
      }
    } catch {
      gooeyToast.error("Couldn't save flow", { description: 'Browser storage is unavailable or full.' });
    }
  }, [flow, errors.length]);

  const onNewFlow = useCallback(
    (sample: boolean) => {
      if (!confirmDiscard()) return;
      openFlow(sample ? createSampleFlow() : createBlankFlow(), false);
    },
    [confirmDiscard, openFlow],
  );

  const onSwitchFlow = useCallback(
    (id: string) => {
      const f = savedFlows?.find((x) => x.id === id);
      if (f && confirmDiscard()) openFlow(f, true);
    },
    [savedFlows, confirmDiscard, openFlow],
  );

  const onDeleteFlow = useCallback(() => {
    if (!flow || !window.confirm(`Delete flow "${flow.name}"? This cannot be undone.`)) return;
    try {
      deleteFlow(flow.id);
    } catch { /* storage unavailable — nothing persisted to remove */ }
    const remaining = loadFlows();
    setSavedFlows(remaining);
    const next = [...remaining].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (next) openFlow(next, true);
    else { setFlow(null); setSavedSnapshot(''); }
    gooeyToast.success('Flow deleted');
  }, [flow, openFlow]);

  /** Export is the publication gate: editor validation and a structural check on the generated JSON must both pass. */
  const exportGate = useCallback((): string | null => {
    if (!metaJson) return null;
    if (errors.length) {
      setShowIssues(true);
      gooeyToast.error('Fix validation errors first', { description: `${errors.length} error(s) block export.` });
      return null;
    }
    const structural = validateMetaJson(metaJson);
    if (structural.length) {
      gooeyToast.error('Generated JSON is invalid', { description: structural[0] });
      return null;
    }
    return JSON.stringify(metaJson, null, 2);
  }, [metaJson, errors.length]);

  const onExport = useCallback(() => {
    const json = exportGate();
    if (!json || !flow) return;
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileSlug(flow.name)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [exportGate, flow]);

  const onCopy = useCallback(async () => {
    const json = exportGate();
    if (!json) return;
    try {
      await navigator.clipboard.writeText(json);
      gooeyToast.success('Flow JSON copied');
    } catch {
      gooeyToast.error("Couldn't copy to clipboard");
    }
  }, [exportGate]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  const keyHandlers = useRef({ onSave, deleteComponent, selectedUid, mode });
  keyHandlers.current = { onSave, deleteComponent, selectedUid, mode };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const h = keyHandlers.current;
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        h.onSave();
        return;
      }
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (typing || h.mode !== 'edit') return;
      if (e.key === 'Delete' && h.selectedUid) h.deleteComponent(h.selectedUid);
      if (e.key === 'Escape') setSelectedUid(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Drag and drop ──────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragStart = ({ active }: DragStartEvent) => {
    const data = active.data.current;
    if (data?.source === 'palette') setActiveDrag({ source: 'palette', type: data.type });
    else setActiveDrag({ source: 'canvas', uid: String(active.id) });
  };

  const onDragMove = ({ active, over, activatorEvent, delta }: DragMoveEvent) => {
    if (active.data.current?.source !== 'palette' || !screen) return;
    let next: string | null = null;
    if (over?.id === SCREEN_DROP_ID) next = SCREEN_DROP_ID;
    else if (over) {
      const body = screen.components.filter((c) => c.type !== 'footer');
      const idx = body.findIndex((c) => c.uid === over.id);
      if (idx >= 0) {
        const pointerY = (activatorEvent as PointerEvent).clientY + delta.y;
        const lowerHalf = pointerY > over.rect.top + over.rect.height / 2;
        next = lowerHalf ? (body[idx + 1]?.uid ?? SCREEN_DROP_ID) : body[idx].uid;
      }
    }
    if (next !== insertBeforeUid) setInsertBeforeUid(next);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const drag = activeDrag;
    const before = insertBeforeUid;
    setActiveDrag(null);
    setInsertBeforeUid(null);
    if (!drag || !over) return;

    if (drag.source === 'palette') {
      addComponent(drag.type, before === SCREEN_DROP_ID ? null : before);
      return;
    }
    if (active.id !== over.id) {
      updateActiveComponents((list) => {
        const from = list.findIndex((c) => c.uid === active.id);
        const to = list.findIndex((c) => c.uid === over.id);
        return from < 0 || to < 0 ? list : arrayMove(list, from, to);
      });
    }
  };

  const onDragCancel = () => {
    setActiveDrag(null);
    setInsertBeforeUid(null);
  };

  // ── Render: loading / empty ────────────────────────────────────────────
  if (savedFlows === null) {
    return <LoadingState label="Loading WhatsApp flows…" className="h-full" />;
  }

  if (!flow || !screen || !metaJson) {
    return (
      <EmptyState
        className="h-full"
        icon={<MessageSquareText className="w-10 h-10 text-slate-300" />}
        title="No WhatsApp Flows yet"
        description="Build multi-screen forms customers fill in without leaving WhatsApp, then export Meta-ready Flow JSON."
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => onNewFlow(true)}
              className="flex items-center gap-1.5 text-[12px] font-semibold text-white bg-[#3440a8] hover:bg-[#2a3490] px-3.5 py-2 rounded-lg transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" /> Start from example
            </button>
            <button
              onClick={() => onNewFlow(false)}
              className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50 px-3.5 py-2 rounded-lg transition-colors"
            >
              <FilePlus2 className="w-3.5 h-3.5" /> Blank flow
            </button>
          </div>
        }
      />
    );
  }

  const isPersisted = savedFlows.some((f) => f.id === flow.id);
  const dragged = activeDrag?.source === 'canvas' ? screen.components.find((c) => c.uid === activeDrag.uid) : null;

  // ── Render: builder ────────────────────────────────────────────────────
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className="flex h-full w-full overflow-hidden">
        {mode === 'edit' && <WaComponentPalette disabledReasons={disabledReasons} onAdd={(t) => addComponent(t)} />}

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* ── Top bar ─────────────────────────────────────────────────── */}
          <div className="min-h-12 px-4 py-2 bg-white border-b border-slate-200 flex flex-wrap items-center gap-x-3 gap-y-2 shrink-0 z-10">
            <div className="flex items-center gap-2 min-w-0">
              <select
                value={isPersisted ? flow.id : ''}
                onChange={(e) => onSwitchFlow(e.target.value)}
                className="max-w-[160px] text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#3440a8]/20"
                title="Open a saved flow"
              >
                {!isPersisted && <option value="">New (unsaved)</option>}
                {savedFlows.map((f) => (
                  <option key={f.id} value={f.id}>{f.name || 'Untitled'}</option>
                ))}
              </select>
              <input
                value={flow.name}
                onChange={(e) => updateFlow((f) => ({ ...f, name: e.target.value }))}
                placeholder="Flow name"
                className={`w-44 text-[13px] font-semibold text-slate-800 bg-transparent border rounded-lg px-2 py-1 hover:border-slate-200 focus:border-[#3440a8]/40 focus:outline-none
                  ${flow.name.trim() ? 'border-transparent' : 'border-red-300'}`}
              />
              {isDirty && (
                <span className="text-[10px] font-medium text-amber-500 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-md">Unsaved</span>
              )}
            </div>

            {/* Mode switch */}
            <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
              {([
                ['edit', 'Edit', PencilRuler],
                ['preview', 'Preview', Eye],
                ['json', 'JSON', Braces],
              ] as const).map(([m, label, Icon]) => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setSelectedUid(null); }}
                  className={`flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md transition-colors
                    ${mode === m ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <Icon className="w-3.5 h-3.5" /> {label}
                </button>
              ))}
            </div>

            <div className="flex-1" />

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowIssues((v) => !v)}
                className={`flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-colors
                  ${errors.length ? 'text-red-600 border-red-200 bg-red-50 hover:bg-red-100' : 'text-emerald-600 border-emerald-200 bg-emerald-50 hover:bg-emerald-100'}`}
                title="Validation"
              >
                {errors.length ? <AlertTriangle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                {errors.length ? `${errors.length} error${errors.length > 1 ? 's' : ''}` : 'Valid'}
                {warnings.length > 0 && <span className="text-amber-600 font-medium">· {warnings.length} warning{warnings.length > 1 ? 's' : ''}</span>}
              </button>
              <button
                onClick={onSave}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-white bg-[#3440a8] hover:bg-[#2a3490] px-3 py-1.5 rounded-lg transition-colors"
              >
                <Save className="w-3.5 h-3.5" /> Save
              </button>
              <button
                onClick={onExport}
                className={`w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors ${errors.length ? 'opacity-50' : ''}`}
                title={errors.length ? 'Fix validation errors to export' : 'Export Meta Flow JSON'}
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onCopy}
                className={`w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors ${errors.length ? 'opacity-50' : ''}`}
                title={errors.length ? 'Fix validation errors to copy' : 'Copy Meta Flow JSON'}
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <div className="w-px h-5 bg-slate-200 mx-0.5" />
              <button
                onClick={() => onNewFlow(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors"
                title="New blank flow"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onDeleteFlow}
                disabled={!isPersisted}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 text-red-400 hover:bg-red-50 hover:border-red-200 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
                title="Delete flow"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {mode === 'edit' && (
            <WaScreenTabs
              screens={flow.screens}
              activeUid={screen.uid}
              errorCounts={screenErrorCounts}
              onSelect={(u) => { setActiveScreenUid(u); setSelectedUid(null); }}
              onAdd={addScreen}
              onRename={renameScreen}
              onDuplicate={duplicateScreen}
              onDelete={deleteScreen}
              onReorder={reorderScreens}
            />
          )}

          {/* ── Body ─────────────────────────────────────────────────────── */}
          <div className="flex-1 flex overflow-hidden">
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
              {mode === 'edit' && (
                <WaScreenCanvas
                  flow={flow}
                  screen={screen}
                  selectedUid={selectedUid}
                  componentErrors={componentErrorCounts}
                  insertBeforeUid={insertBeforeUid}
                  isDraggingFromPalette={activeDrag?.source === 'palette'}
                  onSelectComponent={setSelectedUid}
                  onSelectScreen={() => setSelectedUid(null)}
                  onDuplicate={duplicateComponent}
                  onDelete={deleteComponent}
                />
              )}

              {mode === 'preview' && (
                <div className="flex-1 overflow-auto bg-[#f8fafc] py-8 px-4">
                  <WaFlowPreview key={snapshot(flow)} flow={flow} startScreenUid={screen.uid} />
                </div>
              )}

              {mode === 'json' && (
                <div className="flex-1 overflow-auto bg-[#f8fafc] p-4">
                  {errors.length > 0 && (
                    <div className="mb-3 flex items-center gap-2 text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      This JSON has {errors.length} validation error(s) and can&apos;t be exported until they are fixed.
                    </div>
                  )}
                  <pre className="text-[11px] leading-relaxed font-mono bg-white border border-slate-200 rounded-xl p-4 overflow-x-auto text-slate-700">
                    {JSON.stringify(metaJson, null, 2)}
                  </pre>
                </div>
              )}

              {/* ── Validation drawer ───────────────────────────────────── */}
              {issues.length > 0 && (
                <div className="shrink-0 bg-white border-t border-slate-200">
                  <button
                    onClick={() => setShowIssues((v) => !v)}
                    className="w-full h-8 px-4 flex items-center gap-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    <AlertTriangle className={`w-3.5 h-3.5 ${errors.length ? 'text-red-500' : 'text-amber-500'}`} />
                    {errors.length} error(s), {warnings.length} warning(s)
                    <span className="flex-1" />
                    {showIssues ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                  </button>
                  {showIssues && (
                    <ul className="max-h-48 overflow-y-auto px-2 pb-2 space-y-0.5">
                      {[...errors, ...warnings].map((i, n) => (
                        <li key={n}>
                          <button
                            onClick={() => {
                              if (i.screenUid) setActiveScreenUid(i.screenUid);
                              setSelectedUid(i.componentUid ?? null);
                              setMode('edit');
                            }}
                            className="w-full text-left flex items-start gap-2 px-2 py-1.5 rounded-lg text-[11px] hover:bg-slate-50"
                          >
                            <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${i.severity === 'error' ? 'bg-red-500' : 'bg-amber-400'}`} />
                            <span className="text-slate-600">{i.message}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {mode === 'edit' && (
              <WaPropertiesPanel
                flow={flow}
                screen={screen}
                component={selected}
                issues={issues}
                onUpdateComponent={updateComponent}
                onUpdateScreen={(sUid, { title, ...rest }) => {
                  if (title !== undefined) renameScreen(sUid, title);
                  if (Object.keys(rest).length) updateScreens((list) => list.map((s) => (s.uid === sUid ? { ...s, ...rest } : s)));
                }}
                onUpdateFlow={(patch) => updateFlow((f) => ({ ...f, ...patch }))}
                onDuplicateComponent={duplicateComponent}
                onDeleteComponent={deleteComponent}
                onDeselect={() => setSelectedUid(null)}
              />
            )}
          </div>
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeDrag?.source === 'palette' && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-[#3440a8]/40 shadow-lg text-[11px] font-semibold text-slate-700 cursor-grabbing">
            <WaPaletteIcon type={activeDrag.type} className="w-4 h-4 text-[#3440a8]" />
            {paletteItem(activeDrag.type).label}
          </div>
        )}
        {dragged && (
          <div className="w-[300px] rounded-lg bg-white px-3 py-2 shadow-xl ring-2 ring-[#3440a8] cursor-grabbing">
            <WaComponentRenderer component={dragged} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
