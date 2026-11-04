'use client';

import React, { useState } from 'react';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import apiClient from '@/lib/api/client';
import { notifyError } from '@/lib/api/notify';
import { gooeyToast } from '@/components/ui/goey-toaster';
import {
  CONSENT_SOURCE_LABELS,
  CONSENT_STATUS_LABELS,
  consentStatusOf,
  type ConsentChange,
  type ConsentStatus,
} from '@/types/consent';

const formatWhen = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** Chat header pill: Opted-in / Opted-out of WhatsApp messages */
export const ConsentBadge: React.FC<{ isOptedOut?: boolean }> = ({ isOptedOut }) =>
  isOptedOut ? (
    <span
      title="Opted out of WhatsApp messages. Nothing can be sent to this customer, not even templates, until they reply START."
      className="shrink-0 whitespace-nowrap inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] leading-4 font-medium bg-red-50 text-red-700 border border-red-200"
    >
      <ShieldOff className="w-3 h-3" />
      {CONSENT_STATUS_LABELS.opted_out}
    </span>
  ) : (
    <span
      title="Opted in to WhatsApp messages. The customer can reply STOP anytime to opt out."
      className="shrink-0 whitespace-nowrap inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] leading-4 font-medium bg-slate-50 text-slate-600 border border-slate-200"
    >
      <ShieldCheck className="w-3 h-3 text-emerald-600" />
      {CONSENT_STATUS_LABELS.opted_in}
    </span>
  );

/** Consent log entry in the thread: what changed, why, how and when. Only the team sees it. */
export const ConsentEventRow: React.FC<{ change: ConsentChange }> = ({ change }) => {
  const optedOut = change.status === 'opted_out';
  const Icon = optedOut ? ShieldOff : ShieldCheck;
  const by = change.source === 'agent' && change.changedByName ? ` by ${change.changedByName}` : '';
  return (
    <div className="flex justify-center py-1">
      <div
        className={`max-w-[85%] rounded-lg border px-3 py-1.5 text-center text-[11.5px] leading-snug ${
          optedOut ? 'bg-red-50/60 border-red-100 text-red-800' : 'bg-emerald-50/60 border-emerald-100 text-emerald-800'
        }`}
      >
        <p className="font-semibold inline-flex items-center gap-1">
          <Icon className="w-3.5 h-3.5" />
          {optedOut ? 'Opted out of WhatsApp messages' : 'Opted in to WhatsApp messages'}
        </p>
        <p className="text-slate-600">{change.reason}</p>
        <p className="text-[10.5px] text-slate-400">
          {CONSENT_SOURCE_LABELS[change.source] ?? change.source}
          {by} · {formatWhen(change.occurredAt)} · visible to your team only
        </p>
      </div>
    </div>
  );
};

/** Customer panel: current status and a manual change for teammates (e.g. the customer asked on a call) */
export const ConsentSection: React.FC<{
  customerId: number;
  isOptedOut?: boolean;
  onChanged: (isOptedOut: boolean) => void;
}> = ({ customerId, isOptedOut, onChanged }) => {
  const status = consentStatusOf(isOptedOut);
  const target: ConsentStatus = status === 'opted_out' ? 'opted_in' : 'opted_out';
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await apiClient.put<{ isOptedOut: boolean }>(`/api/customer/${customerId}/consent`, {
        status: target,
        reason: reason.trim() || undefined,
      });
      onChanged(res.data.isOptedOut);
      gooeyToast.success(res.data.isOptedOut ? 'Marked as opted-out' : 'Marked as opted-in');
      setConfirming(false);
      setReason('');
    } catch (err) {
      notifyError(err, { where: 'ConsentSection.save', title: "Couldn't update consent" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <ConsentBadge isOptedOut={isOptedOut} />
        {!confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="text-[11.5px] font-semibold text-[#3440a8] hover:underline cursor-pointer"
          >
            {target === 'opted_out' ? 'Mark as opted-out' : 'Mark as opted-in'}
          </button>
        )}
      </div>
      <p className="text-[11px] text-slate-500 leading-relaxed">
        {status === 'opted_out'
          ? 'Nothing can be sent to this customer, not even templates, until they reply START.'
          : 'The customer can reply STOP or UNSUBSCRIBE anytime to opt out.'}
      </p>

      {confirming && (
        <div className="rounded-lg border border-slate-200 p-2.5 space-y-2">
          <p className="text-[11.5px] text-slate-700">
            {target === 'opted_out'
              ? 'Stop all messages to this customer on this WhatsApp number? Replies and templates will be blocked until they reply START.'
              : 'Only opt the customer back in if they asked for it. Record how they gave consent.'}
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
            rows={2}
            placeholder={target === 'opted_out' ? 'Reason, e.g. asked on a call' : 'How consent was given, e.g. asked on a call'}
            className="w-full resize-none rounded-md border border-slate-200 px-2 py-1.5 text-[12px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#3440a8]"
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setConfirming(false);
                setReason('');
              }}
              className="px-2.5 py-1 rounded-md text-[12px] text-slate-600 hover:bg-slate-100 cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving || (target === 'opted_in' && !reason.trim())}
              title={target === 'opted_in' && !reason.trim() ? 'Record how the customer gave consent' : undefined}
              onClick={save}
              className={`px-2.5 py-1 rounded-md text-[12px] font-semibold text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                target === 'opted_out' ? 'bg-red-600 hover:bg-red-700' : 'bg-[#3440a8] hover:bg-[#2b358c]'
              }`}
            >
              {saving ? 'Saving…' : target === 'opted_out' ? 'Opt out' : 'Opt in'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
