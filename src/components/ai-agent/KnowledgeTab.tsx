'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Globe, HelpCircle, Loader2, Lock, Pencil, Plus, RefreshCw, Trash2, Upload, FileType2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { ErrorState } from '@/components/ui/states';
import { notifyError } from '@/lib/api/notify';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { aiAgentApi, type KnowledgeSource, type KnowledgeStats } from './api';
import { Card, Pill, Skeleton, Toggle, timeAgo } from './ui';
import type { AgentContext } from './AiAgentView';

const TYPE_META: Record<KnowledgeSource['type'], { label: string; icon: React.FC<{ className?: string }> }> = {
  faq: { label: 'FAQ', icon: HelpCircle },
  text: { label: 'Text', icon: FileText },
  markdown: { label: 'Article', icon: FileText },
  url: { label: 'Website', icon: Globe },
  pdf: { label: 'PDF', icon: FileType2 },
};

type Editor =
  | { mode: 'add' }
  | { mode: 'edit'; source: KnowledgeSource; content: string; uri: string };

export function KnowledgeTab({ ctx }: { ctx: AgentContext }) {
  const [data, setData] = useState<{ sources: KnowledgeSource[]; stats: KnowledgeStats } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<KnowledgeSource | null>(null);
  const canCreate = ctx.canEdit;

  const load = useCallback(async () => {
    try {
      setData(await aiAgentApi.knowledge());
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Poll while something is being indexed
  const processing = data?.sources.some((s) => s.status === 'queued' || s.status === 'syncing');
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [processing, load]);

  const run = async (id: string, fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(id);
    try {
      await fn();
      if (okMsg) gooeyToast.success(okMsg);
      await load();
    } catch (err) {
      notifyError(err, { where: 'KnowledgeTab', title: "Couldn't update knowledge" });
    } finally {
      setBusy(null);
    }
  };

  const openEdit = async (s: KnowledgeSource) => {
    setBusy(s.id);
    try {
      const full = await aiAgentApi.knowledgeContent(s.id);
      setEditor({ mode: 'edit', source: s, content: full.content ?? '', uri: full.uri ?? '' });
    } catch (err) {
      notifyError(err, { where: 'KnowledgeTab.openEdit', title: "Couldn't open this source" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1.65fr_1fr] gap-6 items-start">
      <Card
        title="Knowledge"
        subtitle={data ? `${data.stats.items.toLocaleString()} items from ${data.stats.live_sources} live source${data.stats.live_sources === 1 ? '' : 's'}${data.stats.last_synced_at ? ` · updated ${timeAgo(data.stats.last_synced_at)}` : ''}` : 'What the agent answers from'}
        action={canCreate && (
          <button onClick={() => setEditor({ mode: 'add' })} className="inline-flex items-center gap-1.5 rounded-lg bg-[#3440a8] hover:bg-[#2a3490] px-3 py-2 text-[13px] font-semibold text-white">
            <Plus className="w-4 h-4" /> Add source
          </button>
        )}
        bodyClassName="p-0 pt-3"
      >
        {error ? (
          <div className="p-5"><ErrorState error={error} title="Couldn't load knowledge" onRetry={load} compact /></div>
        ) : !data ? (
          <div className="p-5 space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : data.sources.length === 0 ? (
          <div className="px-5 pb-6 text-[13px] text-slate-500">
            No knowledge yet. Add your FAQs, return and shipping policies, size guide (PDF) or your help-centre website.
            The agent answers only from what you add here.
          </div>
        ) : (
          <ul>
            {data.sources.map((s) => {
              const Meta = TYPE_META[s.type];
              const working = s.status === 'queued' || s.status === 'syncing';
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-5 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-[#3440a8]"><Meta.icon className="w-4 h-4" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[14px] font-medium text-slate-800" title={s.title}>{s.title}</span>
                      {!!s.flagged_count && (
                        <span title="These passages talk to the AI (e.g. 'ignore your instructions'), so the agent never reads them. Check the page or file."
                          className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                          {s.flagged_count} passage{s.flagged_count === 1 ? '' : 's'} ignored
                        </span>
                      )}
                    </div>
                    <div className="text-[12px] text-slate-500 truncate">
                      {Meta.label} · {s.item_count} item{s.item_count === 1 ? '' : 's'}
                      {s.last_synced_at && ` · synced ${timeAgo(s.last_synced_at)}`}
                      {s.status === 'error' && s.error && <span className="text-red-600"> · {s.error}</span>}
                      {s.status === 'live' && s.error && <span className="text-amber-700"> · {s.error}</span>}
                    </div>
                  </div>
                  {working ? <Pill tone="blue"><Loader2 className="w-3 h-3 animate-spin" /> Indexing</Pill>
                    : s.status === 'error' ? <Pill tone="red" dot>Failed</Pill>
                    : s.enabled ? <Pill tone="green" dot>Live</Pill> : <Pill tone="amber" dot>Draft</Pill>}
                  <Toggle
                    label={s.enabled ? 'Switch off (draft)' : 'Switch on'}
                    checked={s.enabled}
                    disabled={!ctx.canEdit || busy === s.id}
                    onChange={(v) => run(s.id, () => aiAgentApi.updateKnowledge(s.id, { enabled: v }), v ? `${s.title} is live` : `${s.title} is now a draft`)}
                  />
                  <div className="flex items-center">
                    {ctx.canEdit && s.type !== 'pdf' && (
                      <button title="Edit" onClick={() => openEdit(s)} disabled={busy === s.id} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                        {busy === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />}
                      </button>
                    )}
                    {ctx.canEdit && s.type === 'url' && (
                      <button title="Sync website again" onClick={() => run(s.id, () => aiAgentApi.syncKnowledge(s.id), 'Syncing started')} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    )}
                    {ctx.canEdit && (
                      <button title="Delete" onClick={() => setConfirmDelete(s)} className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <ActionsCard ctx={ctx} />

      {editor && (
        <SourceEditor
          editor={editor}
          onClose={() => setEditor(null)}
          onSaved={async () => { setEditor(null); await load(); }}
        />
      )}

      <Modal isOpen={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete this source?" maxWidth="md">
        <p className="text-[13px] text-slate-600">
          <strong>{confirmDelete?.title}</strong> and everything indexed from it will be removed. The agent stops using it immediately. This can't be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setConfirmDelete(null)} className="rounded-lg border border-slate-200 px-3 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button
            onClick={() => { const s = confirmDelete!; setConfirmDelete(null); void run(s.id, () => aiAgentApi.deleteKnowledge(s.id), 'Source deleted'); }}
            className="rounded-lg bg-red-600 px-3 py-2 text-[13px] font-semibold text-white hover:bg-red-700"
          >
            Delete
          </button>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------- add / edit

const ADD_TYPES = [
  { key: 'faq', label: 'FAQ', hint: 'One question and answer per block:\nQ: Do you offer COD?\nA: Yes, cash on delivery is available up to ₹5,000.' },
  { key: 'markdown', label: 'Article', hint: 'Paste a policy or help article. Headings (#) become sections.' },
  { key: 'url', label: 'Website', hint: 'Your help centre or policy page. We fetch and index the page.' },
  { key: 'pdf', label: 'PDF', hint: 'Size guides, catalogues, policies. Up to 20 MB; scanned pages need a text layer.' },
] as const;

function SourceEditor({ editor, onClose, onSaved }: { editor: Editor; onClose: () => void; onSaved: () => Promise<void> }) {
  const editing = editor.mode === 'edit' ? editor.source : null;
  const [type, setType] = useState<string>(editing?.type ?? 'faq');
  const [title, setTitle] = useState(editing?.title ?? '');
  const [content, setContent] = useState(editor.mode === 'edit' ? editor.content : '');
  const [uri, setUri] = useState(editor.mode === 'edit' ? editor.uri : '');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const meta = ADD_TYPES.find((t) => t.key === type) ?? ADD_TYPES[1];

  const valid = title.trim() && (type === 'url' ? /^https?:\/\//.test(uri.trim()) : type === 'pdf' ? !!file || !!editing : content.trim());

  const save = async () => {
    setSaving(true);
    try {
      if (editing) {
        await aiAgentApi.updateKnowledge(editing.id, {
          title: title.trim(),
          ...(editing.type === 'url' ? { uri: uri.trim() } : { content }),
        });
        gooeyToast.success('Saved', { description: 'Changes are being re-indexed.' });
      } else if (type === 'pdf' && file) {
        await aiAgentApi.uploadPdf(file, title.trim());
        gooeyToast.success('PDF uploaded', { description: 'Indexing in the background.' });
      } else {
        await aiAgentApi.addKnowledge({ type, title: title.trim(), content: type === 'url' ? undefined : content, uri: type === 'url' ? uri.trim() : undefined });
        gooeyToast.success('Source added', { description: 'Indexing in the background.' });
      }
      await onSaved();
    } catch (err) {
      notifyError(err, { where: 'KnowledgeTab.save', title: "Couldn't save the source" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={editing ? `Edit ${editing.title}` : 'Add knowledge'} maxWidth="2xl">
      <div className="space-y-4">
        {!editing && (
          <div className="flex gap-2">
            {ADD_TYPES.map((t) => (
              <button
                key={t.key}
                onClick={() => setType(t.key)}
                className={`rounded-lg border px-3 py-1.5 text-[13px] font-medium ${type === t.key ? 'border-[#3440a8] bg-indigo-50 text-[#3440a8]' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        <label className="block">
          <span className="text-[12px] font-semibold text-slate-700">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} placeholder="e.g. Store policies" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3440a8]/20" />
        </label>
        {type === 'url' ? (
          <label className="block">
            <span className="text-[12px] font-semibold text-slate-700">Page address</span>
            <input value={uri} onChange={(e) => setUri(e.target.value)} placeholder="https://yourstore.com/pages/faq" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3440a8]/20" />
          </label>
        ) : type === 'pdf' ? (
          <div>
            <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !title) setTitle(f.name.replace(/\.pdf$/i, ''));
            }} />
            <button onClick={() => fileRef.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 py-8 text-[13px] text-slate-600 hover:border-[#3440a8]/40 hover:bg-indigo-50/40">
              <Upload className="w-4 h-4" /> {file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB` : 'Choose a PDF'}
            </button>
          </div>
        ) : (
          <label className="block">
            <span className="text-[12px] font-semibold text-slate-700">Content</span>
            <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={12} placeholder={meta.hint} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-[12px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#3440a8]/20" />
          </label>
        )}
        {!editing && <p className="text-[12px] text-slate-500 whitespace-pre-line">{meta.hint}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={!valid || saving} className="inline-flex items-center gap-1.5 rounded-lg bg-[#3440a8] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#2a3490] disabled:opacity-50">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {editing ? 'Save and re-index' : 'Add source'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- skills / actions

function ActionsCard({ ctx }: { ctx: AgentContext }) {
  const { draft, setDraft, canEdit } = ctx;
  const [chip, setChip] = useState('');

  const rows: { title: string; sub: string; control: React.ReactNode }[] = [
    {
      title: 'Answer from knowledge',
      sub: 'FAQs, policies and help articles, with sources',
      control: <Toggle label="Answer from knowledge" checked={draft.skills.faq} disabled={!canEdit} onChange={(v) => setDraft((p) => ({ ...p, skills: { ...p.skills, faq: v } }))} />,
    },
    {
      title: 'Order status (WISMO)',
      sub: 'Signed-in customers only · their own orders, no prices',
      control: <Toggle label="Order status" checked={draft.skills.wismo} disabled={!canEdit} onChange={(v) => setDraft((p) => ({ ...p, skills: { ...p.skills, wismo: v } }))} />,
    },
    {
      title: 'Shipping address',
      sub: 'Shows the customer the address on their own order and how to change it · never sent to the AI model',
      control: <Toggle label="Shipping address" checked={draft.skills.addressLookup} disabled={!canEdit} onChange={(v) => setDraft((p) => ({ ...p, skills: { ...p.skills, addressLookup: v } }))} />,
    },
    {
      title: 'Exchange request',
      sub: 'Explains the policy, then hands over to your team',
      control: <Pill tone="slate"><Lock className="w-3 h-3" /> Team approves</Pill>,
    },
    {
      title: 'Refund request',
      sub: 'Always handed to a person',
      control: <Pill tone="slate"><Lock className="w-3 h-3" /> Team approves</Pill>,
    },
    {
      title: 'Product recommendations',
      sub: 'Shopping assistant and sales',
      control: <Pill tone="blue">Coming later</Pill>,
    },
  ];

  return (
    <div className="space-y-6">
      <Card title="Actions" subtitle="What the agent may do for customers" bodyClassName="p-0 pt-3">
        <ul>
          {rows.map((r) => (
            <li key={r.title} className="flex items-center gap-3 border-t border-slate-100 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium text-slate-800">{r.title}</div>
                <div className="text-[12px] text-slate-500">{r.sub}</div>
              </div>
              {r.control}
            </li>
          ))}
        </ul>
      </Card>

      {draft.skills.addressLookup && <AddressLinkCard ctx={ctx} />}

      <Card title="Welcome" subtitle="Sent when a customer opens with a greeting">
        <textarea
          value={draft.skills.welcomeMessage}
          disabled={!canEdit}
          maxLength={500}
          onChange={(e) => setDraft((p) => ({ ...p, skills: { ...p.skills, welcomeMessage: e.target.value } }))}
          rows={3}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3440a8]/20 disabled:bg-slate-50"
        />
        <p className="mt-1 text-[12px] text-slate-500">{'{name}'} becomes the customer's first name.</p>
        <div className="mt-3 text-[12px] font-semibold text-slate-700">Quick replies</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {draft.skills.starterChips.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-3 py-1 text-[12px] font-medium text-[#3440a8]">
              {c}
              {canEdit && (
                <button aria-label={`Remove ${c}`} onClick={() => setDraft((p) => ({ ...p, skills: { ...p.skills, starterChips: p.skills.starterChips.filter((x) => x !== c) } }))} className="ml-0.5 text-[#3440a8]/60 hover:text-[#3440a8]">×</button>
              )}
            </span>
          ))}
          {canEdit && draft.skills.starterChips.length < 6 && (
            <form onSubmit={(e) => {
              e.preventDefault();
              const v = chip.trim().slice(0, 40);
              if (v && !draft.skills.starterChips.includes(v)) setDraft((p) => ({ ...p, skills: { ...p.skills, starterChips: [...p.skills.starterChips, v] } }));
              setChip('');
            }}>
              <input value={chip} onChange={(e) => setChip(e.target.value)} placeholder="+ Add" className="w-28 rounded-full border border-dashed border-slate-300 px-3 py-1 text-[12px] focus:outline-none focus:border-[#3440a8]" />
            </form>
          )}
        </div>
      </Card>
    </div>
  );
}

/** Where customers change their delivery address; until it's set, replies show the placeholder "Sample link" */
function AddressLinkCard({ ctx }: { ctx: AgentContext }) {
  const { draft, setDraft, canEdit } = ctx;
  const [value, setValue] = useState(draft.skills.addressChangeUrl);
  const valid = !value.trim() || /^https:\/\/[^\s]+\.[^\s]+/.test(value.trim());
  const save = (v: string) => setDraft((p) => ({ ...p, skills: { ...p.skills, addressChangeUrl: v.trim() } }));
  return (
    <Card title="Change-address link" subtitle="Shown under the instructions when a customer wants to change their delivery address">
      <input
        value={value}
        disabled={!canEdit}
        onChange={(e) => { setValue(e.target.value); if (!e.target.value.trim() || /^https:\/\/[^\s]+\.[^\s]+/.test(e.target.value.trim())) save(e.target.value); }}
        placeholder="https://yourstore.com/account/addresses"
        maxLength={500}
        className={`w-full rounded-lg border px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3440a8]/20 disabled:bg-slate-50 ${valid ? 'border-slate-200' : 'border-red-300'}`}
      />
      {!valid
        ? <p className="mt-1 text-[12px] text-red-600">Use a full https:// link.</p>
        : !draft.skills.addressChangeUrl
          ? <p className="mt-1 text-[12px] text-amber-700">Until you add your link, customers see the text &ldquo;Sample link&rdquo; here.</p>
          : <p className="mt-1 text-[12px] text-slate-500">The instructions come from your Knowledge (e.g. an FAQ on changing the delivery address).</p>}
    </Card>
  );
}
