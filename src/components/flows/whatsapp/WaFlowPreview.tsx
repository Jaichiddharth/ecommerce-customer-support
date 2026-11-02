'use client';

import React, { useMemo, useState } from 'react';
import { ArrowLeft, X, RotateCcw, CheckCircle2, XCircle } from 'lucide-react';
import type { WaComponent, WaFlow } from './wa-flow-types';
import { isInputComponent } from './wa-flow-types';
import { normalizeOrder } from './wa-component-registry';
import { analyzeNavigation, footerOf } from './wa-flow-json';
import { WaComponentRenderer, type WaFieldValue } from './WaComponentRenderer';

function isFilled(c: WaComponent, v: WaFieldValue) {
  if (c.type === 'checkbox') return Array.isArray(v) && v.length > 0;
  if (c.type === 'opt_in') return v === true;
  return typeof v === 'string' && v.trim() !== '';
}

/** Mirrors client-side checks WhatsApp performs before enabling the Footer. */
function fieldError(c: WaComponent, v: WaFieldValue): string | null {
  if (!isInputComponent(c)) return null;
  if (c.required && !isFilled(c, v)) return 'required';
  if (c.type === 'text_input' && typeof v === 'string' && v) {
    if (c.minChars !== undefined && v.length < c.minChars) return `min ${c.minChars} characters`;
    if (c.pattern) {
      try { if (!new RegExp(c.pattern).test(v)) return c.helperText || 'invalid format'; } catch { /* surfaced by validation */ }
    }
    if (c.inputType === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'invalid email';
  }
  if (c.type === 'checkbox' && Array.isArray(v) && v.length) {
    if (c.minSelected !== undefined && v.length < c.minSelected) return `select at least ${c.minSelected}`;
    if (c.maxSelected !== undefined && v.length > c.maxSelected) return `select at most ${c.maxSelected}`;
  }
  return null;
}

export function WaFlowPreview({ flow, startScreenUid }: { flow: WaFlow; startScreenUid?: string }) {
  const firstUid = startScreenUid ?? flow.screens[0]?.uid;
  const [stack, setStack] = useState<string[]>(firstUid ? [firstUid] : []);
  const [values, setValues] = useState<Record<string, WaFieldValue>>({});
  const [completed, setCompleted] = useState<{ success: boolean; payload: Record<string, WaFieldValue> } | null>(null);
  const nav = useMemo(() => analyzeNavigation(flow), [flow]);

  const screen = flow.screens.find((s) => s.uid === stack[stack.length - 1]);
  const restart = (uid = flow.screens[0]?.uid) => {
    setStack(uid ? [uid] : []);
    setValues({});
    setCompleted(null);
  };

  if (!screen) {
    return <p className="text-[12px] text-slate-400 text-center p-8">No screens to preview.</p>;
  }

  const components = normalizeOrder(screen.components);
  const body = components.filter((c) => c.type !== 'footer');
  const footer = footerOf(screen);
  const errors = body.map((c) => ({ c, e: isInputComponent(c) ? fieldError(c, values[c.name]) : null })).filter((x) => x.e);
  const target = footer?.action === 'navigate' ? flow.screens.find((s) => s.uid === footer.nextScreenUid) : undefined;

  const onFooter = () => {
    if (!footer) return;
    if (footer.action === 'navigate') {
      if (target) setStack((s) => [...s, target.uid]);
      return;
    }
    // Same payload shape as the generated `complete` action: this screen + every screen leading to it.
    const payload: Record<string, WaFieldValue> = {};
    for (const s of [...(nav.ancestors.get(screen.uid) ?? []), screen]) {
      for (const c of s.components) if (isInputComponent(c)) payload[c.name] = values[c.name] ?? (c.type === 'checkbox' ? [] : c.type === 'opt_in' ? false : '');
    }
    setCompleted({ success: screen.success, payload });
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6 items-center lg:items-start justify-center">
      {/* Screen jump list */}
      <div className="w-full lg:w-48 shrink-0 space-y-1.5 order-2 lg:order-1">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Jump to screen</p>
        {flow.screens.map((s, i) => (
          <button
            key={s.uid}
            type="button"
            onClick={() => restart(s.uid)}
            className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] border transition-colors
              ${s.uid === screen.uid && !completed ? 'bg-[#3440a8]/5 border-[#3440a8]/30 text-[#3440a8] font-semibold' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            {i + 1}. {s.title || s.id}
          </button>
        ))}
        <button
          type="button"
          onClick={() => restart()}
          className="w-full flex items-center justify-center gap-1.5 mt-2 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-slate-500 border border-slate-200 hover:bg-slate-50"
        >
          <RotateCcw className="w-3 h-3" /> Restart flow
        </button>
      </div>

      {/* Phone */}
      <div className="w-[340px] shrink-0 order-1 lg:order-2">
        <div className="rounded-[28px] border-[6px] border-slate-800 bg-white shadow-xl overflow-hidden flex flex-col h-[600px]">
          <div className="h-12 px-3 flex items-center gap-2 border-b border-slate-100 shrink-0">
            {stack.length > 1 && !completed ? (
              <button type="button" onClick={() => setStack((s) => s.slice(0, -1))} className="w-6 h-6 flex items-center justify-center rounded hover:bg-slate-100" title="Back">
                <ArrowLeft className="w-4 h-4 text-slate-600" />
              </button>
            ) : (
              <button type="button" onClick={() => restart()} className="w-6 h-6 flex items-center justify-center rounded hover:bg-slate-100" title="Close">
                <X className="w-4 h-4 text-slate-600" />
              </button>
            )}
            <span className="flex-1 text-center text-[14px] font-semibold text-slate-800 truncate">
              {completed ? 'Submitted' : screen.title}
            </span>
            <span className="w-6" />
          </div>

          {completed ? (
            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
              <div className="flex flex-col items-center gap-2 text-center">
                {completed.success
                  ? <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                  : <XCircle className="w-10 h-10 text-amber-500" />}
                <p className="text-[14px] font-semibold text-slate-800">Flow completed</p>
                <p className="text-[11px] text-slate-500">This payload is delivered to your webhook as the flow response.</p>
              </div>
              <pre className="text-[10px] font-mono bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-x-auto text-slate-700">
                {JSON.stringify(completed.payload, null, 2)}
              </pre>
              <button type="button" onClick={() => restart()} className="w-full h-9 rounded-full text-[12px] font-semibold text-white bg-[#008069]">
                Start again
              </button>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                {body.map((c) => (
                  <div key={c.uid}>
                    <WaComponentRenderer
                      component={c}
                      value={isInputComponent(c) ? values[c.name] : undefined}
                      onChange={isInputComponent(c) ? (v) => setValues((prev) => ({ ...prev, [c.name]: v })) : () => {}}
                    />
                  </div>
                ))}
              </div>
              <div className="px-6 pt-2 pb-4 border-t border-slate-100 shrink-0">
                {footer ? (
                  <WaComponentRenderer component={footer} footerDisabled={errors.length > 0 || (footer.action === 'navigate' && !target)} onFooterClick={onFooter} />
                ) : (
                  <p className="text-[11px] text-red-500 text-center">This screen has no Footer.</p>
                )}
                {errors.length > 0 && (
                  <p className="mt-1.5 text-[10px] text-slate-400 text-center truncate">
                    {errors.map(({ c, e }) => `${'label' in c ? c.label : ''}: ${e}`).join(' · ')}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
        {!completed && !nav.reachable.has(screen.uid) && (
          <p className="mt-2 text-[10px] text-amber-600 text-center">This screen is not reachable from the first screen.</p>
        )}
      </div>
    </div>
  );
}
