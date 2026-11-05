'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Download, Loader2, MessageSquare, Plus, Search, ShieldOff, Users, X } from 'lucide-react';
import { AddContactModal } from './AddContactModal';
import { apiClient } from '@/lib/api/client';
import { ErrorState, EmptyState } from '@/components/ui/states';
import { ChannelIcon } from '@/components/inbox/ChannelIcon';
import { ConsentBadge } from '@/components/inbox/ConsentStatus';
import { formatHandle, formatPhone, getInitials } from '@/components/inbox/inbox-types';
import { useRealtime } from '@/lib/hooks/useRealtime';
import {
  CONTACT_ACTIVITY_WINDOWS,
  CONTACTS_PAGE_SIZE,
  type ContactActivityWindow,
  type ContactChannelSummary,
  type ContactConsentFilter,
  type ContactListItem,
  type ContactListResponse,
} from '@/types/contacts';

const ACTIVITY_LABELS: Record<ContactActivityWindow, string> = {
  0: 'Any time',
  7: '7 days',
  30: '30 days',
  90: '90 days',
};

const CONSENT_LABELS: Record<ContactConsentFilter, string> = {
  any: 'Any',
  opted_out: 'Opted-out',
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

/** Same columns as the table: name, identity, opted out, last active */
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

/** A labelled native select styled like the filter pills */
const FilterSelect = <T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) => (
  <label className="relative flex items-center">
    <select
      value={String(value)}
      onChange={(e) => {
        const picked = options.find((o) => String(o.value) === e.target.value);
        if (picked) onChange(picked.value);
      }}
      aria-label={label}
      className="appearance-none pl-3.5 pr-9 py-2.5 text-sm bg-white border border-slate-200 rounded-xl text-slate-700 cursor-pointer hover:bg-slate-50 focus:outline-none focus:border-[#3440a8]"
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {label}: {o.label}
        </option>
      ))}
    </select>
    <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 pointer-events-none" />
  </label>
);

interface ContactsViewProps {
  /** Opens the contact's chat in the inbox; only offered for contacts with a ticket */
  onOpenConversation: (customerId: number) => void;
}

