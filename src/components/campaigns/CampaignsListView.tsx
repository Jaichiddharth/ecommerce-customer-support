'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, Megaphone, Pencil, Plus, RefreshCw } from 'lucide-react';
import {
  DataTable,
  EMPTY_DATE_RANGE,
  createColumnHelper,
  dateRangeToInstants,
  type DateRangeValue,
  type FilterDef,
  type FilterValues,
} from '@/components/ui/data-table';
import { iconBtn, primaryBtn, secondaryBtn } from '@/components/ui/controls';
import { EmptyState } from '@/components/ui/states';
import { useCampaignActions } from './campaign-actions';
import { listCampaigns } from './campaign-store';
import { CampaignStatusPill, formatDateTime, formatNumber } from './ui';
import { isEditable, PAUSE_REASON_LABEL, type Campaign } from './types';

const FILTERS: FilterDef[] = [
  { type: 'search', key: 'q', placeholder: 'Search campaigns…' },
  {
    type: 'select',
    key: 'status',
    label: 'Status',
    allLabel: 'All',
    options: [
      { value: 'draft', label: 'Draft' },
      { value: 'scheduled', label: 'Scheduled' },
      { value: 'running', label: 'Sending' },
      { value: 'paused', label: 'Paused' },
      { value: 'completed', label: 'Completed' },
      { value: 'cancelled', label: 'Cancelled' },
      { value: 'failed', label: 'Failed' },
    ],
  },
  { type: 'dateRange', key: 'createdAt', label: 'Created' },
];

const EMPTY_FILTERS: FilterValues = { q: '', status: '', createdAt: EMPTY_DATE_RANGE };

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** Drafts, active (sending / scheduled) and paused campaigns always stay above finished ones */
const PIN_ORDER: Partial<Record<Campaign['status'], number>> = { draft: 0, running: 1, scheduled: 1, paused: 2 };
const pinRank = (c: Campaign) => PIN_ORDER[c.status] ?? 3;

const ProgressCell: React.FC<{ campaign: Campaign }> = ({ campaign }) => {
  const total = campaign.recipientCount;
  const { sent, delivered, read, failed, skipped, unknown } = campaign.stats;
  if (campaign.status === 'draft' || campaign.status === 'scheduled' || total === 0) return <span className="text-slate-400">—</span>;
  const done = sent + failed + skipped + unknown;
  return (
    <div className="min-w-[150px]">
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden flex">
        <div className="h-full bg-[#3440a8]" style={{ width: `${pct(sent, total)}%` }} />
        <div className="h-full bg-red-400" style={{ width: `${pct(failed + unknown, total)}%` }} />
      </div>
      <p className="mt-1 text-[10px] text-slate-600 tabular-nums whitespace-nowrap" title={`${sent} sent · ${failed} failed · ${skipped} skipped · ${unknown} unconfirmed`}>
        {formatNumber(done)}/{formatNumber(total)} · {pct(delivered, sent)}% delivered · {pct(read, sent)}% read
      </p>
    </div>
  );
};

