'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, Copy, ExternalLink, Loader2, Plus, X } from 'lucide-react';
import { notifyError } from '@/lib/api/notify';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { ErrorState } from '@/components/ui/states';
import { SALES_GOALS, normalizeDomain, type WidgetSettings } from '@/lib/ai-agent/widget';
import { aiAgentApi, type WidgetConfig } from '@/components/ai-agent/api';
import { Select, Skeleton, Toggle } from '@/components/ai-agent/ui';

const input = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3440a8]/20 disabled:bg-slate-50';
const COLORS = ['#3440a8', '#0f766e', '#be123c', '#7c3aed', '#ea580c', '#0f172a'];

function Section({ title, subtitle, action, children }: {
  title: string;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-slate-100 py-5 first:border-t-0 first:pt-0">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold text-slate-900">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[12px] leading-snug text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[12px] font-semibold text-slate-700">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-[11.5px] text-slate-500 leading-snug">{hint}</span>}
    </label>
  );
}

/**
 * Settings › Channels › Website chat: the chat widget for any website (install code, sales assistant, look, where
 * order questions go) with a live preview. Visitor chats land in the inbox under this channel.
 */
export function WebchatSettings({ canEdit, onSaved }: { canEdit: boolean; onSaved?: () => void }) {
  const [agentLive, setAgentLive] = useState<boolean | null>(null);
  const [widget, setWidget] = useState<WidgetConfig | null>(null);
  const [draft, setDraft] = useState<{ enabled: boolean; settings: WidgetSettings } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [newButton, setNewButton] = useState('');
  const [newDomain, setNewDomain] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const w = await aiAgentApi.widget();
      setWidget(w);
      setDraft({ enabled: w.enabled, settings: structuredClone(w.settings) });
    } catch (err) {
      setError(err);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    aiAgentApi.getConfig().then((c) => setAgentLive(c.enabled), () => setAgentLive(null));
  }, []);
  const dirty = useMemo(() => !!widget && !!draft && JSON.stringify({ enabled: widget.enabled, settings: widget.settings }) !== JSON.stringify(draft), [widget, draft]);
  const set = (patch: Partial<WidgetSettings>) => setDraft((d) => (d ? { ...d, settings: { ...d.settings, ...patch } } : d));
  const s = draft?.settings;

  const origin = (process.env.NEXT_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/+$/, '');
  const snippet = widget?.publicKey ? `<script src="${origin}/api/widget/${widget.publicKey}/loader.js" async></script>` : '';

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const w = await aiAgentApi.saveWidget(draft);
      setWidget(w);
      setDraft({ enabled: w.enabled, settings: structuredClone(w.settings) });
      onSaved?.();
      gooeyToast.success(w.enabled ? 'Chat widget saved and live' : 'Chat widget saved', {
        description: w.enabled ? 'Visitors on your site see the changes on their next page load.' : 'Switch it on when you are ready to go live.',
      });
    } catch (err) {
      notifyError(err, { where: 'WebchatSettings.save', title: "Couldn't save the chat widget" });
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      gooeyToast.error("Couldn't copy. Select the code and copy it yourself.");
    }
  };

  if (error) return <ErrorState error={error} title="Couldn't load the chat widget" onRetry={load} />;
  if (!widget || !draft || !s) return <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-40" /><Skeleton className="h-40" /></div>;

  const addButton = () => {
    const t = newButton.trim().slice(0, 40);
    if (t && !s.starterButtons.includes(t) && s.starterButtons.length < 4) set({ starterButtons: [...s.starterButtons, t] });
    setNewButton('');
  };
  const addDomain = () => {
    const d = normalizeDomain(newDomain);
    if (!d) { gooeyToast.error('Enter a site address like mystore.com'); return; }
    if (!s.allowedDomains.includes(d)) set({ allowedDomains: [...s.allowedDomains, d] });
    setNewDomain('');
  };
  const storeOptions = [{ value: 0, label: widget.stores.length === 1 ? `${widget.stores[0].name} (your store)` : 'Choose a store' }, ...widget.stores.map((st) => ({ value: st.id, label: `${st.name}${st.needsReauth ? ' · reconnect needed' : ''}` }))];
  const noStore = widget.stores.length === 0;
  const storeMissing = s.sales.enabled && !noStore && widget.stores.length > 1 && !s.storeId;

  return (
    <div className="min-w-0">
      <div>
        <Section
          title="Install on your website"
          subtitle="A chat button for any website. Your AI agent welcomes visitors and helps them shop; every chat lands in your inbox."
          action={
            <span className="flex items-center gap-2 text-[13px] font-semibold text-slate-700">
              {draft.enabled ? 'Live' : 'Off'}
              <Toggle checked={draft.enabled} onChange={(v) => setDraft({ ...draft, enabled: v })} disabled={!canEdit} label="Widget live" />
            </span>
          }
        >
          {agentLive === false && (
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
              Your AI agent is paused, so visitors&apos; messages wait in the inbox for your team. Put it live under <Link href="/ai-agent" className="font-semibold underline">AI agent</Link>.
            </p>
          )}
          {snippet ? (
            <>
              <p className="text-[13px] text-slate-600">
                Paste this just before <code className="rounded bg-slate-100 px-1 text-[12px]">&lt;/body&gt;</code> on every page of the website. It works on any site:
                Shopify, WordPress, Wix or your own.
              </p>
              <details className="mt-1.5 text-[12.5px] text-slate-600">
                <summary className="cursor-pointer font-semibold text-[#3440a8]">On Shopify</summary>
                <ol className="mt-1 ml-4 list-decimal space-y-0.5">
                  <li>In Shopify admin: Online Store › Themes › ⋯ next to your theme › Edit code.</li>
                  <li>Open <b>layout/theme.liquid</b> and paste the code just above <code>&lt;/body&gt;</code>.</li>
                  <li>Save, then open your store: the chat button appears at the bottom.</li>
                </ol>
              </details>
              <div className="mt-2 flex items-stretch gap-2">
                <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-slate-900 px-3 py-2.5 text-[12px] text-slate-100">{snippet}</code>
                <button type="button" onClick={copy} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
                  {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />} {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              {widget.enabled && (
                <a href={`${origin}/api/widget/${widget.publicKey}/frame`} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-semibold text-[#3440a8] hover:underline">
                  Open the live chat in a new tab <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </>
          ) : (
            <p className="text-[13px] text-slate-600">Save the widget once to get your embed code.</p>
          )}
          <div className="mt-4">
            <Field label="Allowed websites (optional)" hint="Leave empty and the widget runs on any website you paste it on. Add sites to restrict it to them (subdomains included).">
              <div className="flex flex-wrap gap-1.5 mb-2">
                {s.allowedDomains.map((d) => (
                  <span key={d} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[12px] text-slate-700">
                    {d}
                    {canEdit && <button type="button" aria-label={`Remove ${d}`} onClick={() => set({ allowedDomains: s.allowedDomains.filter((x) => x !== d) })}><X className="w-3 h-3" /></button>}
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={newDomain} onChange={(e) => setNewDomain(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDomain(); } }} placeholder="mystore.com" disabled={!canEdit} className={`${input} min-w-0`} />
                <button type="button" onClick={addDomain} disabled={!canEdit || !newDomain.trim()} className="shrink-0 rounded-lg border border-slate-200 px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Add</button>
              </div>
            </Field>
          </div>
        </Section>

        <Section title="Sales assistant" subtitle="Turns questions into orders: recommends products from your store with photos, prices and a Buy now button.">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-medium text-slate-800">Recommend products and help visitors buy</span>
              <Toggle checked={s.sales.enabled} onChange={(v) => set({ sales: { ...s.sales, enabled: v } })} disabled={!canEdit} label="Recommend products and help visitors buy" />
            </div>
            {s.sales.enabled && (
              <>
                {noStore ? (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
                    Connect your Shopify store under <Link href="/integrations" className="font-semibold underline">Integrations</Link> so the assistant can show your products.
                  </p>
                ) : (
                  <Field label="Products from" hint={storeMissing ? <span className="text-amber-700">Choose the store whose products the widget shows.</span> : 'Only products published to your online store are shown. Buy now opens checkout with the product in the cart.'}>
                    <Select label="Store" value={s.storeId ?? 0} disabled={!canEdit} onChange={(v) => set({ storeId: v ? Number(v) : null })} options={storeOptions} />
                  </Field>
                )}
                <div>
                  <span className="text-[12px] font-semibold text-slate-700">How actively it sells</span>
                  <div className="mt-1 grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup">
                    {SALES_GOALS.map((g) => (
                      <button
                        key={g.value}
                        type="button"
                        role="radio"
                        aria-checked={s.sales.goal === g.value}
                        disabled={!canEdit}
                        onClick={() => set({ sales: { ...s.sales, goal: g.value } })}
                        className={`rounded-lg border-2 p-2.5 text-left ${s.sales.goal === g.value ? 'border-[#3440a8] bg-indigo-50/60' : 'border-slate-200 hover:border-slate-300'}`}
                      >
                        <span className="block text-[13px] font-semibold text-slate-900">{g.label}</span>
                        <span className="block text-[11.5px] text-slate-500 leading-snug">{g.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <Field label="Offer to mention (optional)" hint="The assistant mentions it once, when a visitor is deciding or asks about deals. It never invents other discounts.">
                  <input value={s.sales.offer} onChange={(e) => set({ sales: { ...s.sales, offer: e.target.value.slice(0, 200) } })} disabled={!canEdit} placeholder="Use WELCOME10 for 10% off your first order" className={input} />
                </Field>
              </>
            )}
          </div>
        </Section>

        <Section title="Look and greeting">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Assistant name"><input value={s.name} onChange={(e) => set({ name: e.target.value.slice(0, 40) })} disabled={!canEdit} className={input} /></Field>
            <Field label="Status line"><input value={s.subtitle} onChange={(e) => set({ subtitle: e.target.value.slice(0, 60) })} disabled={!canEdit} className={input} /></Field>
            <div className="sm:col-span-2">
              <Field label="Greeting" hint="The first message visitors see when they open the chat.">
                <textarea rows={2} value={s.greeting} onChange={(e) => set({ greeting: e.target.value.slice(0, 400) })} disabled={!canEdit} className={`${input} resize-y`} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Invitation bubble" hint="Pops up next to the chat button to start the conversation. Leave empty for none.">
                <div className="flex flex-wrap gap-2 sm:flex-nowrap">
                  <input value={s.teaser} onChange={(e) => set({ teaser: e.target.value.slice(0, 120) })} disabled={!canEdit} className={input} />
                  <Select label="Show after" className="w-full shrink-0 sm:w-[150px]" value={s.teaserDelaySec} disabled={!canEdit || !s.teaser} onChange={(v) => set({ teaserDelaySec: Number(v) })}
                    options={[0, 3, 8, 15, 30, 60].map((n) => ({ value: n, label: n === 0 ? 'Immediately' : `After ${n} s` }))} />
                </div>
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label={`Starter buttons (${s.starterButtons.length}/4)`} hint="Shown under the greeting so visitors can start with one tap.">
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {s.starterButtons.map((b) => (
                    <span key={b} className="inline-flex items-center gap-1 rounded-full border border-[#3440a8]/40 px-2.5 py-1 text-[12px] text-[#3440a8]">
                      {b}
                      {canEdit && <button type="button" aria-label={`Remove ${b}`} onClick={() => set({ starterButtons: s.starterButtons.filter((x) => x !== b) })}><X className="w-3 h-3" /></button>}
                    </span>
                  ))}
                </div>
                {s.starterButtons.length < 4 && (
                  <div className="flex gap-2">
                    <input value={newButton} onChange={(e) => setNewButton(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addButton(); } }} placeholder="e.g. New arrivals" disabled={!canEdit} className={input} />
                    <button type="button" onClick={addButton} disabled={!canEdit || !newButton.trim()} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Plus className="w-3.5 h-3.5" /> Add</button>
                  </div>
                )}
              </Field>
            </div>
            <Field label="Colour">
              <div className="flex flex-wrap items-center gap-2">
                {COLORS.map((c) => (
                  <button key={c} type="button" aria-label={`Colour ${c}`} disabled={!canEdit} onClick={() => set({ color: c })} className={`h-7 w-7 rounded-full ring-offset-2 ${s.color === c ? 'ring-2 ring-slate-900' : ''}`} style={{ background: c }} />
                ))}
                <input type="color" aria-label="Custom colour" value={s.color} disabled={!canEdit} onChange={(e) => set({ color: e.target.value })} className="h-7 w-9 cursor-pointer rounded border border-slate-200 bg-white" />
              </div>
            </Field>
            <Field label="Position">
              <Select label="Position" value={s.position} disabled={!canEdit} onChange={(v) => set({ position: v as WidgetSettings['position'] })} options={[{ value: 'right', label: 'Bottom right' }, { value: 'left', label: 'Bottom left' }]} />
            </Field>
          </div>
        </Section>

        <Section title="Order questions" subtitle="Website visitors aren't signed in, so the chat doesn't look orders up.">
          <Field label="Send order questions to WhatsApp" hint="Where's my order, returns, refunds, exchanges, delivery address: the visitor gets a Continue on WhatsApp button, where your team verifies them and sees their orders. Anything else the AI hands over waits for your team in the inbox.">
            <Select
              label="WhatsApp number"
              value={s.whatsappNumber}
              disabled={!canEdit}
              onChange={(v) => set({ whatsappNumber: String(v) })}
              options={[
                { value: '', label: widget.whatsappNumbers.length ? `Automatic (${widget.whatsappNumbers[0].label})` : 'No WhatsApp number connected' },
                ...widget.whatsappNumbers.map((n) => ({ value: n.number, label: n.label })),
              ]}
            />
          </Field>
        </Section>

        <div className="mt-1 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-4 py-3">
          {dirty ? <><span className="h-2 w-2 rounded-full bg-amber-500" /><span className="text-[13px] font-medium text-slate-700">Unsaved widget changes</span></> : <span className="text-[13px] text-slate-500">{widget.enabled ? 'Widget is live' : 'Widget is off'}</span>}
          <div className="ml-auto flex gap-2">
            {dirty && <button type="button" onClick={() => setDraft({ enabled: widget.enabled, settings: structuredClone(widget.settings) })} className="rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">Discard</button>}
            <button type="button" onClick={save} disabled={!canEdit || saving || !dirty} className="inline-flex items-center gap-1.5 rounded-lg bg-[#3440a8] hover:bg-[#2a3490] px-4 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save widget
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}
