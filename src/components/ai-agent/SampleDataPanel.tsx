'use client';

import React, { useState } from 'react';
import { BookOpen, FlaskConical, MessageCircle, Package, ShoppingBag, Table2, Trash2 } from 'lucide-react';
import { notifyError } from '@/lib/api/notify';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { SAMPLE_ORDERS_CSV, SAMPLE_ORDERS_JSON, SAMPLE_PRODUCTS_CSV, SAMPLE_PRODUCTS_JSON } from '@/lib/ai-agent/sample-templates';
import { aiAgentApi, type KnowledgeStats, type SampleData, type SampleKind, type SampleTable, type SampleUpload } from './api';
import { Pill, Skeleton, timeAgo } from './ui';
import { UploadMenu, csvOption, jsonOption, readTextFile, type UploadFormat } from './UploadMenu';

const ORDER_OPTIONS = [
  csvOption('Any CSV: an orders export, an open dataset (e.g. Kaggle), the template, or Shopify’s Orders › Export › CSV. Every column is kept.'),
  jsonOption('A Shopify orders export from the Admin API (REST, GraphQL or bulk).'),
];
const ORDER_TEMPLATES = [
  { label: 'CSV template', fileName: 'sample-orders.csv', text: SAMPLE_ORDERS_CSV, type: 'text/csv' },
  { label: 'JSON template', fileName: 'sample-orders.json', text: SAMPLE_ORDERS_JSON, type: 'application/json' },
];
const PRODUCT_OPTIONS = [
  csvOption('Any CSV with a product name column, the template, or Shopify’s Products › Export › CSV. Every column is kept.'),
  jsonOption('A product list, or a Shopify products export from the Admin API.'),
];
const PRODUCT_TEMPLATES = [
  { label: 'CSV template', fileName: 'sample-products.csv', text: SAMPLE_PRODUCTS_CSV, type: 'text/csv' },
  { label: 'JSON template', fileName: 'sample-products.json', text: SAMPLE_PRODUCTS_JSON, type: 'application/json' },
];

const STATUS_TONE: Record<string, 'green' | 'blue' | 'amber' | 'red' | 'slate'> = {
  Delivered: 'green', Shipped: 'blue', 'Out for delivery': 'blue', 'Partly shipped': 'blue', Pending: 'amber', Cancelled: 'red', Returned: 'slate',
};

