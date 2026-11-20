'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, Circle, Info } from 'lucide-react';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { useAuth } from '@/context/AuthContext';
import type { ParsedSheet } from '@/lib/campaigns/contact-file';
import { unmappedFields } from '@/lib/campaigns/message';
import { campaignAction, getCampaign, saveCampaign, uploadAudience } from '../campaign-store';
import { CampaignDetails } from '../CampaignDetails';
import { emptyCampaign, isEditable, type Campaign, type CampaignAudience } from '../types';
import { formatDateTime, formatDuration, formatNumber } from '../ui';
import { StepAudience } from './StepAudience';
import { StepMessage } from './StepMessage';
import { MAX_INTERVAL_SECONDS, MIN_INTERVAL_SECONDS, StepSchedule, dispatchSeconds } from './StepSchedule';

/** Same limit as the API (campaign.service.ts) */
const MAX_NAME_LENGTH = 80;

const STEPS = [
  { title: 'Import contacts', subtitle: 'Upload file, map phone column' },
  { title: 'Template & variables', subtitle: 'Pick template, map variables' },
  { title: 'Start & schedule', subtitle: 'Start time and sending pace' },
] as const;

interface LaunchCheck {
  ok: boolean;
  label: string;
  /** What to do when the check fails */
  hint: string;
  /** Step that fixes it */
  step: number;
}

/** What still blocks each step; Continue and Schedule stay disabled until they pass (the server re-checks) */
function getChecks(c: Campaign): LaunchCheck[] {
  const recipients = c.recipientCount;
  const missing = unmappedFields(c.message.template, c.message.variables);
  const sendAt = c.schedule.sendAt ? new Date(c.schedule.sendAt).getTime() : null;
  const interval = c.schedule.intervalSeconds;
  return [
    { step: 0, ok: Boolean(c.name.trim()), label: 'Campaign named', hint: 'Enter a campaign name at the top.' },
    {
      step: 0,
      ok: recipients > 0,
      label: recipients ? `${formatNumber(recipients)} contacts ready` : 'Contacts uploaded',
      hint: 'Upload a file with at least one valid number.',
    },
    { step: 1, ok: Boolean(c.message.phoneNumberId), label: 'Sender number chosen', hint: 'Choose the WhatsApp number to send from.' },
    {
      step: 1,
      ok: c.message.template?.status?.toUpperCase() === 'APPROVED',
      label: 'Approved template selected',
      hint: 'Choose an approved template.',
    },
    {
      step: 1,
      ok: Boolean(c.message.template) && missing.length === 0,
      label: 'All variables filled',
      hint: missing.length ? `Fill: ${missing.map((f) => f.label).join(', ')}` : 'Fill every template variable.',
    },
    {
      step: 2,
      ok: sendAt !== null && sendAt > Date.now() + 60_000,
      label: 'Start time in the future',
      hint: 'Pick a date and time at least a minute from now.',
    },
    {
      step: 2,
      ok: interval !== null && interval >= MIN_INTERVAL_SECONDS && interval <= MAX_INTERVAL_SECONDS,
      label: 'Delay between contacts set',
      hint: 'Set a delay of 1 second to 15 minutes.',
    },
  ];
}

/** The parts of a campaign that Save draft stores; compared to know whether there are unsaved changes */
function snapshot(c: Campaign): string {
  const variables = Object.keys(c.message.variables)
    .sort()
    .map((k) => {
      const v = c.message.variables[k];
      return `${k}=${v.type}:${v.type === 'column' ? v.column : v.value}`;
    });
  const t = c.message.template;
  return JSON.stringify([
    c.name.trim(),
    c.message.phoneNumberId,
    t ? `${t.name}/${t.language}` : null,
    variables,
    c.schedule.sendAt,
    c.schedule.intervalSeconds,
  ]);
}

type Dialog = 'discard' | null;

