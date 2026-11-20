'use client';

import React from 'react';
import { inputCls } from '@/components/ui/controls';
import { FieldLabel, SectionCard, formatDateTime, formatDuration, formatNumber } from '../ui';
import type { CampaignSchedule } from '../types';

interface Props {
  schedule: CampaignSchedule;
  recipients: number;
  onChange: (schedule: CampaignSchedule) => void;
}

export const MIN_INTERVAL_SECONDS = 1;
/** SQS's longest message delay */
export const MAX_INTERVAL_SECONDS = 15 * 60;

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO instant → value for <input type="datetime-local"> in the browser's zone */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Total time to go through the list: the pause runs between contacts, so n contacts → n-1 pauses */
export const dispatchSeconds = (recipients: number, intervalSeconds: number | null) =>
  intervalSeconds ? Math.max(0, recipients - 1) * intervalSeconds : 0;

export const StepSchedule: React.FC<Props> = ({ schedule, recipients, onChange }) => {
  const interval = schedule.intervalSeconds;
  const minutes = interval ? Math.floor(interval / 60) : '';
  const seconds = interval ? interval % 60 : '';
  const total = dispatchSeconds(recipients, interval);
  const start = schedule.sendAt ? new Date(schedule.sendAt) : null;
  const finish = start && interval ? new Date(start.getTime() + total * 1000) : null;
  const isPast = start ? start.getTime() < Date.now() : false;

  const toInt = (value: string) => {
    const n = Math.round(Number(value));
    return value && Number.isFinite(n) && n > 0 ? n : 0;
  };

  /** Minutes + seconds → total seconds, kept within 1 s – 15 min; 0 clears it */
  const updateInterval = (part: 'minutes' | 'seconds', value: string) => {
    const m = part === 'minutes' ? Math.min(15, toInt(value)) : Number(minutes || 0);
    const s = part === 'seconds' ? Math.min(59, toInt(value)) : Number(seconds || 0);
    const total = m * 60 + s;
    onChange({ ...schedule, intervalSeconds: total > 0 ? Math.min(MAX_INTERVAL_SECONDS, Math.max(MIN_INTERVAL_SECONDS, total)) : null });
  };

  return (
    <div className="space-y-5">
      <SectionCard step="01" title="Start time" description="When the first message goes out. You can edit or cancel the campaign until then.">
        <div className="max-w-sm">
          <FieldLabel htmlFor="send-at">Date & time *</FieldLabel>
          <input
            id="send-at"
            type="datetime-local"
            className={inputCls}
            value={toLocalInput(schedule.sendAt)}
            min={toLocalInput(new Date().toISOString())}
            onChange={(e) => onChange({ ...schedule, sendAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
          />
          <p className={`mt-1 text-[11px] ${isPast ? 'text-red-600' : 'text-slate-500'}`}>
            {isPast ? 'This time has passed. Pick a time in the future.' : `Time zone: ${schedule.timezone}`}
          </p>
        </div>
        <p className="mt-4 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-600">
          Only one campaign can be scheduled or sending at a time in this workspace. You can schedule this one when the current
          campaign has finished.
        </p>
      </SectionCard>

      <SectionCard step="02" title="Sending pace" description="How long to wait between two contacts.">
        <div className="max-w-sm">
          <FieldLabel htmlFor="interval">Delay between contacts *</FieldLabel>
          <div className="grid grid-cols-2 gap-3">
            <div className="relative">
              <input
                id="interval"
                type="number"
                min={0}
                max={15}
                step={1}
                aria-label="Minutes"
                className={`${inputCls} pr-12 ${interval ? '' : 'border-red-400'}`}
                placeholder="0"
                value={minutes}
                onChange={(e) => updateInterval('minutes', e.target.value)}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-slate-400 pointer-events-none">min</span>
            </div>
            <div className="relative">
              <input
                type="number"
                min={0}
                max={59}
                step={1}
                aria-label="Seconds"
                disabled={minutes === 15}
                className={`${inputCls} pr-12 ${interval ? '' : 'border-red-400'}`}
                placeholder="0"
                value={seconds}
                onChange={(e) => updateInterval('seconds', e.target.value)}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-slate-400 pointer-events-none">sec</span>
            </div>
          </div>
          <p className={`mt-1 text-[11px] ${interval ? 'text-slate-500' : 'text-red-600'}`}>
            {interval ? '' : 'Required. '}
            1 second to 15 minutes between two contacts.
          </p>
        </div>
      </SectionCard>

      <SectionCard step="03" title="Dispatch forecast">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Forecast label="Recipients" value={formatNumber(recipients)} />
          <Forecast label="Delay per contact" value={interval ? formatDuration(interval) : 'Not set'} />
          <Forecast label="Total sending time" value={interval ? `~${formatDuration(total)}` : '—'} highlight />
        </div>
        {finish && <p className="mt-3 text-[11px] text-slate-500">Last message around {formatDateTime(finish.toISOString(), schedule.timezone)}.</p>}
      </SectionCard>
    </div>
  );
};

const Forecast: React.FC<{ label: string; value: string; highlight?: boolean }> = ({ label, value, highlight }) => (
  <div className="p-4 rounded-xl border border-slate-200">
    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
    <p className={`mt-1 text-2xl font-bold tabular-nums ${highlight ? 'text-emerald-700' : 'text-slate-900'}`}>{value}</p>
  </div>
);
