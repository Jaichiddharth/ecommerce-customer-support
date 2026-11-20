'use client';

import React, { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, CheckCheck, Clock, Eye, Lock, RefreshCw, Send } from 'lucide-react';
import { secondaryBtn } from '@/components/ui/controls';
import { DataTable, createColumnHelper, useServerTable, type FilterDef } from '@/components/ui/data-table';
import { mappableFields } from '@/lib/campaigns/message';
import { getMetaErrorInfo } from '@/lib/errors/meta-errors';
import type { CampaignRecipientDto } from '@/lib/services/campaign.service';
import { useCampaignActions } from './campaign-actions';
import { getCampaign, listCampaignRecipients } from './campaign-store';
import { PAUSE_REASON_LABEL, type Campaign } from './types';
import { CampaignStatusPill, formatDateTime, formatDuration, formatNumber } from './ui';
import { dispatchSeconds } from './wizard/StepSchedule';


const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** Stored numbers may or may not carry the "+" */
const displayPhone = (phone: string) => (phone.startsWith('+') ? phone : `+${phone}`);

/** "Nov 18, 2:55 PM" in the campaign's time zone */
function shortTime(iso: string | null, timeZone: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone });
  } catch {
    return new Date(iso).toLocaleString();
  }
}

/**
 * Status badge plus a one-line summary of the problem; hovering (or focusing) it shows the whole issue: Meta's code,
 * the catalog's title, message, cause and fix. Rows that only stored a code get their text from the catalog.
 * The popover is `position: fixed` so the table's scroll container doesn't clip it.
 */
