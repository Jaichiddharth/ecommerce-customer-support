'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronRight, Loader2, MessageCircle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { notifyError } from '@/lib/api/notify';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { ErrorState, LoadingState } from '@/components/ui/states';
import type { AgentPolicy } from '@/lib/ai-agent/policy';
import { aiAgentApi, type AgentConfig } from './api';
import { OverviewTab } from './OverviewTab';
import { KnowledgeTab } from './KnowledgeTab';
import { KnowledgeGapsTab } from './KnowledgeGapsTab';
import { GuardrailsTab } from './GuardrailsTab';
import { ModelTab } from './ModelTab';
import { TestSetTab } from './TestSetTab';
import { TestAgentDrawer } from './TestAgentDrawer';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'knowledge', label: 'Knowledge & actions' },
  { key: 'gaps', label: 'Knowledge gaps' },
  { key: 'guardrails', label: 'Guardrails' },
  { key: 'model', label: 'Model' },
  { key: 'test-set', label: 'Test data' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export interface AgentContext {
  config: AgentConfig;
  draft: AgentPolicy;
  setDraft: (updater: (p: AgentPolicy) => AgentPolicy) => void;
  canEdit: boolean;
  reload: () => Promise<void>;
  applyConfig: (c: AgentConfig) => void;
  /** Opens the test chat; `sampleCustomer` starts it as that sample customer */
  openTest: (prefill?: string, sampleCustomer?: string) => void;
}

export function AiAgentView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { can } = useAuth();
  const canEdit = can('ai', 'update');

  const tab: TabKey = (TABS.find((t) => t.key === params.get('tab'))?.key ?? 'overview') as TabKey;
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [draft, setDraftState] = useState<AgentPolicy | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [note, setNote] = useState('');
  const [testOpen, setTestOpen] = useState(false);
  const [testPrefill, setTestPrefill] = useState<string | undefined>();
  const [testSample, setTestSample] = useState<string | undefined>();

  const applyConfig = useCallback((c: AgentConfig) => {
    setConfig(c);
    setDraftState(structuredClone(c.policy));
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      applyConfig(await aiAgentApi.getConfig());
    } catch (err) {
      setLoadError(err);
    }
  }, [applyConfig]);

  useEffect(() => { void load(); }, [load]);

  const dirty = useMemo(
    () => !!config && !!draft && JSON.stringify(config.policy) !== JSON.stringify(draft),
    [config, draft],
  );

  // Warn before leaving the page with unsaved guardrail/model changes
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  const setTab = (key: TabKey) => {
    const next = new URLSearchParams(params.toString());
    if (key === 'overview') next.delete('tab'); else next.set('tab', key);
    router.replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false });
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const c = await aiAgentApi.savePolicy(draft, note);
      applyConfig(c);
      setNote('');
      gooeyToast.success(`Saved as v${c.liveVersion?.version ?? ''}`, { description: 'The agent uses this version from the next message.' });
    } catch (err) {
      notifyError(err, { where: 'AiAgentView.save', title: "Couldn't save the agent settings" });
    } finally {
      setSaving(false);
    }
  };

  const toggleLive = async () => {
    if (!config) return;
    setToggling(true);
    try {
      const c = await aiAgentApi.setEnabled(!config.enabled);
      setConfig(c);
      if (!dirty) setDraftState(structuredClone(c.policy));
      gooeyToast.success(c.enabled ? 'AI agent is live' : 'AI agent paused', {
        description: c.enabled ? 'It replies to customers on your connected channels.' : 'Customer messages go to your team only.',
      });
    } catch (err) {
      notifyError(err, { where: 'AiAgentView.toggleLive', title: "Couldn't change the agent status" });
    } finally {
      setToggling(false);
    }
  };

  const ctx: AgentContext | null = config && draft ? {
    config,
    draft,
    setDraft: (updater) => setDraftState((p) => (p ? updater(structuredClone(p)) : p)),
    canEdit,
    reload: load,
    applyConfig,
    openTest: (prefill, sampleCustomer) => { setTestPrefill(prefill); setTestSample(sampleCustomer); setTestOpen(true); },
  } : null;

  const tabLabel = TABS.find((t) => t.key === tab)?.label ?? 'Overview';

  return (
    <div className="h-full flex flex-col bg-[#f7f8fc] overflow-hidden">
      <div className="px-8 pt-5 pb-0 bg-white border-b border-slate-200 shrink-0">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[12px] text-slate-500">
          <button onClick={() => setTab('overview')} className="hover:text-slate-700">AI agent</button>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-slate-800">{tabLabel}</span>
        </nav>
        <div className="flex flex-wrap items-end justify-between gap-3 mt-1">
          <h1 className="text-[22px] font-bold text-slate-900">{tabLabel}</h1>
          <div className="flex items-center gap-2 pb-1">
            {config && (
              <button
                onClick={toggleLive}
                disabled={!canEdit || toggling}
                title={canEdit ? (config.enabled ? 'Pause the agent' : 'Put the agent live') : 'Only admins can change this'}
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed
                  ${config.enabled ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                {toggling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span className={`h-2 w-2 rounded-full ${config.enabled ? 'bg-emerald-600' : 'bg-slate-400'}`} />}
                {config.enabled ? 'Agent live' : 'Agent paused'}
              </button>
            )}
            <button
              onClick={() => { setTestPrefill(undefined); setTestSample(undefined); setTestOpen(true); }}
              disabled={!config}
              className="inline-flex items-center gap-2 rounded-lg bg-[#3440a8] hover:bg-[#2a3490] px-4 py-2 text-[13px] font-semibold text-white transition-colors disabled:opacity-50"
            >
              <MessageCircle className="w-4 h-4" /> Test the agent
            </button>
          </div>
        </div>
        <div role="tablist" className="flex gap-6 mt-3 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`pb-2.5 text-[14px] font-medium whitespace-nowrap border-b-2 transition-colors
                ${tab === t.key ? 'border-[#3440a8] text-[#3440a8]' : 'border-transparent text-slate-600 hover:text-slate-900'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-8 py-6 max-w-[1400px]">
          {loadError ? (
            <ErrorState error={loadError} title="Couldn't load the AI agent" onRetry={load} />
          ) : !ctx ? (
            <LoadingState label="Loading AI agent…" />
          ) : tab === 'overview' ? (
            <OverviewTab ctx={ctx} goTo={setTab} />
          ) : tab === 'knowledge' ? (
            <KnowledgeTab ctx={ctx} />
          ) : tab === 'gaps' ? (
            <KnowledgeGapsTab ctx={ctx} goTo={setTab} />
          ) : tab === 'guardrails' ? (
            <GuardrailsTab ctx={ctx} />
          ) : tab === 'model' ? (
            <ModelTab ctx={ctx} />
          ) : (
            <TestSetTab ctx={ctx} goTo={setTab} />
          )}
        </div>
      </div>

      {dirty && ctx && (
        <div className="shrink-0 border-t border-slate-200 bg-white px-8 py-3 flex flex-wrap items-center gap-3">
          <span className="h-2 w-2 rounded-full bg-amber-500" />
          <span className="text-[13px] font-medium text-slate-700">Unsaved changes</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 200))}
            placeholder="What changed? (optional, shown in Versions)"
            className="flex-1 min-w-[200px] max-w-md rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3440a8]/20"
          />
          <div className="ml-auto flex gap-2">
            <button onClick={() => ctx.openTest()} className="rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
              Try changes
            </button>
            <button onClick={() => setDraftState(structuredClone(config!.policy))} disabled={saving} className="rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
              Discard
            </button>
            <button onClick={save} disabled={saving || !canEdit} className="inline-flex items-center gap-1.5 rounded-lg bg-[#3440a8] hover:bg-[#2a3490] px-4 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save as new version
            </button>
          </div>
        </div>
      )}

      {ctx && (
        <TestAgentDrawer
          open={testOpen}
          onClose={() => setTestOpen(false)}
          draft={dirty ? draft! : undefined}
          liveVersion={config!.liveVersion?.version}
          modelTier={draft!.modelTier}
          prefill={testPrefill}
          sampleCustomer={testSample}
        />
      )}
    </div>
  );
}
