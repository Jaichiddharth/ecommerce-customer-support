'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ClipboardList, ExternalLink, FileText, Film, Loader2, Phone, RefreshCw, Reply, Search, Copy } from 'lucide-react';
import apiClient from '@/lib/api/client';
import { toApiError } from '@/lib/api/api-error';
import { WhatsAppTemplate } from '@/types/templates';
import {
  fillTemplateText,
  getTemplateSendBlocker,
  getTemplateSendFields,
  getTemplateValueErrors,
} from '@/lib/whatsapp-templates';

export interface TemplateDraft {
  template: WhatsAppTemplate;
  values: Record<string, string>;
}

interface TemplateComposerProps {
  /** Meta phone number id of the conversation's channel; templates belong to that number's WABA */
  phoneNumberId?: string | null;
  draft: TemplateDraft | null;
  onDraftChange: (draft: TemplateDraft | null) => void;
  /** Shown instead of the picker when a template can't be sent in this conversation */
  disabledReason?: string | null;
  /** Bumped when Meta changes a template's status; an open picker then reloads its list */
  revision?: number;
}

/** Templates fetched per request: a few to start with, the rest are found by searching (or "Load more") */
const PAGE_SIZE = 4;
const SEARCH_DEBOUNCE_MS = 300;

interface TemplatePage {
  templates: WhatsAppTemplate[];
  /** Cursor for the next page; null when there are no more */
  after: string | null;
}

// First page per phone number and search, kept while the app is open so switching composer tabs doesn't refetch
const templateCache = new Map<string, TemplatePage>();
const pageKey = (phoneKey: string, query: string) => `${phoneKey}|${query}`;

/** Drops every cached template list, e.g. after Meta approved or paused a template */
export const forgetCachedTemplates = () => templateCache.clear();

/**
 * Search text as Meta matches it: template names are lowercase letters, digits and underscores, and Meta's name
 * filter is a case-insensitive "contains" match. "Abandoned cart" → "abandoned_cart".
 */
const toNameQuery = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');

const VARIABLE_SPLIT_RE = /(\{\{\s*[a-zA-Z0-9_]+\s*\}\})/g;

/** Text with still-unfilled variables highlighted */
const highlightUnfilled = (text: string) =>
  text.split(VARIABLE_SPLIT_RE).map((part, i) =>
    /^\{\{.*\}\}$/.test(part) ? (
      <span key={i} className="rounded bg-amber-100 px-1 font-mono text-[11px] font-semibold text-amber-800">
        {part}
      </span>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    )
  );

const bodyOf = (tpl: WhatsAppTemplate) => tpl.components?.find((c) => c.type === 'BODY')?.text ?? '';

/** Icon for a template button type, as on the WhatsApp bubble */
export const TemplateButtonIcon: React.FC<{ type: string }> = ({ type }) => {
  if (type === 'URL') return <ExternalLink className="h-3 w-3" />;
  if (type === 'PHONE_NUMBER') return <Phone className="h-3 w-3" />;
  if (type === 'COPY_CODE') return <Copy className="h-3 w-3" />;
  if (type === 'FLOW') return <ClipboardList className="h-3 w-3" />;
  return <Reply className="h-3 w-3" />;
};

