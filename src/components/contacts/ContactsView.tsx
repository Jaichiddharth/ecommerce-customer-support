'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Download, MessageSquare, Plus, ShieldOff, Users } from 'lucide-react';
import { AddContactModal } from './AddContactModal';
import { apiClient } from '@/lib/api/client';
import { EmptyState } from '@/components/ui/states';
import { DataTable, createColumnHelper, useServerTable, type FilterDef } from '@/components/ui/data-table';
import { ChannelIcon } from '@/components/inbox/ChannelIcon';
import { ConsentBadge } from '@/components/inbox/ConsentStatus';
import { formatHandle, formatPhone, getInitials } from '@/components/inbox/inbox-types';
import { useRealtime } from '@/lib/hooks/useRealtime';
import {
  CONTACT_ACTIVITY_WINDOWS,
  CONTACTS_PAGE_SIZE,
  type ContactActivityWindow,
  type ContactChannelSummary,
  type ContactListItem,
  type ContactListResponse,
} from '@/types/contacts';

const ACTIVITY_LABELS: Record<ContactActivityWindow, string> = {
  0: 'Any time',
  7: '7 days',
  30: '30 days',
  90: '90 days',
};

/** Consent (STOP / START) is tracked for WhatsApp numbers only */
const tracksConsent = (channelType: string) => channelType === 'whatsapp';

/** How the contact is identified on its channel: phone, handle or email */
const identityOf = (c: ContactListItem) => formatPhone(c.phone) || formatHandle(c.handle) || c.email || '—';

/** The number as Meta formats it ("+1 555-965-7654"), the handle, or the channel type; tells same-named channels apart */
const channelSubtitle = (ch: ContactChannelSummary) =>
  (/[\s-]/.test(ch.phoneNumber ?? '') ? ch.phoneNumber : formatPhone(ch.phoneNumber)) || formatHandle(ch.handle) || ch.type;

const formatLastActive = (iso: string | null) => {
  if (!iso) return 'No messages yet';
  const then = new Date(iso);
  const diff = Date.now() - then.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString([], { day: 'numeric', month: 'short', year: days > 300 ? 'numeric' : undefined });
};

const formatAdded = (iso: string) =>
  new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

const nf = new Intl.NumberFormat('en-IN');

/** Quotes a CSV field and stops spreadsheets from running it as a formula */
const csvField = (value: string) => {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
};

/**
 * A phone number Excel keeps as text: written as ="+91 75399 12802" so it isn't turned into 9.18E+11 or read as a
 * formula. Only digits, spaces and a leading + get here, so nothing can be injected.
 */
const csvPhone = (phone: string) => (/^\+?[\d ]+$/.test(phone) ? `"=""${phone}"""` : csvField(phone));

