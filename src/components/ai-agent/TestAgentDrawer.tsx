'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Loader2, LogIn, Send, UserRound, X } from 'lucide-react';
import { notifyError } from '@/lib/api/notify';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { HANDOVER_REASON_LABELS, type AgentPolicy, type ModelTier } from '@/lib/ai-agent/policy';
import { aiAgentApi, type ChatReply, type SampleData } from './api';

type Msg = { role: 'user' | 'assistant'; content: string; reply?: ChatReply };
/** The website chat has its own live preview (Settings › Channels › Website chat) */
type Channel = 'whatsapp' | 'instagram';
/** Who the test chat is with: an anonymous visitor, a sample customer (sample orders) or a real one (live store) */
type Who = 'anonymous' | 'sample' | 'custom';

const newConversationId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function TestAgentDrawer({ open, onClose, draft, liveVersion, modelTier, prefill, sampleCustomer }: {
  open: boolean;
  onClose: () => void;
  /** Unsaved policy to try; undefined = the live version. */
  draft?: AgentPolicy;
  liveVersion?: number;
  modelTier: ModelTier;
  prefill?: string;
  /** Start as this sample customer (from Test data) */
  sampleCustomer?: string;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState(newConversationId);
  const [channel, setChannel] = useState<Channel>('whatsapp');
  const [testAs, setTestAs] = useState({ name: '', phone: '', id: '' });
  const [showIdentity, setShowIdentity] = useState(false);
  const [who, setWho] = useState<Who>('anonymous');
  const [sampleRef, setSampleRef] = useState('');
  const [sample, setSample] = useState<SampleData | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && prefill) setInput(prefill);
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, prefill]);

  // Sample customers to test as (Test data > Sample orders)
  useEffect(() => {
    if (!open) return;
    aiAgentApi.sampleData().then(setSample, () => setSample(null));
  }, [open]);
  useEffect(() => {
    if (open && sampleCustomer) {
      setWho('sample');
      setSampleRef(sampleCustomer);
      setMessages([]);
      setConversationId(newConversationId());
      if (!prefill) setInput('Where is my order?');
    }
  }, [open, sampleCustomer, prefill]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, sending]);

  const last = [...messages].reverse().find((m) => m.reply)?.reply;

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || sending) return;
    const history: Msg[] = [...messages, { role: 'user', content }];
    setMessages(history);
    setInput('');
    setSending(true);
    try {
      const reply = await aiAgentApi.testChat({
        conversationId,
        messages: history.map(({ role, content: c }) => ({ role, content: c })),
        testAs: who === 'custom' ? { name: testAs.name || undefined, phone: testAs.phone || undefined, id: testAs.id || undefined } : undefined,
        sample: who === 'sample' && sampleRef ? { customerRef: sampleRef } : undefined,
        channel,
        policy: draft,
      });
      setMessages([...history, { role: 'assistant', content: reply.reply, reply }]);
    } catch (err) {
      setMessages(history.slice(0, -1));
      setInput(content);
      notifyError(err, { where: 'TestAgentDrawer.send', title: "The agent didn't reply" });
    } finally {
      setSending(false);
    }
  };

  const reset = () => {
    setMessages([]);
    setConversationId(newConversationId());
    setInput('');
  };

  const addToTestSet = async () => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser || !last) return;
    try {
      await aiAgentApi.addTestCases({
        cases: [{
          question: lastUser.content,
          expected: last.outcome === 'handover' ? 'Hand over' : '',
          category: last.route === 'tool' ? 'Order status' : last.outcome === 'handover' ? 'Handover' : 'Policy & FAQ',
          expectOutcome: last.outcome === 'handover' ? 'handover' : last.outcome === 'blocked' ? 'refuse' : 'answered',
          asUser: who === 'custom' ? { id: testAs.id, phone: testAs.phone, name: testAs.name } : undefined,
        }],
      });
      gooeyToast.success('Added to your checks', { description: 'Set what a good answer must include under Test data › Checks.' });
    } catch (err) {
      notifyError(err, { where: 'TestAgentDrawer.addToTestSet', title: "Couldn't add to your checks" });
    }
  };

  if (!open) return null;
  const wa = channel === 'whatsapp';
  const identity = testAs.name || testAs.phone || testAs.id;
  const customers = sample?.orders?.customers ?? [];
  const chosen = customers.find((c) => c.ref === sampleRef);
  const switchWho = (w: Who) => {
    setWho(w);
    if (w === 'sample' && !sampleRef && customers[0]) setSampleRef(customers[0].ref);
    setShowIdentity(w === 'custom');
    reset();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <aside role="dialog" aria-label="Test the agent" className="relative flex h-full w-full max-w-[980px] flex-col bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 px-6 pt-5">
          <div>
            <h2 className="text-[20px] font-bold text-slate-900">Test the agent</h2>
            <p className="text-[13px] text-slate-500">Chat as a customer. Nothing is sent on WhatsApp or Instagram.</p>
          </div>
          <button aria-label="Close" onClick={onClose} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </header>

        <div className="flex flex-wrap items-center gap-3 px-6 pt-4">
          <span className="text-[13px] font-semibold text-slate-700">Test as</span>
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5" role="radiogroup" aria-label="Test as">
            {([['anonymous', 'Anonymous visitor'], ['sample', 'Sample customer'], ['custom', 'Real customer']] as [Who, string][]).map(([w, label]) => (
              <button key={w} type="button" role="radio" aria-checked={who === w} onClick={() => switchWho(w)}
                className={`rounded-md px-3 py-1 text-[12.5px] font-semibold ${who === w ? 'bg-[#3440a8] text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                {label}
              </button>
            ))}
          </div>
          {who === 'sample' && (customers.length ? (
            <select value={sampleRef} onChange={(e) => { setSampleRef(e.target.value); reset(); }} aria-label="Sample customer"
              className="max-w-[340px] rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3440a8]/20">
              {customers.map((c) => (
                <option key={c.ref} value={c.ref}>
                  {[c.name || c.email || c.phone || 'Guest', `${c.orders} order${c.orders === 1 ? '' : 's'}`, c.latest].filter(Boolean).join(' · ')}
                </option>
              ))}
            </select>
          ) : <span className="text-[12px] text-amber-700">No sample orders yet. Upload them under Test data › Sample data.</span>)}
          {who === 'custom' && (
            <button onClick={() => setShowIdentity((v) => !v)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] text-slate-800 hover:bg-slate-50">
              <UserRound className="w-4 h-4 text-slate-400" />
              {identity ? [testAs.name, testAs.phone || (testAs.id && `#${testAs.id}`)].filter(Boolean).join(' · ') : 'Enter their phone'}
            </button>
          )}
          <span className="text-[12px] text-slate-500">
            {who === 'anonymous' ? 'Order questions ask the customer to sign in'
              : who === 'sample' ? (chosen ? 'Orders come from your sample data' : '')
                : 'Orders come from your connected store'}
          </span>
        </div>
        {who === 'custom' && showIdentity && (
          <div className="mx-6 mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3">
            {(['name', 'phone', 'id'] as const).map((k) => (
              <input
                key={k}
                value={testAs[k]}
                onChange={(e) => { setTestAs((t) => ({ ...t, [k]: e.target.value })); }}
                placeholder={k === 'name' ? 'Customer name' : k === 'phone' ? 'Phone (+91…)' : 'Store customer id'}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3440a8]/20"
              />
            ))}
            <p className="sm:col-span-3 text-[11px] text-slate-500">Orders are looked up in your connected Shopify store by this phone, read-only. Changing it starts a new chat.</p>
            <button onClick={() => { reset(); setShowIdentity(false); }} className="sm:col-span-3 justify-self-start rounded-lg bg-[#3440a8] px-3 py-1.5 text-[12px] font-semibold text-white">Use this customer</button>
          </div>
        )}

        <div className="flex min-h-0 flex-1 gap-5 px-6 py-4">
          <div className="flex min-w-0 flex-1 flex-col">
            <div ref={scrollRef} className={`flex-1 overflow-y-auto rounded-2xl p-4 space-y-3 ${wa ? 'bg-[#efeae2]' : 'bg-white border border-slate-200'}`}>
              {messages.length === 0 && (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-[13px] text-slate-500">
                  Try a greeting, an order question, or something the agent should refuse.
                  <div className="flex flex-wrap justify-center gap-2">
                    {['Hi', 'Where is my order?', 'Can I change the size to L?', 'Can you give me 50% off?'].map((s) => (
                      <button key={s} onClick={() => send(s)} className="rounded-full bg-white px-3 py-1.5 text-[12px] font-medium text-[#3440a8] shadow-sm hover:bg-indigo-50">{s}</button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed shadow-sm
                    ${m.role === 'user'
                      ? wa ? 'bg-[#d9fdd3] text-slate-900' : 'bg-gradient-to-r from-[#7b3fe4] to-[#c13584] text-white'
                      : wa ? 'bg-white text-slate-900' : 'bg-slate-100 text-slate-900'}`}>
                    {m.content}
                    {!!m.reply?.products?.length && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {m.reply.products.map((p) => (
                          <span key={p.ref} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-700">
                            {p.title}{p.price ? <b className="font-semibold">{p.price}</b> : null}{!p.available && <span className="text-red-600">sold out</span>}
                          </span>
                        ))}
                      </div>
                    )}
                    {m.reply?.action?.type === 'login' && (
                      <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[#3440a8]/30 px-2.5 py-1 text-[12px] font-semibold text-[#3440a8]"><LogIn className="w-3.5 h-3.5" /> Sign in button</div>
                    )}
                    {m.reply?.outcome === 'handover' && (
                      <div className="mt-2 text-[11px] font-semibold text-amber-700">Handed to your team · {HANDOVER_REASON_LABELS[m.reply.handover_reason ?? ''] ?? m.reply.handover_reason}</div>
                    )}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex justify-start"><div className={`rounded-2xl px-4 py-3 shadow-sm ${wa ? 'bg-white' : 'bg-slate-100'}`}><Loader2 className="w-4 h-4 animate-spin text-slate-400" /></div></div>
              )}
            </div>
            {last && last.suggestions.length > 0 && !sending && (
              <div className="mt-2 flex flex-wrap gap-2">
                {last.suggestions.map((s) => (
                  <button key={s} onClick={() => send(s)} className="rounded-full border border-[#3440a8]/30 px-3 py-1 text-[12px] font-medium text-[#3440a8] hover:bg-indigo-50">{s}</button>
                ))}
              </div>
            )}
            <form onSubmit={(e) => { e.preventDefault(); void send(input); }} className="mt-3 flex items-center gap-3">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                maxLength={2000}
                placeholder="Type a customer message…"
                className="flex-1 rounded-full bg-slate-100 px-5 py-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#3440a8]/20"
              />
              <button type="submit" aria-label="Send" disabled={sending || !input.trim()} className="flex h-11 w-11 items-center justify-center rounded-full bg-[#3440a8] text-white disabled:opacity-50">
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>

          <WhyPanel reply={last} onAdd={addToTestSet} onReset={reset} canAdd={!!last} />
        </div>

        <footer className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-6 py-4">
          <span className="text-[13px] font-semibold text-slate-700">Channel preview</span>
          {(['whatsapp', 'instagram'] as Channel[]).map((c) => (
            <button key={c} onClick={() => { setChannel(c); reset(); }}
              className={`rounded-full px-4 py-1.5 text-[13px] font-semibold ${channel === c ? 'bg-[#3440a8] text-white' : 'border border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
              {c === 'whatsapp' ? 'WhatsApp' : 'Instagram'}
            </button>
          ))}
          <span className="ml-auto text-[13px] text-slate-500">
            {draft ? <span className="font-semibold text-amber-700">Uses your unsaved changes</span> : `Uses ${liveVersion ? `v${liveVersion}` : 'default settings'}`} · {modelTier === 'advanced' ? 'Advanced' : modelTier === 'byo' ? 'Own model' : 'Standard'}
          </span>
          <p className="w-full text-[12px] text-slate-500">Test chats don&apos;t count toward AI resolutions or your Overview numbers.</p>
        </footer>
      </aside>
    </div>
  );
}

function WhyPanel({ reply, onAdd, onReset, canAdd }: { reply?: ChatReply; onAdd: () => void; onReset: () => void; canAdd: boolean }) {
  const tool = reply?.trace?.tool as { name?: string; orders?: string[]; state?: string } | undefined;
  const section = (title: string, children: React.ReactNode) => (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</div>
      {children}
    </div>
  );
  const box = (dot: string, title: React.ReactNode, sub?: React.ReactNode) => (
    <div className="rounded-xl border border-slate-200 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-slate-800">{title}</div>
          {sub && <div className="text-[12px] text-slate-500 truncate">{sub}</div>}
        </div>
      </div>
    </div>
  );

  return (
    <div className="hidden md:flex w-[290px] shrink-0 flex-col gap-4 overflow-y-auto">
      <div>
        <h3 className="text-[16px] font-bold text-slate-900">Why this answer</h3>
        <p className="text-[12px] text-slate-500">Last reply</p>
      </div>
      {!reply ? <p className="text-[13px] text-slate-500">Send a message to see what the agent used and which rules it checked.</p> : (
        <>
          {section('Route', box('bg-emerald-600', ROUTE_LABEL[reply.route] ?? reply.route, reply.outcome === 'answered' ? 'Answered' : reply.outcome))}
          {tool?.name && section('Live data', box('bg-[#3440a8]',
            tool.orders?.length ? `Order${tool.orders.length > 1 ? 's' : ''} ${tool.orders.join(', ')}` : 'Order lookup',
            tool.state ? (ORDER_STATE_LABEL[tool.state] ?? tool.state.replace(/_/g, ' ')) : undefined))}
          {reply.citations.length > 0 && section('Knowledge used', (
            <div className="space-y-2">{reply.citations.slice(0, 3).map((c) => <div key={`${c.source_id}-${c.title}`}>{box('bg-[#3440a8]', c.title ?? 'Article', c.url ?? undefined)}</div>)}</div>
          ))}
          {section('Guardrails', reply.outcome === 'handover'
            ? box('bg-amber-600', HANDOVER_REASON_LABELS[reply.handover_reason ?? ''] ?? 'Handed over', 'Handover rule hit')
            : reply.outcome === 'blocked' || reply.flags.includes('never_say_blocked')
              ? box('bg-red-600', reply.flags.includes('never_say_blocked') ? 'Never-say rule' : 'Safety rule', 'Reply replaced with a refusal')
              : box('bg-emerald-600', 'No handover rule hit', reply.confidence != null ? `Confidence ${reply.confidence.toFixed(2)}` : undefined))}
          <p className="text-[12px] text-slate-500">
            {reply.usage.model ? `Tokens ${(reply.usage.input_tokens + reply.usage.output_tokens).toLocaleString()} · ` : 'No AI call · '}
            {(reply.latency_ms / 1000).toFixed(1)} s
          </p>
        </>
      )}
      <div className="mt-auto space-y-2">
        <button onClick={onAdd} disabled={!canAdd} className="w-full rounded-xl border border-slate-200 py-2.5 text-[14px] font-semibold text-[#3440a8] hover:bg-indigo-50 disabled:opacity-50">Add to test set</button>
        <button onClick={onReset} className="w-full rounded-xl border border-slate-200 py-2.5 text-[14px] font-semibold text-slate-700 hover:bg-slate-50">Reset chat</button>
      </div>
    </div>
  );
}

const ORDER_STATE_LABEL: Record<string, string> = {
  not_signed_in: 'Customer not signed in',
  no_orders: 'Signed in · no orders found for this customer',
};

const ROUTE_LABEL: Record<string, string> = {
  rag: 'Answer from knowledge',
  cache: 'Saved answer (no AI call)',
  flow: 'Keyword reply',
  tool: 'Order data',
  sales: 'Shopping assistant (products)',
  guardrail: 'Rule-based reply',
  fallback: 'Fallback',
};
