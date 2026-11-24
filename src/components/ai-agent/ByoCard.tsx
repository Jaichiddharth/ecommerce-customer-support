'use client';

import React, { useEffect, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, Loader2, Trash2, XCircle } from 'lucide-react';
import { notifyError } from '@/lib/api/notify';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { aiAgentApi, type ByoConfig, type ByoProviderKey, type ByoTest } from './api';
import { Card, Pill, Select, Skeleton, timeAgo } from './ui';
import type { AgentContext } from './AiAgentView';

/** Suggestions only: any model the key can use may be typed in */
const PROVIDERS: { key: ByoProviderKey; name: string; models: string[]; keyHint: string; keysUrl: string }[] = [
  { key: 'openai', name: 'OpenAI', models: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o'], keyHint: 'sk-…', keysUrl: 'platform.openai.com/api-keys' },
  { key: 'anthropic', name: 'Anthropic (Claude)', models: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'], keyHint: 'sk-ant-…', keysUrl: 'console.anthropic.com' },
  { key: 'gemini', name: 'Google Gemini', models: ['gemini-2.5-flash', 'gemini-2.5-pro'], keyHint: 'AIza…', keysUrl: 'aistudio.google.com/apikey' },
  { key: 'groq', name: 'Groq', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'], keyHint: 'gsk_…', keysUrl: 'console.groq.com/keys' },
];

export function ByoCard({ ctx, onChange }: { ctx: AgentContext; onChange: (byo: ByoConfig) => void }) {
  const { canEdit } = ctx;
  const [byo, setByo] = useState<ByoConfig | null>(null);
  const [form, setForm] = useState({ provider: 'openai' as ByoProviderKey, model: 'gpt-4o-mini', apiKey: '', limit: '' });
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState<'test' | 'save' | 'remove' | null>(null);
  const [test, setTest] = useState<ByoTest | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    aiAgentApi.byo().then(
      (b) => {
        setByo(b);
        onChange(b);
        if (b.provider) setForm({ provider: b.provider, model: b.model ?? '', apiKey: '', limit: b.monthlyLimitUsd == null ? '' : String(b.monthlyLimitUsd) });
      },
      () => setLoadError(true),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const provider = PROVIDERS.find((p) => p.key === form.provider)!;
  const keepsSavedKey = !!byo?.configured && byo.provider === form.provider && !form.apiKey.trim();
  const canSubmit = canEdit && form.model.trim() && (form.apiKey.trim() || keepsSavedKey);
  const set = (patch: Partial<typeof form>) => { setForm((f) => ({ ...f, ...patch })); setTest(null); };
  const limit = form.limit.trim() === '' ? null : Number(form.limit);
  const payload = { provider: form.provider, model: form.model.trim(), ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}) };

  const runTest = async () => {
    setBusy('test');
    try {
      setTest(await aiAgentApi.testByo(payload));
    } catch (err) {
      notifyError(err, { where: 'ByoCard.test', title: "Couldn't test the connection" });
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (limit !== null && (!Number.isFinite(limit) || limit < 0)) {
      gooeyToast.error('Enter the monthly limit in dollars, or leave it empty.');
      return;
    }
    setBusy('save');
    try {
      const r = await aiAgentApi.saveByo({ ...payload, monthlyLimitUsd: limit });
      setByo(r.byo);
      onChange(r.byo);
      setTest(r.test);
      setForm((f) => ({ ...f, apiKey: '' }));
      gooeyToast.success('Your model is connected', { description: 'Choose "Bring your own model" above and save to use it.' });
    } catch (err) {
      notifyError(err, { where: 'ByoCard.save', title: "Couldn't connect your model" });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('remove');
    try {
      const c = await aiAgentApi.removeByo();
      ctx.applyConfig(c);
      const empty: ByoConfig = { configured: false, provider: null, model: null, keyHint: null, monthlyLimitUsd: null, verifiedAt: null };
      setByo(empty);
      onChange(empty);
      setForm({ provider: 'openai', model: 'gpt-4o-mini', apiKey: '', limit: '' });
      setTest(null);
      gooeyToast.success('Your key was removed', { description: 'The agent uses UnoCX Standard.' });
    } catch (err) {
      notifyError(err, { where: 'ByoCard.remove', title: "Couldn't remove the key" });
    } finally {
      setBusy(null);
    }
  };

  const input = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3440a8]/20 disabled:bg-slate-50';

  return (
    <Card
      title={<span className="inline-flex items-center gap-3">Bring your own model {byo?.configured ? <Pill tone="green" dot>Connected</Pill> : null}</span>}
      subtitle="Use your own OpenAI, Anthropic, Gemini or Groq key for writing replies. You pay the provider; no UnoCX credits are used."
    >
      {loadError ? <p className="text-[13px] text-red-600">Couldn't load your model settings.</p> : !byo ? <Skeleton className="h-48" /> : (
        <div className="space-y-3">
          <label className="grid grid-cols-1 sm:grid-cols-[160px_1fr] items-center gap-2">
            <span className="text-[13px] font-semibold text-slate-700">Provider</span>
            <Select
              label="Provider"
              value={form.provider}
              disabled={!canEdit}
              onChange={(v) => {
                const p = PROVIDERS.find((x) => x.key === v)!;
                set({ provider: p.key, model: byo.provider === p.key && byo.model ? byo.model : p.models[0] });
              }}
              options={PROVIDERS.map((p) => ({ value: p.key, label: p.name }))}
            />
          </label>
          <label className="grid grid-cols-1 sm:grid-cols-[160px_1fr] items-center gap-2">
            <span className="text-[13px] font-semibold text-slate-700">Model</span>
            <span>
              <input list={`byo-models-${form.provider}`} value={form.model} onChange={(e) => set({ model: e.target.value })} disabled={!canEdit} placeholder={provider.models[0]} className={input} />
              <datalist id={`byo-models-${form.provider}`}>{provider.models.map((m) => <option key={m} value={m} />)}</datalist>
            </span>
          </label>
          <label className="grid grid-cols-1 sm:grid-cols-[160px_1fr] items-center gap-2">
            <span className="text-[13px] font-semibold text-slate-700">API key</span>
            <span className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                value={form.apiKey}
                onChange={(e) => set({ apiKey: e.target.value })}
                disabled={!canEdit}
                placeholder={keepsSavedKey || (byo.configured && byo.provider === form.provider) ? `Saved key ${byo.keyHint ?? ''} · paste a new one to replace` : provider.keyHint}
                className={`${input} pr-10`}
              />
              <button type="button" onClick={() => setShowKey((s) => !s)} aria-label={showKey ? 'Hide key' : 'Show key'} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600">
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </span>
          </label>
          <label className="grid grid-cols-1 sm:grid-cols-[160px_1fr] items-center gap-2">
            <span className="text-[13px] font-semibold text-slate-700">Monthly spend limit</span>
            <span className="flex items-center gap-2">
              <span className="text-[13px] text-slate-500">$</span>
              <input inputMode="decimal" value={form.limit} onChange={(e) => set({ limit: e.target.value.replace(/[^\d.]/g, '') })} disabled={!canEdit} placeholder="No limit" className={`${input} max-w-[140px]`} />
              <span className="text-[12px] text-slate-500">Estimated. Above it, replies use UnoCX Standard until the 1st.</span>
            </span>
          </label>

          {test && (
            <p className={`flex items-start gap-2 rounded-lg px-3 py-2 text-[13px] ${test.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
              {test.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <XCircle className="w-4 h-4 mt-0.5 shrink-0" />}
              {test.ok ? `Connected to ${test.model}${test.latency_ms ? ` · replied in ${(test.latency_ms / 1000).toFixed(1)} s` : ''}.` : test.error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="button" onClick={runTest} disabled={!canSubmit || busy !== null} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              {busy === 'test' && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Test connection
            </button>
            <button type="button" onClick={save} disabled={!canSubmit || busy !== null} className="inline-flex items-center gap-1.5 rounded-lg bg-[#3440a8] hover:bg-[#2a3490] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50">
              {busy === 'save' && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {byo.configured ? 'Save changes' : 'Connect'}
            </button>
            {byo.configured && canEdit && (
              <button type="button" onClick={remove} disabled={busy !== null} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
                {busy === 'remove' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Remove key
              </button>
            )}
            <span className="ml-auto text-[12px] text-slate-500">
              {byo.verifiedAt ? `Last checked ${timeAgo(byo.verifiedAt)}` : `Get a key at ${provider.keysUrl}`}
            </span>
          </div>
          <p className="text-[12px] text-slate-500 leading-relaxed">
            Your key is tested before it's saved, stored encrypted and never shown again. Knowledge search, guardrails and order
            lookups stay on UnoCX. If your provider fails or the limit is reached, replies automatically use UnoCX Standard.
          </p>
        </div>
      )}
    </Card>
  );
}
