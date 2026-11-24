'use client';

import React, { useState } from 'react';
import { BookOpen, MessageCircle, Package, ShoppingBag, Trash2 } from 'lucide-react';
import { notifyError } from '@/lib/api/notify';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { SAMPLE_ORDERS_CSV, SAMPLE_ORDERS_JSON, SAMPLE_PRODUCTS_CSV, SAMPLE_PRODUCTS_JSON } from '@/lib/ai-agent/sample-templates';
import { aiAgentApi, type KnowledgeStats, type SampleData, type SampleKind, type SampleUpload } from './api';
import { Pill, Skeleton, timeAgo } from './ui';
import { UploadMenu, csvOption, jsonOption, readTextFile, type UploadFormat } from './UploadMenu';

const ORDER_OPTIONS = [
  csvOption('Any orders export with an order ID column (one row per order or per item), the template, or Shopify’s Orders › Export › CSV.'),
  jsonOption('A Shopify orders export from the Admin API (REST, GraphQL or bulk).'),
];
const ORDER_TEMPLATES = [
  { label: 'CSV template', fileName: 'sample-orders.csv', text: SAMPLE_ORDERS_CSV, type: 'text/csv' },
  { label: 'JSON template', fileName: 'sample-orders.json', text: SAMPLE_ORDERS_JSON, type: 'application/json' },
];
const PRODUCT_OPTIONS = [
  csvOption('The template, or a Shopify products export: Products › Export › CSV.'),
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

  const upload = async (kind: SampleKind, file: File, format: UploadFormat) => {
    setBusy(kind);
    try {
      const text = await readTextFile(file);
      const r = await aiAgentApi.uploadSampleData(kind, { format, text, fileName: file.name });
      onChange(r.view);
      onChecksChanged();
      if (kind === 'orders') setColumns(r.columns);
      const what = kind === 'orders' ? `${r.count} sample order${r.count === 1 ? '' : 's'}` : `${r.count} sample product${r.count === 1 ? '' : 's'}`;
      const notes = [
        r.checksCreated ? `${r.checksCreated} check${r.checksCreated === 1 ? '' : 's'} created from them.` : null,
        r.skipped ? `${r.skipped} row${r.skipped === 1 ? '' : 's'} skipped.` : null,
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
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {shell(
        <Package className="w-5 h-5" />,
        'Sample orders',
        'For order-status (WISMO) answers',
        !o ? (
          <p className="text-[13px] text-slate-600 leading-relaxed">
            Upload a few orders: pending, shipped with tracking, delivered and cancelled. In the test chat you pick a sample customer and ask
            &ldquo;where is my order?&rdquo;. One check is created per order.
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
                <p><b className="text-slate-700">Read:</b> {columns.used.join(', ')}</p>
                {columns.ignored.length > 0 && <p><b className="text-slate-700">Not needed for order status:</b> {columns.ignored.join(', ')}</p>}
                {columns.addresses.length > 0 && <p><b className="text-slate-700">Not kept:</b> {columns.addresses.join(', ')} (only the shipping address is used, shown only to the customer who placed the order)</p>}
              </div>
            )}
          </>
        ),
        <>
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
            Upload a product catalogue to try the sales assistant before your store is connected: the widget preview and the test chat&apos;s
            Website view recommend from it. One check is created per product it should find.
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
  );
}