export const CampaignsListView: React.FC = () => {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterValues>(EMPTY_FILTERS);

  const refresh = useCallback(async () => {
    try {
      setCampaigns(await listCampaigns());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Couldn't load campaigns");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Status and progress update on demand: the Refresh button reloads every campaign
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

  const { actionsFor, confirmModal, busyId, canCreate, canUpdate } = useCampaignActions({ onDone: refresh });

  const rows = useMemo(() => {
    const q = String(filters.q ?? '').trim().toLowerCase();
    const status = String(filters.status ?? '');
    const { from, to } = dateRangeToInstants((filters.createdAt as DateRangeValue) ?? EMPTY_DATE_RANGE);
    return campaigns.filter(
      (c) =>
        (!q || c.name.toLowerCase().includes(q) || c.message.template?.name.toLowerCase().includes(q)) &&
        (!status || c.status === status) &&
        (!from || c.createdAt >= from) &&
        (!to || c.createdAt <= to)
    );
  }, [campaigns, filters]);

  const hasActiveFilters =
    String(filters.q ?? '').trim() !== '' || filters.status !== '' || (filters.createdAt as DateRangeValue)?.preset !== '';

  const open = (c: Campaign) => router.push(`/campaigns/${c.id}`);

  const col = createColumnHelper<Campaign>();
  const columns = [
    col.accessor('name', {
      header: 'Campaign',
      enableSorting: true,
      meta: { className: 'w-[260px] max-w-[260px]' },
      cell: ({ row: { original: c } }) => (
        <div className="min-w-0 max-w-[260px]">
          <button
            className="block w-full truncate font-semibold text-slate-800 hover:text-[#3440a8] text-left cursor-pointer"
            title={c.name || undefined}
            onClick={() => open(c)}
          >
            {c.name || 'Untitled campaign'}
          </button>
          <div className="truncate text-[10px] text-slate-500 font-mono" title={c.message.template?.name}>
            {c.message.template?.name ?? 'No template yet'}
          </div>
        </div>
      ),
    }),
    col.accessor('status', {
      header: 'Status',
      enableSorting: true,
      cell: ({ row: { original: c } }) => (
        <div className="flex flex-col items-start gap-0.5">
          <CampaignStatusPill status={c.status} />
          {c.status === 'paused' && c.pauseReason && c.pauseReason !== 'manual' && (
            <span className="max-w-[220px] text-[10px] leading-snug text-amber-700" title={c.lastError ?? undefined}>
              {PAUSE_REASON_LABEL[c.pauseReason]}
            </span>
          )}
        </div>
      ),
    }),
    col.accessor((c) => c.recipientCount, {
      id: 'recipients',
      header: 'Contacts',
      enableSorting: true,
      sortDescFirst: true,
      meta: { align: 'center', className: 'tabular-nums' },
      cell: ({ getValue }) => formatNumber(getValue()),
    }),
    col.display({ id: 'progress', header: 'Progress', cell: ({ row: { original: c } }) => <ProgressCell campaign={c} /> }),

    col.accessor((c) => c.createdBy?.name ?? '', {
      id: 'createdBy',
      header: 'Created by',
      enableSorting: true,
      meta: { className: 'text-slate-700 whitespace-nowrap', headerClassName: 'whitespace-nowrap' },
      cell: ({ getValue }) => getValue() || '—',
    }),

    col.accessor((c) => c.schedule.sendAt ?? '', {
      id: 'sendAt',
      header: 'Starts',
      enableSorting: true,
      sortDescFirst: true,
      meta: { className: 'text-slate-700 whitespace-nowrap', headerClassName: 'whitespace-nowrap' },
      cell: ({ row: { original: c } }) => (c.schedule.sendAt ? formatDateTime(c.schedule.sendAt, c.schedule.timezone) : '—'),
    }),
    col.accessor((c) => c.completedAt ?? '', {
      id: 'completedAt',
      header: 'Completed',
      enableSorting: true,
      sortDescFirst: true,
      meta: { className: 'text-slate-700 whitespace-nowrap', headerClassName: 'whitespace-nowrap' },
      cell: ({ row: { original: c } }) => (c.completedAt ? formatDateTime(c.completedAt, c.schedule.timezone) : '—'),
    }),
    col.display({
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row: { original: c } }) => {
        const busy = busyId === c.id;
        const editable = isEditable(c.status);
        return (
          <div className="flex items-center justify-end gap-0.5">
            {editable ? (
              <button
                className={`${iconBtn} ${!canUpdate ? 'opacity-40 cursor-not-allowed' : ''}`}
                disabled={!canUpdate}
                title={canUpdate ? 'Edit' : 'You do not have permission to edit campaigns'}
                onClick={canUpdate ? () => open(c) : undefined}
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button className={iconBtn} title="View details" onClick={() => open(c)}>
                <Eye className="w-3.5 h-3.5" />
              </button>
            )}
            {actionsFor(c).map((a) => (
              <button key={a.key} className={`${iconBtn} ${a.danger ? 'hover:!text-red-500' : ''}`} title={a.label} disabled={busy} onClick={a.onClick}>
                {a.icon}
              </button>
            ))}
          </div>
        );
      },
    }),
  ];

  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* ── Top bar ── */}
      <header className="h-16 shrink-0 px-4 sm:px-8 flex items-center justify-between gap-4 bg-white border-b border-slate-200">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900">Campaigns</h1>
          <p className="hidden sm:block text-[11px] text-slate-600 truncate">
            Send an approved WhatsApp template to a contact list at a scheduled time. One campaign runs at a time per workspace.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          className={`${secondaryBtn} disabled:opacity-60`}
          onClick={manualRefresh}
          disabled={refreshing || isLoading}
          title="Reload every campaign's status and progress"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} /> {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
        <button
          className={`${primaryBtn} shrink-0 ${!canCreate ? 'opacity-50 cursor-not-allowed' : ''}`}
          disabled={!canCreate}
          title={!canCreate ? 'You do not have permission to create campaigns' : undefined}
          onClick={canCreate ? () => router.push('/campaigns/new') : undefined}
        >
          <Plus className="w-3.5 h-3.5" /> Create campaign
        </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
      <div className="px-4 sm:px-8 py-5 space-y-4 max-w-[1400px] mx-auto">
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(c) => c.id}
          initialSort={{ sortBy: 'sendAt', sortOrder: 'desc' }}
          pinRank={pinRank}
          showPagination="always"
          paginationPosition="bottom"
          loading={isLoading}
          loadingLabel="Loading campaigns…"
          error={loadError && campaigns.length === 0 ? loadError : null}
          errorTitle="Couldn't load campaigns"
          onRetry={refresh}
          filters={FILTERS}
          filterValues={filters}
          onFilterChange={(key, value) => setFilters((f) => ({ ...f, [key]: value }))}
          onClearFilters={() => setFilters(EMPTY_FILTERS)}
          hasActiveFilters={hasActiveFilters}
          rowClassName={(c) => `hover:bg-slate-50/60 ${busyId === c.id ? 'opacity-60' : ''}`}
          emptyState={(filtered) => (
            <EmptyState
              icon={<Megaphone className="w-9 h-9 text-slate-300" />}
              title={filtered ? 'No campaigns match these filters' : 'No campaigns yet'}
              description={filtered ? 'Try a different search, status or date.' : 'Upload a contact list, pick an approved template and schedule your first campaign.'}
              action={
                !filtered && canCreate ? (
                  <button className={primaryBtn} onClick={() => router.push('/campaigns/new')}>
                    <Plus className="w-3.5 h-3.5" /> Create campaign
                  </button>
                ) : undefined
              }
            />
          )}
        />
      </div>
      </div>
      {confirmModal}
    </div>
  );
};