export const TemplateComposer: React.FC<TemplateComposerProps> = ({
  phoneNumberId,
  draft,
  onDraftChange,
  disabledReason,
  revision = 0,
}) => {
  const phoneKey = phoneNumberId || 'default';
  const [search, setSearch] = useState('');
  // The query actually sent to WhatsApp: follows the search box after a short pause in typing
  const [query, setQuery] = useState('');
  const [templates, setTemplates] = useState<WhatsAppTemplate[] | null>(() => templateCache.get(pageKey(phoneKey, ''))?.templates ?? null);
  const [after, setAfter] = useState<string | null>(() => templateCache.get(pageKey(phoneKey, ''))?.after ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    const next = toNameQuery(search);
    if (next === query) return;
    const t = setTimeout(() => setQuery(next), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search, query]);

  /** One page of approved templates whose name contains `q`; `cursor` continues a previous page */
  const fetchPage = useCallback(
    async (q: string, cursor?: string): Promise<TemplatePage> => {
      const res = await apiClient.get('/api/channels/whatsapp/templates', {
        params: { phoneNumberId: phoneNumberId || undefined, status: 'APPROVED', limit: PAGE_SIZE, name: q || undefined, after: cursor },
      });
      if (res.data?.connected === false) throw new Error('No WhatsApp number is connected.');
      if (res.data?.error) throw new Error(res.data.error);
      return {
        templates: ((res.data?.templates ?? []) as WhatsAppTemplate[]).filter((t) => t.status?.toUpperCase() === 'APPROVED'),
        // Meta always returns cursors; only a `next` link means there's another page
        after: res.data?.paging?.next ? res.data?.paging?.cursors?.after ?? null : null,
      };
    },
    [phoneNumberId]
  );

  const load = useCallback(
    async (force = false) => {
      const key = pageKey(phoneKey, query);
      if (force) {
        // Statuses may have changed: every cached search of this number is stale
        for (const k of [...templateCache.keys()]) if (k.startsWith(`${phoneKey}|`)) templateCache.delete(k);
      }
      const cached = templateCache.get(key);
      const requestId = ++requestRef.current;
      setIsLoadingMore(false);
      if (cached) {
        setTemplates(cached.templates);
        setAfter(cached.after);
        setError(null);
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        const page = await fetchPage(query);
        if (requestId !== requestRef.current) return;
        templateCache.set(key, page);
        setTemplates(page.templates);
        setAfter(page.after);
      } catch (err) {
        if (requestId === requestRef.current) setError(toApiError(err).message);
      } finally {
        if (requestId === requestRef.current) setIsLoading(false);
      }
    },
    [phoneKey, query, fetchPage]
  );

  const loadMore = async () => {
    if (!after || isLoadingMore) return;
    const requestId = requestRef.current;
    setIsLoadingMore(true);
    try {
      const page = await fetchPage(query, after);
      // The search changed meanwhile: these results belong to the old one
      if (requestId !== requestRef.current) return;
      setTemplates((prev) => {
        const seen = new Set((prev ?? []).map((t) => t.id ?? `${t.name}-${t.language}`));
        return [...(prev ?? []), ...page.templates.filter((t) => !seen.has(t.id ?? `${t.name}-${t.language}`))];
      });
      setAfter(page.after);
    } catch (err) {
      if (requestId === requestRef.current) setError(toApiError(err).message);
    } finally {
      if (requestId === requestRef.current) setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    if (!disabledReason) load();
  }, [load, disabledReason]);

  const loadedRevision = useRef(revision);
  useEffect(() => {
    if (revision === loadedRevision.current) return;
    loadedRevision.current = revision;
    if (!disabledReason) load(true);
  }, [revision, load, disabledReason]);

  // Still typing: the list on screen belongs to the previous search
  const isSearchPending = toNameQuery(search) !== query;

  const visibleTemplates = useMemo(
    () =>
      // Sendable templates first; the rest stay visible so agents can see why they're unavailable
      (templates ?? [])
        .map((t) => ({ template: t, blocker: getTemplateSendBlocker(t) }))
        .sort((a, b) => Number(Boolean(a.blocker)) - Number(Boolean(b.blocker))),
    [templates]
  );

  if (disabledReason) {
    return <p className="mt-1 rounded-lg border border-slate-200 px-3 py-3 text-xs text-slate-500">{disabledReason}</p>;
  }

  // -------------------------------------------------------------
  // STEP 2: fill variables for the chosen template
  // -------------------------------------------------------------
  if (draft) {
    const { template, values } = draft;
    const fields = getTemplateSendFields(template);
    const errors = getTemplateValueErrors(template, values);
    // The header file is always the approved sample, so only typed values count as "to fill"
    const inputFields = fields.filter((f) => f.kind !== 'header_media');
    const filledCount = inputFields.filter((f) => !errors[f.id]).length;
    const header = template.components?.find((c) => c.type === 'HEADER');
    const footer = template.components?.find((c) => c.type === 'FOOTER');
    const buttons = template.components?.find((c) => c.type === 'BUTTONS')?.buttons ?? [];
    const mediaField = fields.find((f) => f.kind === 'header_media');
    // Meta's approved sample link: fine to display; the server re-uploads it to send
    const mediaPreview = mediaField?.example;

    const setValue = (id: string, value: string) => onDraftChange({ template, values: { ...values, [id]: value } });

    return (
      <div className="@container mt-1 rounded-lg border border-slate-200">
        <div className="flex items-center gap-2 border-b border-slate-100 px-2 py-1.5">
          <button
            type="button"
            onClick={() => onDraftChange(null)}
            title="Back to templates"
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="truncate text-[13px] font-semibold text-slate-900" title={template.name}>
            {template.name}
          </span>
          <span className="shrink-0 text-[11px] text-slate-400">
            {template.language} · {template.category.toLowerCase()}
          </span>
          {inputFields.length > 0 && (
            <span className={`ml-auto shrink-0 text-[11px] ${filledCount === inputFields.length ? 'text-emerald-600' : 'text-slate-500'}`}>
              {filledCount}/{inputFields.length} filled
            </span>
          )}
        </div>

        <div className="grid max-h-72 gap-3 overflow-y-auto p-3 @xl:grid-cols-2">
          {/* Variables */}
          <div className="space-y-2.5">
            {fields.length === 0 ? (
              <p className="text-xs text-slate-500">This template has no variables. It will be sent exactly as shown.</p>
            ) : (
              fields.map((field, i) => {
                if (field.kind === 'header_media' && field.mediaFormat) {
                  const format = field.mediaFormat;
                  return (
                    <div key={field.id}>
                      <span className="mb-1 block text-[11px] font-medium text-slate-600">{field.label}</span>
                      <div className="flex items-center gap-2.5 rounded-md border border-slate-200 bg-white p-2">
                        {format === 'IMAGE' && mediaPreview ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={mediaPreview} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
                        ) : (
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-[#eef0fb] text-[#3440a8]">
                            {format === 'VIDEO' ? <Film className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-slate-800">Approved {format.toLowerCase()}</p>
                          <p className="text-[11px] text-slate-400">Sent with this template</p>
                        </div>
                      </div>
                    </div>
                  );
                }

                const value = values[field.id] ?? '';
                // "Required" is implied by the counter; only show real format problems
                const problem = value && errors[field.id] !== 'Required' ? errors[field.id] : null;
                return (
                  <label key={field.id} className="block">
                    <span className="mb-1 block text-[11px] font-medium text-slate-600">{field.label}</span>
                    <div
                      className={`flex items-center rounded-md border bg-white focus-within:ring-1 ${problem
                          ? 'border-red-300 focus-within:border-red-400 focus-within:ring-red-400'
                          : 'border-slate-200 focus-within:border-[#3440a8] focus-within:ring-[#3440a8]'
                        }`}
                    >
                      {field.prefix && (
                        <span className="max-w-[45%] truncate pl-2 text-[11px] text-slate-400" title={field.prefix}>
                          {field.prefix}
                        </span>
                      )}
                      <input
                        autoFocus={i === 0}
                        value={value}
                        onChange={(e) => setValue(field.id, e.target.value)}
                        placeholder={field.example ? `e.g. ${field.example}` : 'Value'}
                        className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-[13px] text-slate-800 placeholder-slate-400 focus:outline-none"
                      />
                    </div>
                    {problem && <span className="mt-0.5 block text-[11px] text-red-600">{problem}</span>}
                  </label>
                );
              })
            )}
          </div>

          {/* Preview of what the customer receives */}
          <div>
            <p className="mb-1 text-[10px] font-semibold tracking-wider text-slate-400">PREVIEW</p>
            <div className="rounded-lg bg-[#eae6df] p-2">
              <div className="rounded-lg bg-white px-3 py-2 text-[13px] leading-relaxed text-slate-800 shadow-sm">
                {header?.format === 'TEXT' && (
                  <p className="mb-1 font-semibold text-slate-900">{highlightUnfilled(fillTemplateText(header.text, values, 'header'))}</p>
                )}
                {header?.format === 'IMAGE' &&
                  (mediaPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={mediaPreview} alt="" className="mb-1.5 max-h-32 w-full rounded-md object-cover" />
                  ) : (
                    <div className="mb-1.5 flex h-20 items-center justify-center rounded-md bg-slate-100 text-[11px] text-slate-400">Image</div>
                  ))}
                {(header?.format === 'VIDEO' || header?.format === 'DOCUMENT') && (
                  <div className="mb-1.5 flex items-center gap-2 rounded-md bg-slate-100 px-2 py-2 text-[11px] text-slate-500">
                    {header.format === 'VIDEO' ? <Film className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                    {header.format === 'VIDEO' ? 'Video' : 'Document'}
                  </div>
                )}
                <p className="whitespace-pre-wrap break-words">{highlightUnfilled(fillTemplateText(bodyOf(template), values, 'body'))}</p>
                {footer?.text && <p className="mt-1 text-[11px] text-slate-500">{footer.text}</p>}
              </div>
              {buttons.length > 0 && (
                <div className="mt-1 flex flex-col gap-1">
                  {buttons.map((btn, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-center gap-1.5 rounded-lg bg-white py-1.5 text-[12px] font-medium text-[#00a884] shadow-sm"
                    >
                      <TemplateButtonIcon type={btn.type} />
                      <span className="truncate">{btn.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // STEP 1: pick an approved template
  // -------------------------------------------------------------
  return (
    <div className="mt-1 rounded-lg border border-slate-200">
      <div className="flex items-center gap-2 border-b border-slate-100 px-2.5 py-1.5">
        {isLoading || isSearchPending ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-slate-400" />
        ) : (
          <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        )}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search approved templates by name…"
          aria-label="Search approved templates by name"
          className="min-w-0 flex-1 bg-transparent py-0.5 text-[13px] text-slate-800 placeholder-slate-400 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => load(true)}
          disabled={isLoading}
          title="Reload templates from WhatsApp"
          className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="max-h-56 divide-y divide-slate-100 overflow-y-auto">
        {(isLoading || isSearchPending) && visibleTemplates.length === 0 && !error ? (
          Array.from({ length: PAGE_SIZE }, (_, i) => (
            <div key={i} className="space-y-1.5 px-3 py-2.5">
              <div className="h-3 w-1/3 animate-pulse rounded bg-slate-100" />
              <div className="h-2.5 w-3/4 animate-pulse rounded bg-slate-100" />
            </div>
          ))
        ) : error ? (
          <div className="px-3 py-3 text-xs">
            <p className="text-red-600">{error}</p>
            <button type="button" onClick={() => load(true)} className="mt-1 font-medium text-[#3440a8] hover:underline cursor-pointer">
              Try again
            </button>
          </div>
        ) : visibleTemplates.length === 0 ? (
          <p className="px-3 py-3 text-xs text-slate-500">
            {query
              ? `No approved template name contains “${search.trim()}”.`
              : 'No approved templates yet. Create one under Templates; it appears here once WhatsApp approves it.'}
          </p>
        ) : (
          visibleTemplates.map(({ template, blocker }) => (
            <button
              key={template.id ?? `${template.name}-${template.language}`}
              type="button"
              disabled={Boolean(blocker)}
              title={blocker ?? undefined}
              onClick={() => onDraftChange({ template, values: {} })}
              className="block w-full px-3 py-2 text-left hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <span className="truncate text-[13px] font-medium text-slate-900" title={template.name}>
                  {template.name}
                </span>
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-px text-[10px] font-medium text-slate-500">
                  {template.language}
                </span>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-400">{template.category}</span>
              </span>
              <span className="block truncate text-xs text-slate-500">{blocker ?? bodyOf(template)}</span>
            </button>
          ))
        )}
        {!error && visibleTemplates.length > 0 && !isSearchPending && after && (
          <div className="flex items-center justify-between gap-2 px-3 py-2 text-[11.5px]">
            <button
              type="button"
              onClick={loadMore}
              disabled={isLoadingMore || isLoading}
              className="inline-flex items-center gap-1.5 font-semibold text-[#3440a8] hover:underline disabled:opacity-60 cursor-pointer"
            >
              {isLoadingMore && <Loader2 className="h-3 w-3 animate-spin" />}
              {isLoadingMore ? 'Loading…' : 'Load more'}
            </button>
            {!query && <span className="text-slate-400">Search to find a template faster</span>}
          </div>
        )}
      </div>
    </div>
  );
};
