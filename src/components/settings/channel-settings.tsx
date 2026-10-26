'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Loader2, Unplug } from 'lucide-react';

import apiClient from '@/lib/api/client';
import { notifyError } from '@/lib/api/notify';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { formatPhone } from '../inbox/inbox-types';

/** Row returned by GET /api/channels (disconnected channels are never returned) */
export interface Channel {
  id: number;
  type: string;
  verified_name: string;
  handle?: string | null;
  phoneNumber?: string | null;
  metaPhoneNumberId?: string | null;
  wabaId?: string | null;
  status: string;
  tokenExpiresAt?: string | null;
  lastError?: string | null;
  isActive: boolean;
  name_status?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;

export const STATUS_META: Record<string, { label: string; dot: string; pill: string }> = {
  connected: { label: 'Connected', dot: 'bg-emerald-500', pill: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  token_expired: { label: 'Token expired', dot: 'bg-amber-500', pill: 'bg-amber-50 text-amber-700 border-amber-200' },
  error: { label: 'Error', dot: 'bg-red-500', pill: 'bg-red-50 text-red-700 border-red-200' },
  disconnected: { label: 'Disconnected', dot: 'bg-slate-400', pill: 'bg-slate-100 text-slate-600 border-slate-200' },
};

export const needsReconnect = (ch: Channel) =>
  ch.status === 'token_expired' || ch.status === 'error' || ch.status === 'disconnected';

// ─── DisconnectDialog ─────────────────────────────────────────────────────────

export function DisconnectDialog({
  channel,
  busy,
  onConfirm,
  onCancel,
}: {
  channel: Channel;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const number = formatPhone(channel.phoneNumber) || channel.verified_name;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div role="alertdialog" aria-modal="true" className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-6">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <Unplug className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900">Disconnect {number}?</h3>
            <p className="mt-0.5 text-xs text-slate-500">{channel.verified_name}</p>
          </div>
        </div>

        {/* Warning banner */}
        <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200/80 text-amber-900">
          <p className="text-xs font-semibold flex items-center gap-1.5 text-amber-800">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            This will pause messaging from this number.
          </p>
          <p className="mt-1 text-[12px] text-amber-700 leading-relaxed">
            You will not be able to send or receive messages on this number until it is reconnected.
          </p>
        </div>

        <ul className="mt-3.5 space-y-2 text-[13px] text-slate-600">
          <li className="flex gap-2">
            <span className="mt-2 w-1 h-1 rounded-full bg-slate-400 shrink-0" />
            <span>The access token will be removed from UnoCX and messaging will be paused.</span>
          </li>
          <li className="flex gap-2">
            <span className="mt-2 w-1 h-1 rounded-full bg-slate-400 shrink-0" />
            <span>Past conversations will remain saved and readable in your inbox.</span>
          </li>
          <li className="flex gap-2">
            <span className="mt-2 w-1 h-1 rounded-full bg-slate-400 shrink-0" />
            <span>Reconnect the same number any time to resume messaging.</span>
          </li>
        </ul>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors cursor-pointer disabled:opacity-60 flex items-center gap-1.5"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {busy ? 'Disconnecting…' : 'Pause & Disconnect'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── useDisconnectChannel ─────────────────────────────────────────────────────

/** Confirm-then-disconnect flow; render `dialog` and call `requestDisconnect(channel)` to start it */
export function useDisconnectChannel(onDisconnected: (channel: Channel) => void) {
  const [pending, setPending] = useState<Channel | null>(null);
  const [busy, setBusy] = useState(false);

  const cancel = useCallback(() => setPending(null), []);

  const confirm = async () => {
    if (!pending) return;
    const channel = pending;
    setBusy(true);
    try {
      await apiClient.delete<{ metaUnsubscribed: boolean; metaSkippedReason?: string }>(`/api/channels/${channel.id}`);
      const updatedChannel: Channel = {
        ...channel,
        status: 'disconnected',
        isActive: false,
      };
      setPending(null);
      onDisconnected(updatedChannel);

      const number = formatPhone(channel.phoneNumber) || channel.verified_name;
      gooeyToast.success(`${number} disconnected`, {
        description: 'Access token removed. Messaging paused for this number.',
      });
    } catch (err) {
      notifyError(err, { where: 'SettingsView.disconnect', title: "Couldn't disconnect channel" });
    } finally {
      setBusy(false);
    }
  };

  const dialog = pending ? <DisconnectDialog channel={pending} busy={busy} onConfirm={confirm} onCancel={cancel} /> : null;

  return { requestDisconnect: setPending, dialog };
}