export const ContactsView: React.FC<ContactsViewProps> = ({ onOpenConversation }) => {
  // The channel the user picked; null until then, and the server lists the first channel
  const [channelId, setChannelId] = useState<number | null>(null);
  const [consent, setConsent] = useState<ContactConsentFilter>('any');
  const [activeDays, setActiveDays] = useState<ContactActivityWindow>(0);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [data, setData] = useState<ContactListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [selected, setSelected] = useState<Map<number, ContactListItem>>(new Map());
  const [showAddContact, setShowAddContact] = useState(false);
  const requestRef = useRef(0);

  // Search as you type, without a request per keystroke
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // A new filter starts from the first page with nothing selected
  useEffect(() => {
    setPage(1);
    setSelected(new Map());
  }, [channelId, consent, activeDays, search]);

  const fetchContacts = useCallback(
    async ({ silent = false } = {}) => {
      const requestId = ++requestRef.current;
      if (!silent) setIsLoading(true);
      try {
        const res = await apiClient.get<ContactListResponse>('/api/contacts', {
          params: {
            channelId: channelId ?? undefined,
            consent,
            activeDays,
            q: search || undefined,
            page,
            pageSize: CONTACTS_PAGE_SIZE,
          },
        });
        if (requestId !== requestRef.current) return;
        setData(res.data);
        setLoadError(null);
        // The picked channel was disconnected: fall back to the first channel
        if (channelId !== null && !res.data.channels.some((c) => c.id === channelId)) setChannelId(null);
        // Past the last page (contacts left the filter since): go to the new last page
        else if (page > 1 && res.data.contacts.length === 0 && res.data.total > 0) {
          setPage(Math.ceil(res.data.total / CONTACTS_PAGE_SIZE));
        }
      } catch (err) {
        if (requestId !== requestRef.current) return;
        if (!silent) setLoadError(err);
      } finally {
        if (requestId === requestRef.current) setIsLoading(false);
      }
    },
    [channelId, consent, activeDays, search, page]
  );

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  // A customer replied STOP / START (or a teammate changed it): refresh the statuses and counts
  useRealtime({ onCustomerConsent: () => fetchContacts({ silent: true }) });

  const channels = data?.channels ?? [];
  const contacts = data?.contacts ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / CONTACTS_PAGE_SIZE));
  // The server lists the first channel until one is picked
  const currentChannel = channels.find((c) => c.id === data?.channelId) ?? null;
  const optedOutCount = currentChannel?.optedOut ?? 0;
  const isFiltered = consent !== 'any' || activeDays !== 0 || Boolean(search);

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

  const firstShown = total === 0 ? 0 : (page - 1) * CONTACTS_PAGE_SIZE + 1;
  const lastShown = Math.min(total, page * CONTACTS_PAGE_SIZE);

  return (
    <div className="h-full flex flex-col bg-slate-50">
      <header className="h-16 shrink-0 px-4 sm:px-8 flex items-center justify-between gap-4 bg-white border-b border-slate-200">
        <h1 className="text-xl font-bold text-slate-900">Contacts</h1>
        <button
          type="button"
          onClick={() => setShowAddContact(true)}
          disabled={!data}
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
          else fetchContacts({ silent: true });
        }}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-4 pt-6 pb-10">
          {/* ── Channel tabs ── */}
          {data && channels.length > 0 && (
            <nav className="flex gap-2.5 overflow-x-auto pb-1" aria-label="Channels">
              {channels.map((ch) => {
                const active = ch.id === currentChannel?.id;
                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => setChannelId(ch.id)}
                    aria-pressed={active}
                    className={`shrink-0 min-w-[200px] text-left px-3.5 py-3 rounded-xl border transition-colors cursor-pointer ${active ? 'border-[#3440a8] bg-[#eef0fb]' : 'border-slate-200 bg-white hover:bg-slate-50'
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
          {currentChannel && optedOutCount > 0 && consent !== 'opted_out' && (
            <div className="mt-4 px-4 py-3 rounded-xl border border-red-200 bg-red-50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
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
                onClick={() => setConsent('opted_out')}
                className="shrink-0 text-[13px] font-semibold text-red-700 hover:underline cursor-pointer text-left"
              >
                Show opted-out
              </button>
            </div>
          )}

          {/* ── Filters ── */}
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={`Search ${nf.format(currentChannel?.total ?? 0)} contacts`}
                className="w-full pl-10 pr-9 py-2.5 text-sm bg-white border border-slate-200 rounded-xl text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#3440a8]"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => setSearchInput('')}
                  title="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <FilterSelect
              label="Consent"
              value={consent}
              onChange={setConsent}
              options={(Object.keys(CONSENT_LABELS) as ContactConsentFilter[]).map((v) => ({ value: v, label: CONSENT_LABELS[v] }))}
            />
            <FilterSelect
              label="Last active"
              value={activeDays}
              onChange={setActiveDays}
              options={CONTACT_ACTIVITY_WINDOWS.map((v) => ({ value: v, label: ACTIVITY_LABELS[v] }))}
            />
            {isFiltered && (
              <button
                type="button"
                onClick={() => {
                  setConsent('any');
                  setActiveDays(0);
                  setSearchInput('');
                }}
                className="text-[13px] font-semibold text-[#3440a8] hover:underline cursor-pointer px-1"
              >
                Clear filters
              </button>
            )}
          </div>

          {/* ── Bulk actions ── */}
          {selected.size > 0 && (
            <div className="mt-4 px-4 py-2.5 rounded-xl bg-[#eef0fb] flex items-center gap-5 text-[13px]">
              <span className="font-semibold text-[#3440a8]">{nf.format(selected.size)} selected</span>
              <button
                type="button"
                onClick={() => exportCsv([...selected.values()])}
                className="inline-flex items-center gap-1.5 font-semibold text-[#3440a8] hover:underline cursor-pointer"
              >
                <Download className="w-4 h-4" />
                Export CSV
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Map())}
                className="ml-auto text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                Clear selection
              </button>
            </div>
          )}

          {/* ── Table ── */}
          <div className="mt-4 bg-white rounded-xl border border-slate-200 overflow-hidden">
            {loadError && !data ? (
              <ErrorState error={loadError} title="Couldn't load contacts" onRetry={() => fetchContacts()} retrying={isLoading} />
            ) : !data && isLoading ? (
              <div className="py-20 flex items-center justify-center text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : contacts.length === 0 ? (
              <EmptyState
                icon={<Users className="w-6 h-6" />}
                title={isFiltered ? 'No contacts match these filters' : channels.length === 0 ? 'No channels connected' : 'No contacts yet'}
                description={
                  isFiltered
                    ? 'Try a different search, consent or last active filter.'
                    : channels.length === 0
                      ? 'Connect a WhatsApp number or another channel in Settings to start collecting contacts.'
                      : 'Contacts appear here when customers message you on this channel.'
                }
              />
            ) : (
              <div className={`overflow-x-auto transition-opacity ${isLoading ? 'opacity-60' : ''}`}>
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="bg-slate-50/80 border-b border-slate-200 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      <th className="w-12 pl-5 py-3.5">
                        <input
                          type="checkbox"
                          checked={pageAllSelected}
                          onChange={togglePage}
                          aria-label="Select all on this page"
                          className="w-4 h-4 accent-[#3440a8] cursor-pointer align-middle"
                        />
                      </th>
                      <th className="px-4 py-3.5">Contact</th>
                      <th className="px-4 py-3.5">Identity</th>
                      <th className="px-4 py-3.5">Consent</th>
                      <th className="px-4 py-3.5 text-right">Last active</th>
                      <th className="px-4 py-3.5 pr-6 text-right">
                        <span className="sr-only">Chat</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {contacts.map((c) => {
                      const optedOut = tracksConsent(c.channel.type) && c.isOptedOut;
                      return (
                        <tr
                          key={c.id}
                          onClick={() => onOpenConversation(c.id)}
                          title={`Open chat with ${c.name}`}
                          className={`border-b border-slate-100 last:border-b-0 cursor-pointer ${optedOut ? 'bg-red-50/40 hover:bg-red-50/70' : 'hover:bg-slate-50/70'
                            }`}
                        >
                          <td
                            onClick={(e) => e.stopPropagation()}
                            className={`pl-5 py-3.5 ${optedOut ? 'border-l-[3px] border-l-red-400' : 'border-l-[3px] border-l-transparent'}`}
                          >
                            <input
                              type="checkbox"
                              checked={selected.has(c.id)}
                              onChange={() => toggleOne(c)}
                              aria-label={`Select ${c.name}`}
                              className="w-4 h-4 accent-[#3440a8] cursor-pointer align-middle"
                            />
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-3 min-w-0">
                              {c.avatarUrl ? (
                                <img src={c.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
                              ) : (
                                <span className="w-9 h-9 rounded-full bg-[#fde8ef] text-[#c0365f] text-xs font-semibold flex items-center justify-center shrink-0">
                                  {getInitials(c.name)}
                                </span>
                              )}
                              <span className="font-medium text-slate-900 truncate max-w-[220px]">{c.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3.5 font-mono text-[13px] text-slate-700 whitespace-nowrap">{identityOf(c)}</td>
                          <td className="px-4 py-3.5">
                            {optedOut && <ConsentBadge isOptedOut />}
                          </td>
                          <td className="px-4 py-3.5 text-right text-slate-600 whitespace-nowrap" title={c.lastActiveAt ? new Date(c.lastActiveAt).toLocaleString() : undefined}>
                            {formatLastActive(c.lastActiveAt)}
                          </td>
                          <td className="px-4 py-3.5 pr-6 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenConversation(c.id);
                              }}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-[12px] font-semibold text-[#3440a8] hover:bg-[#eef0fb] cursor-pointer"
                            >
                              <MessageSquare className="w-3.5 h-3.5" />
                              Open chat
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Pagination ── */}
          {data && total > 0 && (
            <div className="mt-4 flex items-center justify-between gap-4 text-[13px] text-slate-500">
              <span>
                Showing {nf.format(firstShown)}–{nf.format(lastShown)} of {nf.format(total)}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || isLoading}
                  title="Previous page"
                  className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="px-2 text-slate-600">
                  Page {nf.format(page)} of {nf.format(pageCount)}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={page >= pageCount || isLoading}
                  title="Next page"
                  className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
