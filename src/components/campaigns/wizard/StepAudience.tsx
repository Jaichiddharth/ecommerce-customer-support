'use client';

import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, Download, FileSpreadsheet, Info, Upload, X } from 'lucide-react';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { COUNTRIES } from '@/lib/phone';
import {
  ACCEPT_ATTR,
  ACCEPTED_EXTENSIONS,
  buildAudience,
  formatBytes,
  guessPhoneColumn,
  MAX_FILE_BYTES,
  MAX_ROWS,
  parseContactFile,
  SAMPLE_CSV,
  SheetError,
  type ParsedSheet,
} from '@/lib/campaigns/contact-file';
import { FieldLabel, SectionCard, formatNumber } from '../ui';
import type { CampaignAudience } from '../types';

interface Props {
  /** Local import (every recipient) or, for a saved campaign, the server's summary with a preview of the first rows */
  audience: CampaignAudience | null;
  /** Rows of the file picked in this session, so the phone column and country can be changed without re-uploading */
  sheet: ParsedSheet | null;
  /** `file` is the newly picked file, null when removed, undefined when only the column or country changed */
  onChange: (audience: CampaignAudience | null, sheet: ParsedSheet | null, file?: File | null) => void;
}

const PAGE_SIZE = 50;
const COUNTRY_OPTIONS = [
  { value: '', label: 'None: every number has a country code', dividerAfter: true },
  ...COUNTRIES.map((c) => ({ value: c.code, label: `${c.name} (+${c.dial})`, keywords: c.dial })),
];

const downloadText = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

const FormatGuide: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <div className="mb-4 p-4 rounded-xl border border-indigo-100 bg-indigo-50/50 text-[12px] text-slate-700">
    <div className="flex items-start justify-between gap-3">
      <p className="font-semibold text-slate-900">Contact file format</p>
      <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 cursor-pointer" title="Close">
        <X className="w-4 h-4" />
      </button>
    </div>
    <ul className="mt-2 space-y-1 list-disc pl-4">
      <li>
        A <b>CSV</b> or <b>Excel</b> (.xlsx, .xls) file, up to {formatBytes(MAX_FILE_BYTES)} and {formatNumber(MAX_ROWS)} rows. For Excel, the
        first sheet with data is used.
      </li>
      <li>Row 1 holds the column names. One column must contain phone numbers.</li>
      <li>Write numbers with the country code (+919876543210). Numbers without one use the default country below.</li>
      <li>Every other column (first_name, order_id, coupon…) can fill a template variable in the next step.</li>
      <li>Repeated numbers are sent once; invalid numbers are skipped and listed here.</li>
    </ul>
  </div>
);