function RecipientIssue({ recipient: r, badge }: { recipient: CampaignRecipientDto; badge: { label: string; className: string } }) {
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const info = getMetaErrorInfo(r.errorCode);
  const message = r.errorMessage || info?.userMessage || (r.errorCode ? `WhatsApp error ${r.errorCode}.` : '');

  const show = (e: React.SyntheticEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const width = 320;
    const above = rect.bottom + 240 > window.innerHeight;
    setPos({
      top: above ? rect.top - 6 : rect.bottom + 6,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      above,
    });
  };

  return (
    <div
      className="flex flex-col items-start gap-0.5 cursor-help outline-none"
      tabIndex={0}
      onMouseEnter={show}
      onMouseLeave={() => setPos(null)}
      onFocus={show}
      onBlur={() => setPos(null)}
    >
      <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-md border whitespace-nowrap ${badge.className}`}>{badge.label}</span>
      <span className="text-[10px] leading-snug text-slate-600 line-clamp-2">
        {r.errorCode ? `${r.errorCode} · ` : ''}
        {info?.title ?? message}
      </span>
      {pos && (
        <div
          role="tooltip"
          className="fixed z-50 w-[320px] rounded-lg border border-slate-200 bg-white p-3 shadow-lg text-left whitespace-normal"
          style={{ top: pos.top, left: pos.left, transform: pos.above ? 'translateY(-100%)' : undefined }}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-md border ${badge.className}`}>{badge.label}</span>
            {r.errorCode ? <span className="font-mono text-[11px] text-slate-700">Error {r.errorCode}</span> : null}
          </div>
          {info?.title && <p className="text-[12px] font-semibold text-slate-900 mb-1">{info.title}</p>}
          {message && <p className="text-[12px] leading-snug text-slate-800">{message}</p>}
          {info?.description && info.description !== message && (
            <p className="mt-2 text-[11px] leading-snug text-slate-700">
              <span className="font-semibold text-slate-900">Why: </span>
              {info.description}
            </p>
          )}
          {info?.solution && (
            <p className="mt-1.5 text-[11px] leading-snug text-slate-700">
              <span className="font-semibold text-slate-900">What to do: </span>
              {info.solution}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const RECIPIENT_STATUS: Record<CampaignRecipientDto['status'], { label: string; className: string }> = {
  pending: { label: 'Waiting', className: 'bg-slate-100 text-slate-600 border-slate-200' },
  sending: { label: 'Sending', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  sent: { label: 'Sent', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  delivered: { label: 'Delivered', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  read: { label: 'Read', className: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  failed: { label: 'Failed', className: 'bg-red-50 text-red-600 border-red-200' },
  skipped: { label: 'Skipped', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  cancelled: { label: 'Not sent', className: 'bg-slate-100 text-slate-500 border-slate-200' },
  unknown: { label: 'Unconfirmed', className: 'bg-amber-50 text-amber-700 border-amber-200' },
};

const PRICING_MODEL: Record<string, string> = {
  PMP: 'Per message',
  CBP: 'Per conversation',
};

const titleCase = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

const RECIPIENT_FILTERS: FilterDef[] = [
  { type: 'search', key: 'q', placeholder: 'Search phone or any value…' },
  {
    type: 'select',
    key: 'status',
    label: 'Status',
    allLabel: 'All',
    options: [
      { value: 'waiting', label: 'Waiting' },
      { value: 'sent', label: 'Sent' },
      { value: 'delivered', label: 'Delivered' },
      { value: 'read', label: 'Read' },
      { value: 'failed', label: 'Failed' },
      { value: 'skipped', label: 'Skipped (opted out)' },
      { value: 'cancelled', label: 'Not sent (cancelled)' },
    ],
  },
];

/**
 * A scheduled, sending or finished campaign: everything about it, read-only, with every contact's delivery
 * status and Meta pricing. Its contacts and settings are locked once scheduled.
 */
export const CampaignDetails: React.FC<{ initial: Campaign }> = ({ initial }) => {
  const router = useRouter();
  const [campaign, setCampaign] = useState(initial);
  const c = campaign;
  const tz = c.schedule.timezone;

  const contacts = useServerTable<CampaignRecipientDto>({
    fetcher: (query) => listCampaignRecipients(initial.id, query),
    filters: RECIPIENT_FILTERS,
    defaultSort: { sortBy: 'file', sortOrder: 'asc' },
  });
  const reloadContacts = contacts.reload;

  const refresh = useCallback(async () => {
    const fresh = await getCampaign(initial.id).catch(() => null);
    if (fresh) setCampaign(fresh);
    await reloadContacts();
  }, [initial.id, reloadContacts]);

  // Status, counts and contacts update on demand: the Refresh button reloads this campaign
  const [refreshing, setRefreshing] = useState(false);
  const manualRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  const { actionsFor, confirmModal, busyId } = useCampaignActions({ onDone: refresh, onDeleted: () => router.push('/campaigns') });

  const total = c.recipientCount;
  const { sent, delivered, read, failed, skipped, unknown, pending, cancelled } = c.stats;
  const done = sent + failed + skipped + unknown + cancelled;
  const interval = c.schedule.intervalSeconds;
  const template = c.message.template;
  const fields = mappableFields(template);
  const audience = c.audience;
  const fileColumns = (audience?.columns ?? []).filter((col) => col !== audience?.phoneColumn);

  const col = createColumnHelper<CampaignRecipientDto>();
  const columns = [
    col.display({
      id: 'contact',
      header: 'Contact',
      cell: ({ row: { original: r } }) => (
        <>
          <div className="font-mono text-[12px] text-slate-800 whitespace-nowrap">{displayPhone(r.phone)}</div>
          {fileColumns[0] && r.fields[fileColumns[0]] && <div className="text-[10px] text-slate-400 truncate max-w-[180px]">{r.fields[fileColumns[0]]}</div>}
        </>
      ),
    }),
    col.display({
      id: 'status',
      header: 'Status',
      cell: ({ row: { original: r } }) => {
        const s = RECIPIENT_STATUS[r.status];
        return (
          <div className="flex flex-col items-start gap-0.5 max-w-[260px]">
            {(r.status === 'failed' || r.status === 'unknown' || r.status === 'skipped') && (r.errorMessage || r.errorCode) ? (
              <RecipientIssue recipient={r} badge={s} />
            ) : (
              <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-md border whitespace-nowrap ${s.className}`}>{s.label}</span>
            )}
            {r.status === 'pending' && r.attempts > 0 && <span className="text-[10px] text-slate-400">Retry {r.attempts + 1} pending</span>}
          </div>
        );
      },
    }),
    col.display({
      id: 'timeline',
      header: 'Sent · Delivered · Read',
      cell: ({ row: { original: r } }) =>
        r.sentAt ? (
          <div className="space-y-0.5 text-[11px] whitespace-nowrap">
            <TimeLine icon={<Send className="w-3 h-3" />} label="Sent" value={shortTime(r.sentAt, tz)} />
            {r.deliveredAt && <TimeLine icon={<CheckCheck className="w-3 h-3" />} label="Delivered" value={shortTime(r.deliveredAt, tz)} />}
            {r.readAt && <TimeLine icon={<Eye className="w-3 h-3" />} label="Read" value={shortTime(r.readAt, tz)} tone="text-emerald-700" />}
          </div>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    }),
    col.display({
      id: 'pricing',
      header: 'Pricing (Meta)',
      cell: ({ row: { original: r } }) => {
        if (!r.pricing) {
          const wasSent = r.status === 'sent' || r.status === 'delivered' || r.status === 'read';
          return <span className="text-[11px] text-slate-400">{wasSent ? 'Waiting for Meta' : '—'}</span>;
        }
        const { billable, category, model } = r.pricing;
        return (
          <div className="flex flex-col items-start gap-0.5 whitespace-nowrap">
            <span className="text-[12px] font-semibold text-slate-800">{category ? titleCase(category) : 'Unknown category'}</span>
            <span className="text-[10px] text-slate-500">
              {model ? PRICING_MODEL[model] ?? model : '—'}
              {' · '}
              {billable === false ? <span className="text-emerald-700 font-semibold">Free</span> : billable ? <span className="text-amber-700 font-semibold">Charged</span> : 'Charge unknown'}
            </span>
          </div>
        );
      },
    }),
    ...fileColumns.map((name) =>
      col.display({
        id: `field:${name}`,
        header: name,
        meta: { className: 'text-slate-600 whitespace-nowrap max-w-[220px] truncate' },
        cell: ({ row: { original: r } }) => r.fields[name] || '—',
      })
    ),
  ];

  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* ── Top bar ── */}
      <header className="shrink-0 min-h-16 px-4 sm:px-8 py-3 flex flex-wrap items-center gap-3 bg-white border-b border-slate-200">
        <button
          type="button"
          onClick={() => router.push('/campaigns')}
          className="w-8 h-8 shrink-0 rounded-lg border border-slate-200 bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-50 flex items-center justify-center cursor-pointer"
          title="Back to campaigns"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="min-w-0">
          <p className="text-[11px] text-slate-600">Campaigns / Details</p>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900 truncate">{c.name}</h1>
            <CampaignStatusPill status={c.status} />
          </div>
          <p className="text-[11px] text-slate-600">
            {c.createdBy ? `Created by ${c.createdBy.name} · ` : ''}
            {c.message.senderLabel || 'No sender'} · <span className="font-mono">{template?.name ?? 'no template'}</span>
          </p>
        </div>
        <div className="flex-1" />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={manualRefresh}
            disabled={refreshing}
            className={`${secondaryBtn} disabled:opacity-60`}
            title="Reload this campaign's status, counts and contacts"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} /> {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          {actionsFor(c).map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={a.onClick}
              disabled={busyId === c.id}
              className={`${secondaryBtn} ${a.danger ? '!text-red-600 hover:!bg-red-50' : ''}`}
            >
              {a.icon} {a.label}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
      <div className="px-4 sm:px-8 py-5 space-y-4 max-w-[1400px] mx-auto">

        <p className="flex items-start gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-[11px] font-medium text-slate-800">
          <Lock className="w-3.5 h-3.5 shrink-0 mt-px text-slate-700" />
          View-only: once scheduled, a campaign&apos;s contacts and settings can&apos;t change. To send something different, duplicate it.
        </p>

        {c.status === 'paused' && c.pauseReason && (
          <div className="px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <div>
              <p className="font-semibold">{PAUSE_REASON_LABEL[c.pauseReason]}</p>
              {c.lastError && <p className="mt-0.5 text-amber-700">{c.lastError}</p>}
            </div>
          </div>
        )}

        {/* ── Progress ── */}
        <section className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-900">Delivery</p>
            <p className="text-[11px] font-medium text-slate-700 tabular-nums">
              {formatNumber(done)} of {formatNumber(total)} processed
            </p>
          </div>
          <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden flex">
            <div className="h-full bg-emerald-500" style={{ width: `${pct(read, total)}%` }} title="Read" />
            <div className="h-full bg-emerald-300" style={{ width: `${pct(delivered - read, total)}%` }} title="Delivered" />
            <div className="h-full bg-[#3440a8]" style={{ width: `${pct(sent - delivered, total)}%` }} title="Sent" />
            <div className="h-full bg-red-400" style={{ width: `${pct(failed + unknown, total)}%` }} title="Failed" />
            <div className="h-full bg-amber-300" style={{ width: `${pct(skipped, total)}%` }} title="Skipped" />
          </div>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <Stat label="Contacts" value={total} />
            <Stat label="Sent" value={sent} hint={`${pct(sent, total)}% of contacts`} dot="bg-[#3440a8]" />
            <Stat label="Delivered" value={delivered} hint={`${pct(delivered, sent)}% of sent`} dot="bg-emerald-300" />
            <Stat label="Read" value={read} hint={`${pct(read, sent)}% of sent`} dot="bg-emerald-500" />
            <Stat label="Failed" value={failed + unknown} hint={unknown ? `${unknown} unconfirmed` : undefined} dot="bg-red-400" tone={failed + unknown ? 'red' : undefined} />
            <Stat label="Skipped" value={skipped} hint="Opted out" dot="bg-amber-300" />
            <Stat label={c.status === 'cancelled' ? 'Not sent' : 'Waiting'} value={pending + cancelled} dot="bg-slate-200" />
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* ── Message ── */}
          <Card title="Message">
            <Row label="Sender" value={c.message.senderLabel || '—'} />
            <Row label="Template" value={template ? template.name : '—'} mono />
            {template && <Row label="Language" value={template.language} />}
            {template && <Row label="Category" value={titleCase(template.category)} />}
            {fields.length > 0 && (
              <div className="py-2">
                <p className="text-xs font-medium text-slate-800 mb-1.5">Variables</p>
                <ul className="space-y-1">
                  {fields.map((f) => {
                    const source = c.message.variables[f.id];
                    return (
                      <li key={f.id} className="flex items-center justify-between gap-3 text-xs">
                        <span className="font-mono text-[11px] font-medium text-slate-800">{f.label}</span>
                        <span className="text-right font-semibold text-slate-900 break-all">
                          {!source ? '—' : source.type === 'column' ? (
                            <>
                              <span className="font-normal text-slate-700">from column </span>
                              <b>{source.column}</b>
                            </>
                          ) : (
                            <>&ldquo;{source.value}&rdquo;</>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </Card>

          {/* ── Schedule ── */}
          <Card title="Schedule">
            <Row label="Start" value={formatDateTime(c.schedule.sendAt, tz)} />
            <Row label="Delay" value={interval ? `${formatDuration(interval)} between contacts` : 'None'} />
            {interval ? <Row label="Estimated duration" value={`~${formatDuration(dispatchSeconds(total, interval))}`} /> : null}
            <Row label="Started" value={c.startedAt ? formatDateTime(c.startedAt, tz) : 'Not yet'} />
            <Row label="Finished" value={c.completedAt ? formatDateTime(c.completedAt, tz) : '—'} />
            <Row label="Time zone" value={tz} />
          </Card>

          {/* ── Contact file ── */}
          <Card title="Contact file">
            <Row label="File" value={audience?.fileName ?? '—'} />
            <Row label="Phone column" value={audience?.phoneColumn ?? '—'} />
            <Row label="Rows in file" value={audience ? formatNumber(audience.totalRows) : '—'} />
            <Row label="Valid contacts" value={formatNumber(total)} />
            <Row label="Rejected rows" value={audience ? formatNumber(audience.rejectedCount) : '—'} />
            <Row label="Duplicates removed" value={audience ? formatNumber(audience.duplicates) : '—'} />
            <Row label="Default country" value={audience?.defaultCountry || 'None'} />
          </Card>
        </div>

        {/* ── Contacts: status, timeline and pricing of each ── */}
        <section className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-2">
            <p className="text-[13px] font-bold text-slate-800">Contacts</p>
            <p className="text-[11px] text-slate-500">
              Each contact&apos;s delivery status and Meta pricing (from WhatsApp&apos;s status updates). Export logs for a CSV of all of them.
            </p>
          </div>
          <DataTable
            {...contacts.tableProps}
            paginationPosition="bottom"
            columns={columns}
            getRowId={(r) => r.id}
            errorTitle="Couldn't load contacts"
            loadingLabel="Loading contacts…"
            emptyState={(filtered) => (
              <p className="py-10 text-center text-xs text-slate-500">{filtered ? 'No contacts match these filters.' : 'No contacts.'}</p>
            )}
          />
          <p className="flex items-center gap-1.5 text-[10px] text-slate-400">
            <Clock className="w-3 h-3" />
            Pricing shows what Meta reports for each message: its category, the pricing model and whether it is charged. Meta doesn&apos;t send the
            amount; it depends on the recipient&apos;s country.
          </p>
        </section>
      </div>
      </div>
      {confirmModal}
    </div>
  );
};

const Card: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="bg-white border border-slate-200 rounded-xl p-4">
    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-900 mb-1">{title}</p>
    <dl className="divide-y divide-slate-100">{children}</dl>
  </section>
);

const Row: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="flex items-start justify-between gap-3 py-2 text-xs">
    <dt className="font-medium text-slate-800 shrink-0">{label}</dt>
    <dd className={`text-right font-semibold text-slate-900 break-all ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</dd>
  </div>
);

const Stat: React.FC<{ label: string; value: number; hint?: string; tone?: 'red'; dot?: string }> = ({ label, value, hint, tone, dot }) => (
  <div className="p-3 rounded-lg border border-slate-100 bg-slate-50/60">
    <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-800">
      {dot && <span className={`w-2 h-2 rounded-full ${dot}`} />}
      {label}
    </p>
    <p className={`mt-0.5 text-lg font-bold tabular-nums ${tone === 'red' ? 'text-red-600' : 'text-slate-900'}`}>{formatNumber(value)}</p>
    {hint && <p className="text-[10px] font-medium text-slate-700">{hint}</p>}
  </div>
);

const TimeLine: React.FC<{ icon: React.ReactNode; label: string; value: string; tone?: string }> = ({ icon, label, value, tone = 'text-slate-600' }) => (
  <div className={`flex items-center gap-1.5 ${tone}`}>
    {icon}
    <span className="w-[58px] text-slate-400">{label}</span>
    <span className="tabular-nums">{value}</span>
  </div>
);
