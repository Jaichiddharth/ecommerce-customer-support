'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, FileJson, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { TEST_CASE_CSV_HEADER, TEST_CASE_CSV_SAMPLE, TEST_CASE_JSON_SAMPLE } from '@/lib/ai-agent/csv';

export type UploadFormat = 'csv' | 'json';

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Reads an uploaded text file whatever Excel or Sheets saved it as: UTF-8 (with or without BOM), UTF-16
 * ("Unicode text") or the Windows ANSI code page.
 */
export async function readTextFile(file: File): Promise<string> {
  if (file.size > MAX_BYTES) throw new Error('The file is too large (max 5 MB).');
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  const utf8 = new TextDecoder('utf-8').decode(buf);
  return utf8.includes(String.fromCharCode(0xfffd)) ? new TextDecoder('windows-1252').decode(buf) : utf8;
}

/** The format to read a file as: its extension wins over the menu choice (a .json picked under CSV is JSON) */
export function formatOf(file: File, chosen: UploadFormat): UploadFormat {
  if (/\.(json|jsonl|ndjson)$/i.test(file.name)) return 'json';
  if (/\.(csv|tsv|txt)$/i.test(file.name)) return 'csv';
  return chosen;
}

export function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface UploadOption {
  format: UploadFormat;
  label: string;
  hint: string;
  accept: string;
  Icon: React.ComponentType<{ className?: string }>;
}
export interface UploadTemplate {
  label: string;
  fileName: string;
  text: string;
  type: string;
  title?: string;
}

const CSV_ACCEPT = '.csv,.tsv,.txt,text/csv,text/plain,application/vnd.ms-excel';
const JSON_ACCEPT = '.json,.jsonl,.ndjson,application/json';
export const csvOption = (hint: string): UploadOption => ({ format: 'csv', label: 'CSV file', hint, accept: CSV_ACCEPT, Icon: FileSpreadsheet });
export const jsonOption = (hint: string): UploadOption => ({ format: 'json', label: 'JSON file', hint, accept: JSON_ACCEPT, Icon: FileJson });

/** Checks (test cases) written as questions */
export const CHECK_UPLOAD_OPTIONS: UploadOption[] = [
  csvOption('A "question" column, optionally expected answer, category, must include…'),
  jsonOption('An array of objects with a "question".'),
];
export const CHECK_TEMPLATES: UploadTemplate[] = [
  { label: 'CSV template', fileName: 'checks.csv', text: TEST_CASE_CSV_SAMPLE, type: 'text/csv', title: `Columns: ${TEST_CASE_CSV_HEADER}` },
  { label: 'JSON template', fileName: 'checks.json', text: TEST_CASE_JSON_SAMPLE, type: 'application/json' },
];

export function UploadMenu({
  disabled,
  busy,
  onFile,
  label = 'Upload',
  options = CHECK_UPLOAD_OPTIONS,
  templates = CHECK_TEMPLATES,
  primary = false,
}: {
  disabled?: boolean;
  busy?: boolean;
  onFile: (file: File, format: UploadFormat) => void;
  label?: string;
  options?: UploadOption[];
  templates?: UploadTemplate[];
  primary?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<UploadFormat>('csv');
  const fileRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const pick = (f: UploadFormat) => {
    setFormat(f);
    setOpen(false);
    // Let the input pick up the new accept list before opening the dialog
    setTimeout(() => fileRef.current?.click(), 0);
  };

  return (
    <div className="relative" ref={boxRef}>
      <input
        ref={fileRef}
        type="file"
        accept={(options.find((o) => o.format === format) ?? options[0]).accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onFile(file, formatOf(file, format));
        }}
      />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled || busy}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-[13px] font-semibold disabled:opacity-50 ${
          primary ? 'bg-[#3440a8] text-white hover:bg-[#2a3490]' : 'border border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
        }`}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} {label}
        <ChevronDown className={`w-3.5 h-3.5 ${primary ? 'text-white/70' : 'text-slate-400'}`} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-2 w-[320px] rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
          {options.map(({ format: f, label: optionLabel, hint, Icon }) => (
            <button key={f} role="menuitem" type="button" onClick={() => pick(f)} className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-slate-50">
              <Icon className="w-5 h-5 text-[#3440a8] shrink-0 mt-0.5" />
              <span>
                <span className="block text-[13px] font-semibold text-slate-900">{optionLabel}</span>
                <span className="block text-[12px] text-slate-500 leading-snug">{hint}</span>
              </span>
            </button>
          ))}
          <div className="my-1 border-t border-slate-100" />
          <div className="flex flex-wrap gap-1 px-1.5 pb-1">
            {templates.map((t) => (
              <button key={t.fileName} type="button" onClick={() => download(t.fileName, t.text, t.type)} title={t.title} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50">
                <Download className="w-3.5 h-3.5" /> {t.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
