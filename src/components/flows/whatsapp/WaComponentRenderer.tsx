'use client';

import React from 'react';
import { Calendar, ChevronDown, Check } from 'lucide-react';
import type { WaComponent } from '@/lib/whatsapp-flows/wa-flow-types';

export type WaFieldValue = string | string[] | boolean | undefined;

interface RendererProps {
  component: WaComponent;
  /** Interactive (preview) mode when provided; static (editor) mode otherwise. */
  value?: WaFieldValue;
  onChange?: (value: WaFieldValue) => void;
  /** Footer only: disabled until required fields are filled (preview). */
  footerDisabled?: boolean;
  onFooterClick?: () => void;
}

const WA_GREEN = '#008069';

const fieldShell =
  'w-full rounded-lg border border-slate-300 bg-white px-3 text-[13px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069]';

function FloatingLabel({ label, required }: { label: string; required: boolean }) {
  return (
    <span className="absolute -top-2 left-2.5 px-1 bg-white text-[10px] text-slate-500 leading-none">
      {label || 'Label'}
      {!required && <span className="text-slate-400"> (optional)</span>}
    </span>
  );
}

function Helper({ text }: { text?: string }) {
  return text ? <p className="mt-1 px-1 text-[10px] text-slate-500">{text}</p> : null;
}

const fontClass = (w?: string) =>
  w === 'bold' ? 'font-bold' : w === 'italic' ? 'italic' : w === 'bold_italic' ? 'font-bold italic' : '';