export function SampleDataPanel({ sample, knowledge, canEdit, onChange, onChecksChanged, onTry, onOpenKnowledge }: {
  sample: SampleData | null;
  knowledge: KnowledgeStats | null;
  canEdit: boolean;
  onChange: (s: SampleData) => void;
  onChecksChanged: () => void;
  onTry: (customerRef?: string) => void;
  onOpenKnowledge: () => void;
}) {
  const [busy, setBusy] = useState<SampleKind | null>(null);
  /** The columns the last orders upload read, shown under the orders until the page is left */
  const [columns, setColumns] = useState<SampleUpload['columns']>(null);
  /** Move old dates forward so the newest order is from yesterday (statuses then look like a live store's) */
  const [shiftDates, setShiftDates] = useState(true);

  const upload = async (kind: SampleKind, file: File, format: UploadFormat) => {
    setBusy(kind);
    try {
      const text = await readTextFile(file);
      const r = await aiAgentApi.uploadSampleData(kind, { format, text, fileName: file.name, ...(kind === 'orders' ? { shiftDates } : {}) });
      onChange(r.view);
      onChecksChanged();
      if (kind === 'orders') setColumns(r.columns);
      const what = kind === 'orders' ? `${r.count} sample order${r.count === 1 ? '' : 's'}` : `${r.count} sample product${r.count === 1 ? '' : 's'}`;
      const notes = [
        r.checksCreated ? `${r.checksCreated} check${r.checksCreated === 1 ? '' : 's'} created from them.` : null,
        r.skipped ? `${r.skipped} row${r.skipped === 1 ? '' : 's'} skipped.` : null,
        r.columns?.dateShiftDays ? `Dates moved forward ${r.columns.dateShiftDays.toLocaleString()} days.` : null,
      ].filter(Boolean).join(' ');
      if (r.checksError) gooeyToast.warning(`${what} saved, but no checks were made`, { description: r.checksError });
      else gooeyToast.success(`${what} uploaded`, notes ? { description: notes } : undefined);
    } catch (err) {
      notifyError(err, { where: 'SampleDataPanel.upload', title: `Couldn't upload the sample ${kind}` });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (kind: SampleKind) => {
    setBusy(kind);
    try {
      onChange(await aiAgentApi.removeSampleData(kind));
      if (kind === 'orders') setColumns(null);
      onChecksChanged();
      gooeyToast.success(`Sample ${kind} removed`, { description: 'The checks made from them were removed too.' });
    } catch (err) {
      notifyError(err, { where: 'SampleDataPanel.remove', title: `Couldn't remove the sample ${kind}` });
    } finally {
      setBusy(null);
    }
  };

  const shell = (icon: React.ReactNode, title: string, purpose: string, body: React.ReactNode, actions: React.ReactNode) => (
    <section className="flex flex-col rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-start gap-3 px-5 pt-5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-[#3440a8]">{icon}</span>
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-slate-900">{title}</h3>
          <p className="text-[12px] text-slate-500">{purpose}</p>
        </div>
      </div>
      <div className="flex-1 px-5 py-4">{body}</div>
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-3">{actions}</div>
    </section>
  );

  if (!sample) return <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-64" />)}</div>;
  const o = sample.orders;
  const p = sample.products;

  return (
    <div className="space-y-4">
    <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <FlaskConical className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
      <p className="text-[12.5px] leading-relaxed text-amber-900">
        <b className="font-semibold">Test data only.</b> Files uploaded here are used only by the test chat and the checks, never to answer
        real customers. Every column is kept, and test answers may show any of it, so open datasets (such as Kaggle&apos;s) work as they are.
        If you upload real customer data, you are responsible for it.
      </p>
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {shell(
        <Package className="w-5 h-5" />,
        'Sample orders',
        'For order-status (WISMO) answers',
        !o ? (
          <p className="text-[13px] text-slate-600 leading-relaxed">
            Upload any orders CSV, such as an open Kaggle dataset. In the test chat you pick a sample customer and ask &ldquo;where is my
            order?&rdquo; or about any column (payment mode, category, discount…). Checks are created from the orders and their columns.
          </p>
        ) : (
          <>
            <p className="text-[13px] text-slate-700"><b>{o.count}</b> order{o.count === 1 ? '' : 's'} · <b>{o.customers.length}</b> customer{o.customers.length === 1 ? '' : 's'}</p>
            <p className="text-[11.5px] text-slate-500 truncate" title={o.fileName ?? undefined}>{o.fileName ? `${o.fileName} · ` : ''}updated {timeAgo(o.updatedAt)}</p>
            <ul className="mt-3 divide-y divide-slate-100 text-[12.5px]">
              {o.preview.slice(0, 5).map((row) => (
                <li key={row.order + row.customer} className="py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate"><b className="text-slate-800">{row.order}</b> <span className="text-slate-500">· {row.customer}</span></span>
                    <Pill tone={STATUS_TONE[row.status] ?? 'slate'}>{row.status}</Pill>
                  </div>
                  <p className="truncate text-[11.5px] text-slate-500" title={row.items}>
                    {[row.items, row.date && `ordered ${new Date(row.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`, row.tracking].filter(Boolean).join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
            {columns && (
              <div className="mt-3 space-y-1 rounded-lg bg-slate-50 px-3 py-2 text-[11.5px] leading-snug text-slate-600">
                {columns.used.length > 0 && <p><b className="text-slate-700">Used for order status:</b> {columns.used.join(', ')}</p>}
                {columns.kept.length > 0 && <p><b className="text-slate-700">Also kept (ask about these in the test chat):</b> {columns.kept.join(', ')}</p>}
                {columns.numbered && <p>No order ID column, so each row is one order, numbered #1001, #1002…</p>}
                {columns.dateShiftDays !== null && <p>Dates moved forward {columns.dateShiftDays.toLocaleString()} days, so the newest order is from yesterday.</p>}
              </div>
            )}
          </>
        ),
        <>
          <label className="flex w-full items-center gap-2 pb-1 text-[12px] text-slate-600" title="Old datasets: every date moves forward by the same number of days, so orders are being prepared, shipped or delivered as in a live store">
            <input type="checkbox" checked={shiftDates} onChange={(e) => setShiftDates(e.target.checked)} className="h-3.5 w-3.5 accent-[#3440a8]" disabled={!canEdit} />
            Move dates to today on upload (newest order = yesterday)
          </label>
          <UploadMenu label={o ? 'Replace' : 'Upload orders'} primary={!o} disabled={!canEdit} busy={busy === 'orders'} options={ORDER_OPTIONS} templates={ORDER_TEMPLATES} onFile={(f, fmt) => upload('orders', f, fmt)} />
          {o && (
            <>
              <button type="button" onClick={() => onTry(o.customers[0]?.ref)} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-semibold text-[#3440a8] hover:bg-indigo-50">
                <MessageCircle className="w-4 h-4" /> Try in chat
              </button>
              {canEdit && (
                <button type="button" aria-label="Remove sample orders" onClick={() => remove('orders')} disabled={busy !== null} className="ml-auto rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </>
          )}
        </>,
      )}

      {shell(
        <ShoppingBag className="w-5 h-5" />,
        'Sample products',
        'For the shopping assistant (chat widget)',
        !p ? (
          <p className="text-[13px] text-slate-600 leading-relaxed">
            Upload any product CSV with a name column. Every column (brand, size, colour, rating…) is kept, and checks are created that ask
            the shopping assistant for products and their details.
          </p>
        ) : (
          <>
            <p className="text-[13px] text-slate-700"><b>{p.count}</b> product{p.count === 1 ? '' : 's'}</p>
            <p className="text-[11.5px] text-slate-500 truncate" title={p.fileName ?? undefined}>{p.fileName ? `${p.fileName} · ` : ''}updated {timeAgo(p.updatedAt)}</p>
            <ul className="mt-3 divide-y divide-slate-100 text-[12.5px]">
              {p.preview.slice(0, 5).map((row) => (
                <li key={row.title} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0 truncate text-slate-800">{row.title}</span>
                  <span className="shrink-0 text-slate-600">
                    {row.available ? row.price ?? '' : <Pill tone="red">Sold out</Pill>}
                    {row.available && row.compareAtPrice && <s className="ml-1 text-slate-400">{row.compareAtPrice}</s>}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ),
        <>
          <UploadMenu label={p ? 'Replace' : 'Upload products'} primary={!p} disabled={!canEdit} busy={busy === 'products'} options={PRODUCT_OPTIONS} templates={PRODUCT_TEMPLATES} onFile={(f, fmt) => upload('products', f, fmt)} />
          {p && canEdit && (
            <button type="button" aria-label="Remove sample products" onClick={() => remove('products')} disabled={busy !== null} className="ml-auto rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </>,
      )}

      {shell(
        <BookOpen className="w-5 h-5" />,
        'Help & FAQ',
        'Answers come from your Knowledge',
        <p className="text-[13px] text-slate-600 leading-relaxed">
          {knowledge
            ? knowledge.sources
              ? <>Your agent answers from <b>{knowledge.live_sources}</b> live source{knowledge.live_sources === 1 ? '' : 's'} ({knowledge.items.toLocaleString()} items). Add an FAQ or policy page there and ask about it in the test chat.</>
              : 'Nothing added yet. Add your FAQ, return policy and shipping info in Knowledge; the agent answers help questions only from it.'
            : 'Loading…'}
        </p>,
        <button type="button" onClick={onOpenKnowledge} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
          Open Knowledge
        </button>,
      )}
    </div>
    {o?.table && <DataTable title="Sample orders: every column" table={o.table} unit="orders" />}
    {p?.table && <DataTable title="Sample products: every column" table={p.table} unit="products" />}
    </div>
  );
}

/** The uploaded test data with all of its columns (first rows), scrollable both ways */
function DataTable({ title, table, unit }: { title: string; table: SampleTable; unit: string }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-b border-slate-100">
        <h3 className="flex items-center gap-2 text-[14px] font-semibold text-slate-900">
          <Table2 className="w-4 h-4 text-[#3440a8]" /> {title}
        </h3>
        <p className="text-[11.5px] text-slate-500">
          {table.headers.length} columns · showing {Math.min(table.rows.length, table.total).toLocaleString()} of {table.total.toLocaleString()} {unit} · test data only
        </p>
      </div>
      <div className="max-h-[420px] overflow-auto">
        <table className="min-w-full text-[12px]">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr>
              {table.headers.map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-semibold text-slate-600 border-b border-slate-200">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              <tr key={i} className="odd:bg-white even:bg-slate-50/50">
                {row.map((cell, j) => (
                  <td key={j} title={cell} className="max-w-[260px] truncate whitespace-nowrap px-3 py-1.5 text-slate-700 border-b border-slate-100">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