export const CampaignWizard: React.FC<{ campaignId?: string }> = ({ campaignId }) => {
  const router = useRouter();
  const { can, hasPermission } = useAuth();
  const canLaunch = hasPermission('create_and_launch_campaigns');
  const canSave = campaignId ? can('broadcasts', 'update') : can('broadcasts', 'create');

  const [campaign, setCampaign] = useState<Campaign>(emptyCampaign);
  /** Last saved state (or the empty form), to detect unsaved changes */
  const [savedSnapshot, setSavedSnapshot] = useState(() => snapshot(emptyCampaign()));
  /** Rows of the file picked in this session (lets the phone column / country be changed without re-uploading) */
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  /** File picked in this session; it is uploaded only on Save draft or Schedule */
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [audienceDirty, setAudienceDirty] = useState(false);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(Boolean(campaignId));
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  /** Scheduled or later: shown read-only instead of the editor */
  const [locked, setLocked] = useState<Campaign | null>(null);

  useEffect(() => {
    if (!campaignId) return;
    getCampaign(campaignId)
      .then((found) => {
        if (!found) setNotFound(true);
        else if (!isEditable(found.status)) setLocked(found);
        else {
          setCampaign(found);
          setSavedSnapshot(snapshot(found));
        }
      })
      .catch((err) => {
        gooeyToast.error(err instanceof Error ? err.message : "Couldn't load the campaign");
        setNotFound(true);
      })
      .finally(() => setLoading(false));
  }, [campaignId]);

  const checks = useMemo(() => getChecks(campaign), [campaign]);
  const stepReady = (i: number) => checks.filter((c) => c.step === i).every((c) => c.ok);
  const ready = checks.every((c) => c.ok);
  const recipients = campaign.recipientCount;
  const nameMissing = !campaign.name.trim();
  const nameLength = campaign.name.length;
  const dirty = audienceDirty || snapshot(campaign) !== savedSnapshot;

  // Closing or reloading the tab with unsaved changes asks the browser to confirm
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const update = (patch: Partial<Campaign>) => setCampaign((c) => ({ ...c, ...patch }));

  /**
   * Saves the draft (create or update), then uploads the contact file if it changed. Nothing is stored before
   * this runs. The server answers with a preview of the first recipients; the full local list is kept for the table.
   */
  const persist = async (next: Campaign, success?: string): Promise<Campaign | null> => {
    if (!next.name.trim()) {
      setNameTouched(true);
      gooeyToast.error('Give the campaign a name first');
      return null;
    }
    setSaving(true);
    try {
      let saved = await saveCampaign({ ...next, name: next.name.trim() });
      setCampaign((c) => ({ ...c, id: saved.id, status: saved.status }));
      if (!campaignId && !next.id) window.history.replaceState(null, '', `/campaigns/${saved.id}`);

      if (audienceDirty && pendingFile && next.audience) {
        saved = await uploadAudience(saved.id, pendingFile, next.audience.phoneColumn, next.audience.defaultCountry);
        setAudienceDirty(false);
      }
      const local = next.audience;
      const audience: CampaignAudience | null =
        saved.audience && local && local.fileName === saved.audience.fileName && local.recipients.length > saved.audience.recipients.length
          ? { ...saved.audience, recipients: local.recipients }
          : saved.audience;
      setCampaign({ ...saved, audience });
      setSavedSnapshot(snapshot(saved));

      if (success) gooeyToast.success(success);
      return saved;
    } catch (err) {
      gooeyToast.error(err instanceof Error ? err.message : "Couldn't save the campaign");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const saveDraft = () => void persist(campaign, 'Draft saved');

  const leave = () => {
    if (dirty) setDialog('discard');
    else router.push('/campaigns');
  };

  const next = () => {
    if (stepReady(step)) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const launch = async () => {
    if (!ready || !canLaunch) return;
    const saved = await persist(campaign);
    if (!saved) return;
    setSaving(true);
    try {
      const scheduled = await campaignAction(saved.id, 'schedule');
      gooeyToast.success(`Scheduled for ${formatDateTime(scheduled.schedule.sendAt, scheduled.schedule.timezone)}`);
      router.push('/campaigns');
    } catch (err) {
      gooeyToast.error(`${err instanceof Error ? err.message : "Couldn't schedule the campaign"} It was saved as a draft.`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState className="h-full" label="Loading campaign…" />;
  if (locked) return <CampaignDetails initial={locked} />;
  if (notFound) {
    return (
      <EmptyState
        className="h-full"
        title="Campaign not found"
        description="It doesn't exist or was deleted."
        action={
          <button onClick={() => router.push('/campaigns')} className="text-[12px] font-semibold text-white bg-[#3440a8] hover:bg-[#2a3490] px-3.5 py-2 rounded-lg cursor-pointer">
            Back to campaigns
          </button>
        }
      />
    );
  }

  const isLast = step === STEPS.length - 1;
  const interval = campaign.schedule.intervalSeconds;
  const stepBlocker = checks.find((c) => c.step === step && !c.ok);
  const firstBlocker = checks.find((c) => !c.ok);

  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* ── Header ── */}
      <header className="shrink-0 min-h-16 px-4 sm:px-8 py-3 bg-white border-b border-slate-200 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={leave}
          className="w-8 h-8 shrink-0 rounded-lg border border-slate-200 text-slate-700 hover:text-slate-900 hover:bg-slate-50 flex items-center justify-center cursor-pointer"
          title="Back to campaigns"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-[220px]">
          <p className="text-[11px] text-slate-600">
            Campaigns /<span className="text-slate-800 font-medium">{campaign.id ? 'Edit campaign' : 'New campaign'}</span>
            {dirty ? (
              <span className="ml-2 text-amber-600 font-semibold">• Unsaved changes</span>
            ) : campaign.id ? (
              <span className="ml-2 text-emerald-600 font-semibold">• Saved</span>
            ) : null}
          </p>
          <div className="mt-1 relative w-full max-w-xl">
            <input
              value={campaign.name}
              onChange={(e) => update({ name: e.target.value.slice(0, MAX_NAME_LENGTH) })}
              onBlur={() => setNameTouched(true)}
              placeholder="Campaign name, e.g. Diwali sale blast"
              maxLength={MAX_NAME_LENGTH}
              aria-label="Campaign name"
              aria-invalid={nameTouched && nameMissing}
              aria-describedby="campaign-name-hint"
              title={campaign.name || undefined}
              className={`w-full h-10 pl-3 pr-16 rounded-lg border bg-white text-[15px] font-semibold text-slate-900 outline-none transition-colors placeholder:text-slate-400 placeholder:font-normal ${
                nameTouched && nameMissing
                  ? 'border-red-400 focus:ring-2 focus:ring-red-100'
                  : 'border-slate-200 hover:border-slate-300 focus:border-[#3440a8] focus:ring-2 focus:ring-[#3440a8]/15'
              }`}
            />
            <span
              id="campaign-name-hint"
              className={`absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-medium tabular-nums pointer-events-none ${
                nameLength >= MAX_NAME_LENGTH ? 'text-red-600' : nameLength >= MAX_NAME_LENGTH - 10 ? 'text-amber-600' : 'text-slate-500'
              }`}
              aria-live="polite"
            >
              {nameLength}/{MAX_NAME_LENGTH}
            </span>
          </div>
          {nameTouched && nameMissing && <p className="mt-1 text-[11px] text-red-600">Name is required.</p>}
        </div>
        <button
          type="button"
          onClick={leave}
          disabled={saving}
          className="px-4 py-2 text-sm font-semibold rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={saveDraft}
          disabled={saving || !canSave || (!dirty && Boolean(campaign.id))}
          title={!dirty && campaign.id ? 'No changes to save' : undefined}
          className="px-4 py-2 text-sm font-semibold rounded-xl border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {saving ? 'Saving…' : 'Save draft'}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6">
          {isLast && (
            <p className="mb-4 px-4 py-3 rounded-xl border border-indigo-100 bg-indigo-50 text-xs text-indigo-800 flex items-start gap-2">
              <Info className="w-4 h-4 shrink-0" />
              Once scheduled, the campaign and its contact list are locked. To change anything after that, cancel it and duplicate it.
            </p>
          )}
          {/* ── Stepper ── */}
          <ol className="bg-white border border-slate-200 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {STEPS.map((s, i) => {
              const done = i < step && stepReady(i);
              const active = i === step;
              // Steps can be revisited freely; later ones only open once the earlier ones are complete
              const reachable = i <= step || STEPS.slice(0, i).every((_, j) => stepReady(j));
              return (
                <li key={s.title}>
                  <button
                    type="button"
                    disabled={!reachable}
                    onClick={() => setStep(i)}
                    className="w-full flex items-center gap-3 text-left disabled:cursor-not-allowed cursor-pointer"
                  >
                    <span
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                        done ? 'bg-emerald-500 text-white' : active ? 'bg-[#3440a8] text-white' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {done ? <Check className="w-4 h-4" /> : i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className={`block text-sm font-semibold ${active ? 'text-slate-900' : 'text-slate-600'}`}>{s.title}</span>
                      <span className="block text-[11px] text-slate-400 truncate">{s.subtitle}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="mt-5 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-5 items-start">
            <div className="min-w-0">
              {step === 0 && (
                <StepAudience
                  audience={campaign.audience}
                  sheet={sheet}
                  onChange={(audience, nextSheet, file) => {
                    setSheet(nextSheet);
                    if (file !== undefined) setPendingFile(file);
                    setAudienceDirty(true);
                    update({ audience, recipientCount: audience?.recipientCount ?? 0 });
                  }}
                />
              )}
              {step === 1 && <StepMessage message={campaign.message} audience={campaign.audience} onChange={(message) => update({ message })} />}
              {step === 2 && <StepSchedule schedule={campaign.schedule} recipients={recipients} onChange={(schedule) => update({ schedule })} />}
            </div>

            {/* ── Summary ── */}
            <aside className="lg:sticky lg:top-0 bg-white border border-slate-200 rounded-2xl p-5">
              <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                <span className={`w-2 h-2 rounded-full ${dirty ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                Draft summary
              </p>
              <dl className="mt-4 divide-y divide-slate-100 text-xs">
                <Row label="Campaign" value={campaign.name.trim() || 'Unnamed'} />
                <Row label="Recipients" value={formatNumber(recipients)} />
                <Row label="Phone column" value={campaign.audience?.phoneColumn || '—'} />
                <Row label="Sender" value={campaign.message.senderLabel || '—'} />
                <Row label="Template" value={campaign.message.template?.name ?? 'Not selected'} mono={Boolean(campaign.message.template)} />
                <Row label="Delay" value={interval ? `${formatDuration(interval)} / contact` : 'Not set'} />
                <Row
                  label="Start"
                  value={campaign.schedule.sendAt ? formatDateTime(campaign.schedule.sendAt, campaign.schedule.timezone) : 'Not set'}
                />
                {interval ? <Row label="Duration" value={`~${formatDuration(dispatchSeconds(recipients, interval))}`} /> : null}
              </dl>

              {isLast && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-2">Before you schedule</p>
                  <ul className="space-y-2">
                    {checks.map((c) => (
                      <li key={c.label} className="flex items-start gap-2 text-xs">
                        {c.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <Circle className="w-4 h-4 text-amber-500 shrink-0" />}
                        <span>
                          <span className={c.ok ? 'text-slate-700' : 'text-slate-900 font-medium'}>{c.label}</span>
                          {!c.ok && (
                            <button type="button" onClick={() => setStep(c.step)} className="block text-[11px] text-[#3440a8] hover:underline text-left cursor-pointer">
                              {c.hint}
                            </button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {!canLaunch && (
                    <p className="mt-3 px-3 py-2 rounded-lg bg-amber-50 text-[11px] text-amber-800 flex gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                      You can save drafts, but scheduling needs the &quot;Create and launch campaigns&quot; permission.
                    </p>
                  )}
                </div>
              )}

              <div className="mt-5 space-y-2">
                {isLast ? (
                  <button
                    type="button"
                    onClick={launch}
                    disabled={saving || !canLaunch || !ready}
                    title={firstBlocker?.hint}
                    className="w-full py-2.5 text-sm font-semibold rounded-xl bg-[#3440a8] hover:bg-[#2b358d] text-white disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {saving ? 'Scheduling…' : 'Schedule campaign'}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={next}
                      disabled={!stepReady(step)}
                      className="w-full py-2.5 text-sm font-semibold rounded-xl bg-slate-900 hover:bg-slate-800 text-white disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                      Continue
                    </button>
                    {stepBlocker && <p className="text-[11px] text-amber-700 text-center">{stepBlocker.hint}</p>}
                  </>
                )}
                {isLast && !ready && firstBlocker && <p className="text-[11px] text-amber-700 text-center">{firstBlocker.hint}</p>}
                <button
                  type="button"
                  onClick={() => (step === 0 ? leave() : setStep(step - 1))}
                  className="w-full py-2.5 text-sm font-semibold rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  {step === 0 ? 'Back to campaigns' : '← Back'}
                </button>
                {dirty && (
                  <p className="text-[11px] text-slate-500 text-center">Nothing is saved until you click Save draft or Schedule campaign.</p>
                )}
              </div>
            </aside>
          </div>
        </div>
      </div>

      {/* ── Leave without saving ── */}
      <Modal
        isOpen={dialog === 'discard'}
        onClose={() => setDialog(null)}
        title="Discard unsaved changes?"
        icon={<AlertTriangle className="w-4 h-4 text-amber-500" />}
      >
        <div className="space-y-3 text-[13px] text-slate-600">
          {campaign.id ? (
            <p>Your changes to this campaign since the last save will be lost. The saved draft stays as it was.</p>
          ) : (
            <p>This campaign hasn&apos;t been saved yet. If you leave now, nothing is kept.</p>
          )}
          {audienceDirty && campaign.audience && (
            <p className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-100 text-[12px] text-amber-800">
              The contact file <b>{campaign.audience.fileName}</b> ({formatNumber(campaign.audience.recipientCount)} contacts) hasn&apos;t been
              uploaded and will be discarded.
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setDialog(null)}
              className="px-4 py-2 text-sm font-semibold rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Keep editing
            </button>
            {canSave && (
              <button
                type="button"
                disabled={saving}
                onClick={async () => {
                  setDialog(null);
                  if (await persist(campaign, 'Draft saved')) router.push('/campaigns');
                }}
                className="px-4 py-2 text-sm font-semibold rounded-xl border border-slate-200 text-slate-800 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
              >
                Save draft & leave
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setDialog(null);
                setAudienceDirty(false);
                setSavedSnapshot(snapshot(campaign));
                router.push('/campaigns');
              }}
              className="px-4 py-2 text-sm font-semibold rounded-xl bg-red-600 hover:bg-red-700 text-white cursor-pointer"
            >
              Discard
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

const Row: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="flex items-start justify-between gap-3 py-2.5">
    <dt className="text-slate-500 shrink-0">{label}</dt>
    <dd className={`text-right font-semibold text-slate-900 break-all ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</dd>
  </div>
);