export function WaComponentRenderer({ component: c, value, onChange, footerDisabled, onFooterClick }: RendererProps) {
  const interactive = !!onChange;

  switch (c.type) {
    case 'heading':
      return <h2 className="text-[18px] font-bold text-slate-900 leading-snug break-words">{c.text || 'Heading'}</h2>;
    case 'subheading':
      return <h3 className="text-[15px] font-semibold text-slate-800 leading-snug break-words">{c.text || 'Subheading'}</h3>;
    case 'body':
    case 'caption':
      return (
        <p
          className={`${c.type === 'body' ? 'text-[13px] text-slate-700' : 'text-[11px] text-slate-500'} whitespace-pre-wrap break-words ${fontClass(c.fontWeight)} ${c.strikethrough ? 'line-through' : ''}`}
        >
          {c.text || (c.type === 'body' ? 'Body text' : 'Caption')}
        </p>
      );

    case 'text_input': {
      const htmlType =
        c.inputType === 'number' ? 'number'
          : c.inputType === 'email' ? 'email'
          : c.inputType === 'password' || c.inputType === 'passcode' ? 'password'
          : c.inputType === 'phone' ? 'tel'
          : 'text';
      return (
        <div>
          <label className="relative block">
            <FloatingLabel label={c.label} required={c.required} />
            <input
              type={htmlType}
              readOnly={!interactive}
              tabIndex={interactive ? 0 : -1}
              value={interactive ? String(value ?? '') : ''}
              onChange={(e) => onChange?.(e.target.value)}
              maxLength={c.maxChars}
              className={`${fieldShell} h-10 ${interactive ? '' : 'pointer-events-none'}`}
            />
          </label>
          <Helper text={c.helperText} />
        </div>
      );
    }

    case 'text_area':
      return (
        <div>
          <label className="relative block">
            <FloatingLabel label={c.label} required={c.required} />
            <textarea
              readOnly={!interactive}
              tabIndex={interactive ? 0 : -1}
              rows={3}
              value={interactive ? String(value ?? '') : ''}
              onChange={(e) => onChange?.(e.target.value)}
              maxLength={c.maxLength ?? 600}
              className={`${fieldShell} py-2.5 resize-none ${interactive ? '' : 'pointer-events-none'}`}
            />
          </label>
          <Helper text={c.helperText} />
        </div>
      );

    case 'dropdown':
      return (
        <label className="relative block">
          <FloatingLabel label={c.label} required={c.required} />
          {interactive ? (
            <select
              value={String(value ?? '')}
              onChange={(e) => onChange?.(e.target.value)}
              className={`${fieldShell} h-10 appearance-none pr-8`}
            >
              <option value="">Select…</option>
              {c.options.map((o) => (
                <option key={o.uid} value={o.id}>{o.title}</option>
              ))}
            </select>
          ) : (
            <div className={`${fieldShell} h-10 flex items-center text-slate-400`}>Select…</div>
          )}
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
        </label>
      );

    case 'radio':
    case 'checkbox': {
      const multi = c.type === 'checkbox';
      const selected = multi ? ((value as string[] | undefined) ?? []) : value;
      const toggle = (id: string) => {
        if (!interactive) return;
        if (!multi) return onChange?.(id);
        const arr = selected as string[];
        onChange?.(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
      };
      return (
        <fieldset>
          <legend className="text-[13px] font-semibold text-slate-800">
            {c.label || 'Label'}
            {!c.required && <span className="font-normal text-slate-400 text-[11px]"> (optional)</span>}
          </legend>
          {c.description && <p className="text-[11px] text-slate-500 mt-0.5">{c.description}</p>}
          <div className="mt-1.5 divide-y divide-slate-100">
            {c.options.map((o) => {
              const on = multi ? (selected as string[]).includes(o.id) : selected === o.id;
              return (
                <button
                  type="button"
                  key={o.uid}
                  tabIndex={interactive ? 0 : -1}
                  onClick={() => toggle(o.id)}
                  className={`w-full flex items-center gap-3 py-2 text-left ${interactive ? 'cursor-pointer' : 'cursor-default'}`}
                >
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] text-slate-800 truncate">{o.title || 'Option'}</span>
                    {o.description && <span className="block text-[11px] text-slate-500 truncate">{o.description}</span>}
                  </span>
                  <span
                    className={`w-[18px] h-[18px] shrink-0 flex items-center justify-center border-2 ${multi ? 'rounded' : 'rounded-full'}`}
                    style={{ borderColor: on ? WA_GREEN : '#94a3b8', background: on && multi ? WA_GREEN : undefined }}
                  >
                    {on && (multi
                      ? <Check className="w-3 h-3 text-white" strokeWidth={3} />
                      : <span className="w-2 h-2 rounded-full" style={{ background: WA_GREEN }} />)}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
      );
    }

    case 'date':
      return (
        <div>
          <label className="relative block">
            <FloatingLabel label={c.label} required={c.required} />
            {interactive ? (
              <input
                type="date"
                value={String(value ?? '')}
                min={c.minDate}
                max={c.maxDate}
                onChange={(e) => onChange?.(e.target.value)}
                className={`${fieldShell} h-10`}
              />
            ) : (
              <div className={`${fieldShell} h-10 flex items-center justify-between text-slate-400`}>
                <span>YYYY-MM-DD</span>
                <Calendar className="w-4 h-4 text-slate-500" />
              </div>
            )}
          </label>
          <Helper text={c.helperText} />
        </div>
      );

    case 'opt_in': {
      const on = value === true;
      return (
        <button
          type="button"
          tabIndex={interactive ? 0 : -1}
          onClick={() => interactive && onChange?.(!on)}
          className={`w-full flex items-start gap-2.5 text-left ${interactive ? 'cursor-pointer' : 'cursor-default'}`}
        >
          <span
            className="mt-0.5 w-[18px] h-[18px] shrink-0 rounded border-2 flex items-center justify-center"
            style={{ borderColor: on ? WA_GREEN : '#94a3b8', background: on ? WA_GREEN : undefined }}
          >
            {on && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
          </span>
          <span className="text-[12px] text-slate-700 break-words">
            {c.label || 'Opt-in label'}
            {!c.required && <span className="text-slate-400"> (optional)</span>}
          </span>
        </button>
      );
    }

    case 'footer':
      return (
        <div>
          {(c.leftCaption || c.centerCaption || c.rightCaption) && (
            <div className="flex items-center text-[10px] text-slate-500 mb-1.5 px-0.5">
              {c.centerCaption ? (
                <span className="flex-1 text-center">{c.centerCaption}</span>
              ) : (
                <>
                  <span className="flex-1">{c.leftCaption}</span>
                  <span>{c.rightCaption}</span>
                </>
              )}
            </div>
          )}
          <button
            type="button"
            tabIndex={interactive || onFooterClick ? 0 : -1}
            disabled={footerDisabled}
            onClick={onFooterClick}
            className="w-full h-10 rounded-full text-[13px] font-semibold text-white transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: WA_GREEN }}
          >
            {c.label || 'Continue'}
          </button>
        </div>
      );
  }
}