/** "2026-11-04 16:39" in local time, which spreadsheets read as a date */
const csvDate = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Name, identity, opted out, last active */
const exportCsv = (rows: ContactListItem[]) => {
  const identityHeader = rows.every((c) => c.phone) ? 'Phone' : 'Phone / handle / email';
  const header = ['Name', identityHeader, 'Opted out', 'Last active'];
  const lines = rows.map((c) => {
    const phone = formatPhone(c.phone);
    return [
      csvField(c.name),
      phone ? csvPhone(phone) : csvField(formatHandle(c.handle) || c.email || ''),
      csvField(tracksConsent(c.channel.type) && c.isOptedOut ? 'Yes' : ''),
      csvField(csvDate(c.lastActiveAt)),
    ].join(',');
  });
  const blob = new Blob(['﻿' + [header.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

const col = createColumnHelper<ContactListItem>();

/** Shared-table filters; keys are the /api/contacts query params */
const buildFilters = (contactCount: number): FilterDef[] => [
  { type: 'search', key: 'q', placeholder: `Search ${nf.format(contactCount)} contacts` },
  { type: 'select', key: 'consent', label: 'Consent', allLabel: 'Any', options: [{ value: 'opted_out', label: 'Opted out' }] },
  {
    type: 'select',
    key: 'activeDays',
    label: 'Last active',
    allLabel: ACTIVITY_LABELS[0],
    options: CONTACT_ACTIVITY_WINDOWS.filter((d) => d !== 0).map((d) => ({ value: String(d), label: ACTIVITY_LABELS[d] })),
  },
];

const checkboxCls = 'w-4 h-4 accent-[#3440a8] cursor-pointer align-middle';

interface ContactsViewProps {
  /** Opens the contact's chat in the inbox; only offered for contacts with a ticket */
  onOpenConversation: (customerId: number) => void;
}

export const ContactsView: React.FC<ContactsViewProps> = ({ onOpenConversation }) => {
  // The channel the user picked; null until then, and the server lists the first channel
  const [channelId, setChannelId] = useState<number | null>(null);
  // From the latest response: every live channel with its counts, and the channel listed
  const [channels, setChannels] = useState<ContactChannelSummary[]>([]);
  const [listedChannelId, setListedChannelId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Map<number, ContactListItem>>(new Map());
  const [showAddContact, setShowAddContact] = useState(false);
  // The table ignores out-of-order responses; the channel summaries must follow the same response
  const requestSeq = useRef(0);

  const currentChannel = channels.find((c) => c.id === listedChannelId) ?? null;

  const table = useServerTable<ContactListItem>({
    filters: buildFilters(currentChannel?.total ?? 0),
    defaultSort: { sortBy: 'lastActiveAt', sortOrder: 'desc' },
    defaultLimit: CONTACTS_PAGE_SIZE,
    baseParams: { channelId: channelId ?? undefined },
    fetcher: async (query) => {
      const seq = ++requestSeq.current;
      const { data } = await apiClient.get<ContactListResponse>('/api/contacts', { params: query });
      if (seq === requestSeq.current) {
        setChannels(data.channels);
        setListedChannelId(data.channelId);
        // The picked channel was disconnected: fall back to the first channel
        if (channelId !== null && !data.channels.some((c) => c.id === channelId)) setChannelId(null);
      }
      return { items: data.contacts, pagination: data.pagination };
    },
  });

  // A new channel or filter starts with nothing selected
  const filterKey = JSON.stringify(table.filterValues);
  useEffect(() => {
    setSelected(new Map());
  }, [channelId, filterKey]);

  // A customer replied STOP / START (or a teammate changed it): refresh the statuses and counts
  useRealtime({ onCustomerConsent: () => table.reload() });

  const contacts = table.rows;
  const loaded = table.pagination !== null;
  const optedOutCount = currentChannel?.optedOut ?? 0;
  const showingOptedOut = table.filterValues.consent === 'opted_out';

  const pageAllSelected = contacts.length > 0 && contacts.every((c) => selected.has(c.id));
  const togglePage = () =>
    setSelected((prev) => {
      const next = new Map(prev);
      contacts.forEach((c) => (pageAllSelected ? next.delete(c.id) : next.set(c.id, c)));
      return next;
    });
  const toggleOne = (c: ContactListItem) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(c.id)) next.delete(c.id);
      else next.set(c.id, c);
      return next;
    });

  const isOptedOut = (c: ContactListItem) => tracksConsent(c.channel.type) && c.isOptedOut;

  const columns = [
    col.display({
      id: 'select',
      header: () => (
        <input
          type="checkbox"
          checked={pageAllSelected}
          onChange={togglePage}
          aria-label="Select all on this page"
          className={checkboxCls}
        />
      ),
      meta: { className: 'w-10', headerClassName: 'w-10' },
      cell: ({ row: { original: c } }) => (
        <span onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected.has(c.id)}
            onChange={() => toggleOne(c)}
            aria-label={`Select ${c.name}`}
            className={checkboxCls}
          />
        </span>
      ),
    }),
    col.accessor('name', {
      header: 'Contact',
      enableSorting: true,
      cell: ({ row: { original: c } }) => (
        <div className="flex items-center gap-2.5 min-w-0">
          {c.avatarUrl ? (
            <img src={c.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
          ) : (
            <span className="w-8 h-8 rounded-full bg-[#fde8ef] text-[#c0365f] text-[11px] font-semibold flex items-center justify-center shrink-0">
              {getInitials(c.name)}
            </span>
          )}
          <span className="font-semibold text-slate-800 truncate max-w-[220px]">{c.name}</span>
        </div>
      ),
    }),
    col.display({
      id: 'identity',
      header: 'Identity',
      meta: { className: 'font-mono text-slate-700 whitespace-nowrap' },
      cell: ({ row: { original: c } }) => identityOf(c),
    }),
    col.display({
      id: 'consent',
      header: 'Consent',
      cell: ({ row: { original: c } }) => (isOptedOut(c) ? <ConsentBadge isOptedOut /> : null),
    }),
    col.accessor('lastActiveAt', {
      header: 'Last active',
      enableSorting: true,
      sortDescFirst: true,
      meta: { align: 'right', className: 'text-slate-600 whitespace-nowrap' },
      cell: ({ getValue }) => {
        const iso = getValue();
        return <span title={iso ? new Date(iso).toLocaleString() : undefined}>{formatLastActive(iso)}</span>;
      },
    }),
    col.accessor('createdAt', {
      header: 'Added',
      enableSorting: true,
      sortDescFirst: true,
      meta: { align: 'right', className: 'text-slate-500 whitespace-nowrap' },
      cell: ({ getValue }) => formatAdded(getValue()),
    }),
    col.display({
      id: 'chat',
      header: () => <span className="sr-only">Chat</span>,
      meta: { align: 'right', className: 'whitespace-nowrap' },
      cell: ({ row: { original: c } }) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenConversation(c.id);
          }}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-semibold text-[#3440a8] hover:bg-[#eef0fb] cursor-pointer"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          Open chat
        </button>
      ),
    }),
  ];

  return (
    <div className="h-full flex flex-col bg-slate-50">
      <header className="h-16 shrink-0 px-4 sm:px-8 flex items-center justify-between gap-4 bg-white border-b border-slate-200">
        <h1 className="text-xl font-bold text-slate-900">Contacts</h1>
        <button
          type="button"
          onClick={() => setShowAddContact(true)}
          disabled={!loaded}
          className="px-4 py-2.5 text-sm font-semibold rounded-xl bg-[#3440a8] hover:bg-[#2b358d] text-white transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="w-4 h-4" />
          Add contact
        </button>
      </header>

      <AddContactModal
        isOpen={showAddContact}
        onClose={() => setShowAddContact(false)}
        channels={channels}
        defaultChannelId={currentChannel?.id ?? null}
        onAdded={(addedTo) => {
          // Show the number the contact was added to; the new contact (with its new conversation) lists at the top
          if (addedTo !== currentChannel?.id) setChannelId(addedTo);
          else table.reload();
        }}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-4 pt-6 pb-10 space-y-4">
          {/* ── Channel tabs ── */}
          {channels.length > 0 && (
            <nav className="flex gap-2.5 overflow-x-auto pb-1" aria-label="Channels">
              {channels.map((ch) => {
                const active = ch.id === currentChannel?.id;
                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => setChannelId(ch.id)}
                    aria-pressed={active}
                    className={`shrink-0 min-w-[200px] text-left px-3.5 py-3 rounded-xl border transition-colors cursor-pointer ${
                      active ? 'border-[#3440a8] bg-[#eef0fb]' : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <ChannelIcon type={ch.type} size="md" />
                      <div className="min-w-0">
                        <p className={`text-[13px] font-semibold truncate ${active ? 'text-[#3440a8]' : 'text-slate-900'}`}>{ch.name}</p>
                        <p className="text-[11px] text-slate-500 truncate">{channelSubtitle(ch)}</p>
                      </div>
                    </div>
                    <div className="mt-2.5 flex items-center gap-2 text-[12px]">
                      <span className="font-semibold text-slate-800">{nf.format(ch.total)} contacts</span>
                      {ch.optedOut > 0 && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-50 text-red-700 font-medium">
                          <ShieldOff className="w-3 h-3" />
                          {nf.format(ch.optedOut)} opted out
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </nav>
          )}

          {/* ── Opted-out notice ── */}
          {currentChannel && optedOutCount > 0 && !showingOptedOut && (
            <div className="px-4 py-3 rounded-xl border border-red-200 bg-red-50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <p className="text-[13px] text-red-800 flex items-start gap-2">
                <ShieldOff className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  <strong>{nf.format(optedOutCount)}</strong> {optedOutCount === 1 ? 'contact has' : 'contacts have'} opted out
                  on {currentChannel.name} ({channelSubtitle(currentChannel)}). Nothing can be sent to them, not even templates
                  or campaigns, until they reply START.
                </span>
              </p>
              <button
                type="button"
                onClick={() => table.setFilter('consent', 'opted_out')}
                className="shrink-0 text-[13px] font-semibold text-red-700 hover:underline cursor-pointer text-left"
              >
                Show opted-out
              </button>
            </div>
          )}

          {/* ── Table (shared TanStack DataTable: filters, sorting and pagination run on the server) ── */}
          <DataTable
            {...table.tableProps}
            columns={columns}
            getRowId={(c) => c.id}
            paginationPosition="bottom"
            onRowClick={(c) => onOpenConversation(c.id)}
            rowClassName={(c) =>
              isOptedOut(c)
                ? 'bg-red-50/40 hover:bg-red-50/70 shadow-[inset_3px_0_0_#f87171]'
                : selected.has(c.id)
                  ? 'bg-[#eef0fb]/60 hover:bg-[#eef0fb]'
                  : 'hover:bg-slate-50/60'
            }
            errorTitle="Couldn't load contacts"
            loadingLabel="Loading contacts…"
            toolbar={
              selected.size > 0 ? (
                <div className="ml-auto flex items-center gap-4 h-[34px] px-3 rounded-lg bg-[#eef0fb] text-[12px]">
                  <span className="font-semibold text-[#3440a8]">{nf.format(selected.size)} selected</span>
                  <button
                    type="button"
                    onClick={() => exportCsv([...selected.values()])}
                    className="inline-flex items-center gap-1.5 font-semibold text-[#3440a8] hover:underline cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export CSV
                  </button>
                  <button type="button" onClick={() => setSelected(new Map())} className="text-slate-600 hover:text-slate-900 cursor-pointer">
                    Clear selection
                  </button>
                </div>
              ) : undefined
            }
            emptyState={(filtered) => (
              <EmptyState
                icon={<Users className="w-6 h-6" />}
                title={filtered ? 'No contacts match these filters' : channels.length === 0 ? 'No channels connected' : 'No contacts yet'}
                description={
                  filtered
                    ? 'Try a different search, consent or last active filter.'
                    : channels.length === 0
                      ? 'Connect a WhatsApp number or another channel in Settings to start collecting contacts.'
                      : 'Contacts appear here when customers message you on this channel.'
                }
              />
            )}
          />
        </div>
      </div>
    </div>
  );
};