export const StepAudience: React.FC<Props> = ({ audience, sheet, onChange }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [showRejected, setShowRejected] = useState(false);
  const [page, setPage] = useState(0);

  const handleFile = async (file: File) => {
    setError(null);
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(ext)) {
      setError('Upload a .csv, .xlsx or .xls file.');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError(`This file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_FILE_BYTES)}.`);
      return;
    }
    setReading(true);
    try {
      const parsed = await parseContactFile(file);
      if (parsed.columns.length === 0 || parsed.rows.length === 0) {
        setError('This file has no contacts. Row 1 should be the column names, with one contact per row below it.');
        return;
      }
      if (parsed.rows.length > MAX_ROWS) {
        setError(`This file has ${formatNumber(parsed.rows.length)} rows. Split it into files of up to ${formatNumber(MAX_ROWS)}.`);
        return;
      }
      const phoneColumn = guessPhoneColumn(parsed) || parsed.columns[0];
      setPage(0);
      onChange(
        buildAudience(parsed, { fileName: file.name, fileSize: file.size, phoneColumn, defaultCountry: audience?.defaultCountry ?? 'IN' }),
        parsed,
        file
      );
    } catch (err) {
      setError(err instanceof SheetError ? err.message : "Couldn't read this file. Check that it's a valid CSV (UTF-8) or Excel file.");
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const rebuild = (patch: { phoneColumn?: string; defaultCountry?: string }) => {
    if (!audience || !sheet) return;
    setPage(0);
    onChange(
      buildAudience(sheet, {
        fileName: audience.fileName,
        fileSize: audience.fileSize,
        phoneColumn: patch.phoneColumn ?? audience.phoneColumn,
        defaultCountry: patch.defaultCountry ?? audience.defaultCountry,
      }),
      sheet
    );
  };

  /** A saved campaign opened again only has a preview of its first recipients */
  const isPreview = Boolean(audience && audience.recipients.length < audience.recipientCount);
  const pageCount = Math.max(1, Math.ceil((audience?.recipients.length ?? 0) / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = useMemo(
    () => audience?.recipients.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE) ?? [],
    [audience, currentPage]
  );
  const countryAdded = audience?.countryAdded ?? 0;
  const defaultDial = audience?.defaultCountry ? COUNTRIES.find((c) => c.code === audience.defaultCountry)?.dial : undefined;

  const downloadRejected = () => {
    if (!audience) return;
    const lines = ['row,value,reason', ...audience.rejected.map((r) => [String(r.row), r.value, r.reason].map(csvCell).join(','))];
    if (audience.rejected.length < audience.rejectedCount) {
      lines.push(`,,"Only the first ${audience.rejected.length} of ${audience.rejectedCount} skipped rows are kept. Upload the file again to see all of them."`);
    }
    downloadText(`${audience.fileName.replace(/\.(csv|xlsx|xls)$/i, '')}-skipped.csv`, lines.join('\r\n'));
  };

  return (
    <div className="space-y-5">
      <SectionCard
        step="01"
        title="Upload contact file"
        description={
          <>
            CSV or Excel with a phone number column.{' '}
            <button type="button" onClick={() => setShowGuide((v) => !v)} className="inline-flex items-center gap-1 text-[#3440a8] font-semibold hover:underline cursor-pointer">
              <Info className="w-3.5 h-3.5" />
              Format guide
            </button>
          </>
        }
        action={
          <button
            type="button"
            onClick={() => downloadText('campaign-contacts-sample.csv', SAMPLE_CSV)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-[#3440a8] hover:bg-slate-50 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Sample file
          </button>
        }
      >
        {showGuide && <FormatGuide onClose={() => setShowGuide(false)} />}

        <input ref={inputRef} type="file" accept={ACCEPT_ATTR} className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />

        {audience ? (
          <div className="flex flex-wrap items-center gap-3 p-4 rounded-xl border border-emerald-200 bg-emerald-50/60">
            <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">{audience.fileName}</p>
              <p className="text-[11px] text-slate-500">
                {formatBytes(audience.fileSize)} · {formatNumber(audience.totalRows)} rows · {audience.columns.length} columns
              </p>
            </div>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Replace
            </button>
            <button
              type="button"
              onClick={() => onChange(null, null, null)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg text-red-600 hover:bg-red-50 cursor-pointer"
            >
              Remove
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) handleFile(file);
            }}
            disabled={reading}
            className={`w-full py-10 rounded-xl border-2 border-dashed flex flex-col items-center gap-2 transition-colors cursor-pointer ${
              dragging ? 'border-[#3440a8] bg-[#3440a8]/5' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            <div className="w-10 h-10 rounded-full bg-[#eef0fb] text-[#3440a8] flex items-center justify-center">
              <Upload className="w-5 h-5" />
            </div>
            <p className="text-sm font-semibold text-slate-800">{reading ? 'Reading file…' : 'Drop your contact file here or click to browse'}</p>
            <p className="text-[11px] text-slate-500">
              .csv, .xlsx, .xls up to {formatBytes(MAX_FILE_BYTES)} · {formatNumber(MAX_ROWS)} contacts
            </p>
          </button>
        )}

        {error && (
          <p className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-100 text-xs text-red-700 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {error}
          </p>
        )}
      </SectionCard>

      {audience && (
        <SectionCard step="02" title="Map phone column" description="Pick the column with phone numbers, and what to do with numbers that have no country code.">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="min-w-0">
              <FieldLabel htmlFor="phone-column">Phone number column *</FieldLabel>
              <SearchableSelect
                id="phone-column"
                size="md"
                value={audience.phoneColumn}
                onChange={(v) => rebuild({ phoneColumn: v })}
                disabled={!sheet}
                options={audience.columns.map((c) => ({ value: c, label: c, description: sheet?.rows[0]?.[c] }))}
              />
              {!sheet && <p className="mt-1 text-[11px] text-slate-400">Upload the file again to change the column.</p>}
            </div>
            <div className="min-w-0">
              <FieldLabel htmlFor="default-country">Country for numbers without a code</FieldLabel>
              <SearchableSelect
                id="default-country"
                size="md"
                value={audience.defaultCountry}
                onChange={(v) => rebuild({ defaultCountry: v })}
                disabled={!sheet}
                options={COUNTRY_OPTIONS}
                searchPlaceholder="Search country or code"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                WhatsApp needs the full international number. Numbers like 9876543210 get this country&apos;s code added; numbers
                starting with + or 00 are used as they are.
              </p>
            </div>
          </div>

          {countryAdded > 0 && defaultDial && (
            <p className="mt-4 px-3 py-2.5 rounded-lg bg-amber-50 border border-amber-100 text-[11px] text-amber-800 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>
                <b>{formatNumber(countryAdded)}</b> numbers had no country code, so <b>+{defaultDial}</b> was added (marked in the table below). If
                they&apos;re from other countries, add the codes in your file or choose <i>None</i> to skip them.
              </span>
            </p>
          )}

          <div className="mt-5 grid grid-cols-3 gap-3">
            <Stat label="Will receive" value={audience.recipientCount} tone="text-emerald-700" />
            <Stat label="Skipped (invalid)" value={audience.rejectedCount} tone={audience.rejectedCount ? 'text-red-600' : 'text-slate-900'} />
            <Stat label="Duplicates removed" value={audience.duplicates} tone="text-slate-900" />
          </div>

          {audience.rejected.length > 0 && (
            <div className="mt-3 rounded-xl border border-red-100 bg-red-50/40">
              <div className="flex items-center justify-between gap-2 px-4 py-2.5">
                <button type="button" onClick={() => setShowRejected((v) => !v)} className="flex items-center gap-1.5 text-xs font-semibold text-red-700 cursor-pointer">
                  <ChevronDown className={`w-4 h-4 transition-transform ${showRejected ? '' : '-rotate-90'}`} />
                  {formatNumber(audience.rejectedCount)} rows will be skipped
                </button>
                <button type="button" onClick={downloadRejected} className="text-xs font-semibold text-[#3440a8] hover:underline cursor-pointer">
                  Download list
                </button>
              </div>
              {showRejected && (
                <ul className="px-4 pb-3 space-y-1 max-h-48 overflow-y-auto text-[11px] text-slate-600">
                  {audience.rejected.slice(0, 100).map((r) => (
                    <li key={r.row}>
                      <span className="font-mono text-slate-400">Row {r.row}</span> · <span className="font-mono">{r.value || '(empty)'}</span> — {r.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="mt-5 rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 bg-slate-50 border-b border-slate-200">
              <p className="text-xs font-bold text-slate-700">
                Contacts <span className="font-normal text-slate-500">· {audience.columns.length} columns, scroll sideways to see all</span>
              </p>
              <span className="text-[11px] text-slate-500 tabular-nums">
                {formatNumber(currentPage * PAGE_SIZE + (pageRows.length ? 1 : 0))}–{formatNumber(currentPage * PAGE_SIZE + pageRows.length)} of{' '}
                {isPreview ? `the first ${formatNumber(audience.recipients.length)} (${formatNumber(audience.recipientCount)} saved)` : formatNumber(audience.recipientCount)}
              </span>
            </div>
            {/* Scrolls both ways; the "Sending to" column stays pinned on the left */}
            <div className="overflow-auto max-h-[420px]">
              <table className="min-w-full w-max text-xs border-separate border-spacing-0">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                    <th className="sticky top-0 left-0 z-20 bg-white px-4 py-2 font-bold text-[#3440a8] border-b border-r border-slate-200 whitespace-nowrap">
                      Sending to
                    </th>
                    {audience.columns.map((c) => (
                      <th
                        key={c}
                        className={`sticky top-0 z-10 bg-white px-4 py-2 font-bold whitespace-nowrap border-b border-slate-200 ${
                          c === audience.phoneColumn ? 'text-[#3440a8]' : ''
                        }`}
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => (
                    <tr key={r.phone} className="group">
                      <td className="sticky left-0 z-10 bg-white group-hover:bg-slate-50 px-4 py-2 font-mono text-slate-800 whitespace-nowrap border-b border-r border-slate-100">
                        {r.phone}
                        {r.countryAdded && (
                          <span className="ml-1.5 px-1 py-px rounded bg-amber-50 text-amber-700 text-[9px] font-sans font-bold" title="Country code added from the default country">
                            +{defaultDial ?? ''} added
                          </span>
                        )}
                      </td>
                      {audience.columns.map((c) => (
                        <td
                          key={c}
                          title={r.fields[c]}
                          className="px-4 py-2 text-slate-600 whitespace-nowrap max-w-[260px] truncate border-b border-slate-100 group-hover:bg-slate-50"
                        >
                          {r.fields[c]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pageCount > 1 && (
              <div className="px-4 py-2 flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-600">
                <button
                  type="button"
                  onClick={() => setPage(currentPage - 1)}
                  disabled={currentPage === 0}
                  className="px-2.5 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  Previous
                </button>
                <span className="tabular-nums">
                  Page {currentPage + 1} of {formatNumber(pageCount)}
                </span>
                <button
                  type="button"
                  onClick={() => setPage(currentPage + 1)}
                  disabled={currentPage >= pageCount - 1}
                  className="px-2.5 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </SectionCard>
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number; tone: string }> = ({ label, value, tone }) => (
  <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/50">
    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
    <p className={`mt-1 text-xl font-bold tabular-nums ${tone}`}>{formatNumber(value)}</p>
  </div>
);
