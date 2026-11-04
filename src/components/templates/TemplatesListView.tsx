'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  Copy,
  Eye,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { WhatsAppTemplate, HeaderType, isTemplateEditable } from '@/types/templates';
import { WhatsAppChatPreview } from './WhatsAppChatPreview';

/** A connected WhatsApp number the page can show templates for */
export interface TemplateNumber {
  phoneNumberId: string;
  name: string;
  phone: string;
}

interface TemplatesListViewProps {
  templates: WhatsAppTemplate[];
  isLoading: boolean;
  loadError?: string | null;
  onRefresh: () => void;
  onCreateNew: () => void;
  onEdit: (template: WhatsAppTemplate) => void;
  onDuplicate: (template: WhatsAppTemplate) => void;
  onDelete: (template: WhatsAppTemplate) => Promise<void>;
  businessName?: string;
  isConnected: boolean;
  /** Connected WhatsApp numbers; the number pill becomes a switcher when there is more than one */
  numbers?: TemplateNumber[];
  /** Shown in the number pill when the numbers list isn't available */
  connectedPhone?: string;
  selectedNumberId?: string;
  onNumberChange?: (phoneNumberId: string) => void;
}

/** All language versions of one template name, shown as a single row */
interface TemplateGroup {
  name: string;
  category: string;
  status: string;
  versions: WhatsAppTemplate[];
}

const STATUS_STYLES: Record<string, { label: string; dot: string; pill: string }> = {
  APPROVED: { label: 'Approved', dot: 'bg-emerald-500', pill: 'bg-emerald-50 text-emerald-700' },
  PENDING: { label: 'In review', dot: 'bg-amber-500', pill: 'bg-amber-50 text-amber-700' },
  REJECTED: { label: 'Rejected', dot: 'bg-red-500', pill: 'bg-red-50 text-red-600' },
  PAUSED: { label: 'Paused', dot: 'bg-slate-500', pill: 'bg-slate-100 text-slate-600' },
  DISABLED: { label: 'Disabled', dot: 'bg-slate-400', pill: 'bg-slate-100 text-slate-500' },
};

/** When languages disagree, the row shows the status that needs attention first */
const STATUS_PRIORITY = ['REJECTED', 'PENDING', 'PAUSED', 'DISABLED', 'APPROVED'];

const statusStyle = (status?: string) =>
  STATUS_STYLES[status?.toUpperCase() ?? ''] ?? {
    label: status ? status.charAt(0) + status.slice(1).toLowerCase() : 'Unknown',
    dot: 'bg-slate-300',
    pill: 'bg-slate-100 text-slate-500',
  };

const CATEGORIES: Array<{ value: string; label: string; pill: string }> = [
  { value: 'UTILITY', label: 'Utility', pill: 'bg-emerald-50 text-emerald-700' },
  { value: 'MARKETING', label: 'Marketing', pill: 'bg-rose-50 text-rose-600' },
  { value: 'AUTHENTICATION', label: 'Authentication', pill: 'bg-indigo-50 text-indigo-700' },
];

const categoryInfo = (category: string) =>
  CATEGORIES.find((c) => c.value === category) ?? { value: category, label: category, pill: 'bg-slate-100 text-slate-600' };

/** Meta's rejection reasons, as a headline and what to change */
const REJECTION_HELP: Record<string, { title: (category: string) => string; fix: string }> = {
  PROMOTIONAL: {
    title: (category) => `promotional content in a ${category} template`,
    fix: 'Meta found an offer or promotion. Move it to a Marketing template, or remove the offer and keep the message factual.',
  },
  INCORRECT_CATEGORY: {
    title: () => "the category doesn't match the message",
    fix: 'Pick the category that fits what the message says, or rewrite the message so it fits this category.',
  },
  TAG_CONTENT_MISMATCH: {
    title: () => "the category doesn't match the message",
    fix: 'Pick the category that fits what the message says, or rewrite the message so it fits this category.',
  },
  INVALID_FORMAT: {
    title: () => 'formatting problem',
    fix: "Check the variables: they can't start or end the message, can't sit side by side, and each needs a sample value.",
  },
  ABUSIVE_CONTENT: {
    title: () => 'content against WhatsApp policy',
    fix: "Rewrite the message so it follows WhatsApp's Business and Commerce policies.",
  },
  SCAM: {
    title: () => 'flagged as a possible scam',
    fix: 'Remove misleading claims or links, and make it clear who is sending the message and why.',
  },
};

const rejectionHelp = (tpl: WhatsAppTemplate) => {
  const help = REJECTION_HELP[tpl.rejected_reason ?? ''];
  if (help) return { title: help.title(categoryInfo(tpl.category).label), fix: help.fix };
  return {
    title: 'not approved by Meta',
    fix: "Meta didn't give a reason here. Open it in WhatsApp Manager to see the details, then edit and resubmit.",
  };
};

/** "en_US" → "EN"; the region is kept only when two versions share a language */
const languageLabel = (code: string, siblings: string[]) => {
  const base = code.split('_')[0];
  const clash = siblings.filter((c) => c.split('_')[0] === base).length > 1;
  return (clash ? code.replace('_', '-') : base).toUpperCase();
};

/** Why the editor can't open this template, or null when it can be edited */
const editBlockedReason = (tpl: WhatsAppTemplate): string | null => {
  if (tpl.category === 'AUTHENTICATION') return 'Authentication templates are managed in WhatsApp Manager';
  if (!isTemplateEditable(tpl)) return `Meta doesn't allow editing ${tpl.status?.toLowerCase() ?? 'this'} templates`;
  return null;
};

const StatusPill: React.FC<{ status?: string }> = ({ status }) => {
  const s = statusStyle(status);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${s.pill}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
};

const CategoryPill: React.FC<{ category: string }> = ({ category }) => {
  const c = categoryInfo(category);
  return (
    <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${c.pill}`}>{c.label}</span>
  );
};

/** A Meta template rendered in the chat preview, filled with its own sample values */
const TemplatePreview: React.FC<{ template: WhatsAppTemplate; businessName: string }> = ({ template, businessName }) => {
  const find = (type: string) => template.components?.find((c) => c.type === type);
  const header = find('HEADER');
  const headerType: HeaderType =
    header?.format === 'TEXT' || header?.format === 'IMAGE' || header?.format === 'VIDEO' || header?.format === 'DOCUMENT'
      ? header.format
      : 'NONE';
  const headerHandle = header?.example?.header_handle?.[0];

  return (
    <WhatsAppChatPreview
      businessName={businessName}
      headerType={headerType}
      headerText={header?.text}
      headerSample={header?.example?.header_text?.[0]}
      headerMediaUrl={headerType === 'IMAGE' && headerHandle?.startsWith('http') ? headerHandle : undefined}
      bodyText={find('BODY')?.text ?? ''}
      bodySamples={find('BODY')?.example?.body_text?.[0]}
      footerText={find('FOOTER')?.text}
      buttons={(find('BUTTONS')?.buttons ?? []).map((b, i) => ({
        id: String(i),
        type: b.type === 'URL' || b.type === 'PHONE_NUMBER' ? b.type : 'QUICK_REPLY',
        text: b.text,
      }))}
    />
  );
};

/** Centered dialog that closes on backdrop click or Escape */
const Modal: React.FC<{ onClose: () => void; className?: string; children: React.ReactNode }> = ({
  onClose,
  className = '',
  children,
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`bg-white rounded-2xl w-full p-5 shadow-2xl ${className}`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
};

const iconButton =
  'p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-400';

const menuItemBase =
  'w-full flex items-center gap-2.5 px-3 py-2 text-[13px] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent';
const menuItem = `${menuItemBase} text-slate-700 hover:bg-slate-50`;

/** The "…" menu of a row; with several languages it first asks which one */
const RowMenu: React.FC<{
  group: TemplateGroup;
  onPreview: (tpl: WhatsAppTemplate) => void;
  onEdit: (tpl: WhatsAppTemplate) => void;
  onDuplicate: (tpl: WhatsAppTemplate) => void;
  onDelete: (tpl: WhatsAppTemplate) => void;
}> = ({ group, onPreview, onEdit, onDuplicate, onDelete }) => {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const tpl = group.versions[Math.min(index, group.versions.length - 1)];
  const blockedReason = editBlockedReason(tpl);
  const languages = group.versions.map((v) => v.language);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = (action: (tpl: WhatsAppTemplate) => void) => {
    setOpen(false);
    action(tpl);
  };

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Actions"
        className={`${iconButton} ${open ? 'bg-slate-100 text-slate-900' : ''}`}
      >
        <MoreHorizontal className="w-5 h-5" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 w-52 py-1.5 bg-white border border-slate-200 rounded-xl shadow-lg">
          {group.versions.length > 1 && (
            <div className="px-3 pt-1 pb-2 mb-1 border-b border-slate-100">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Language</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {group.versions.map((v, i) => (
                  <button
                    key={v.id ?? v.language}
                    type="button"
                    onClick={() => setIndex(i)}
                    className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold cursor-pointer ${
                      v === tpl
                        ? 'border-[#3440a8] bg-[#3440a8]/5 text-[#3440a8]'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {languageLabel(v.language, languages)}
                  </button>
                ))}
              </div>
            </div>
          )}
          <button type="button" onClick={() => run(onPreview)} className={menuItem}>
            <Eye className="w-4 h-4 text-slate-400" />
            Preview
          </button>
          <button
            type="button"
            onClick={() => run(onEdit)}
            disabled={Boolean(blockedReason)}
            title={blockedReason ?? undefined}
            className={menuItem}
          >
            <Pencil className="w-4 h-4 text-slate-400" />
            Edit
          </button>
          <button
            type="button"
            onClick={() => run(onDuplicate)}
            disabled={tpl.category === 'AUTHENTICATION'}
            className={menuItem}
          >
            <Copy className="w-4 h-4 text-slate-400" />
            Duplicate
          </button>
          <div className="my-1 border-t border-slate-100" />
          <button type="button" onClick={() => run(onDelete)} className={`${menuItemBase} text-red-600 hover:bg-red-50`}>
            <Trash2 className="w-4 h-4" />
            {group.versions.length > 1 ? `Delete ${languageLabel(tpl.language, languages)} version` : 'Delete'}
          </button>
        </div>
      )}
    </div>
  );
};

/** The connected number, as a pill; a dropdown when the workspace has several numbers */
const NumberPill: React.FC<{
  numbers: TemplateNumber[];
  connectedPhone?: string;
  selectedNumberId?: string;
  onNumberChange?: (phoneNumberId: string) => void;
}> = ({ numbers, connectedPhone, selectedNumberId, onNumberChange }) => {
  const pill = 'rounded-xl bg-emerald-50 text-emerald-800 text-sm font-semibold';
  const dot = <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />;

  if (numbers.length > 1 && onNumberChange) {
    return (
      <label className="relative flex items-center" title="Templates belong to the selected number's business account">
        <span className="absolute left-3.5 pointer-events-none flex">{dot}</span>
        <select
          value={selectedNumberId ?? ''}
          onChange={(e) => onNumberChange(e.target.value)}
          className={`${pill} appearance-none max-w-[300px] truncate pl-8 pr-9 py-2.5 cursor-pointer hover:bg-emerald-100/70 focus:outline-none focus:ring-2 focus:ring-emerald-200`}
        >
          {numbers.map((n) => (
            <option key={n.phoneNumberId} value={n.phoneNumberId}>
              {n.phone || n.phoneNumberId} · {n.name}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-3 w-4 h-4 text-emerald-700 pointer-events-none" />
      </label>
    );
  }

  const phone = numbers[0]?.phone || connectedPhone;
  if (!phone) return null;
  return (
    <span className={`${pill} inline-flex items-center gap-2 px-4 py-2.5`} title={numbers[0]?.name}>
      {dot}
      {phone}
    </span>
  );
};

const GRID_COLUMNS = 'md:grid-cols-[minmax(0,1fr)_160px_180px_160px_40px]';

export const TemplatesListView: React.FC<TemplatesListViewProps> = ({
  templates,
  isLoading,
  loadError,
  onRefresh,
  onCreateNew,
  onEdit,
  onDuplicate,
  onDelete,
  businessName = 'Your business',
  isConnected,
  numbers = [],
  connectedPhone,
  selectedNumberId,
  onNumberChange,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [category, setCategory] = useState('ALL');
  const [previewing, setPreviewing] = useState<WhatsAppTemplate | null>(null);
  const [deleting, setDeleting] = useState<WhatsAppTemplate | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Meta returns one template per language; the list shows one row per name
  const groups = useMemo(() => {
    const byName = new Map<string, WhatsAppTemplate[]>();
    for (const tpl of templates) {
      byName.set(tpl.name, [...(byName.get(tpl.name) ?? []), tpl]);
    }
    return Array.from(byName, ([name, versions]): TemplateGroup => {
      const statuses = versions.map((v) => v.status?.toUpperCase() ?? '');
      return {
        name,
        category: versions[0].category,
        status: STATUS_PRIORITY.find((s) => statuses.includes(s)) ?? versions[0].status ?? '',
        versions,
      };
    });
  }, [templates]);

  const tabs = useMemo(
    () => [
      { value: 'ALL', label: 'All', count: groups.length },
      ...CATEGORIES.map((c) => ({ value: c.value, label: c.label, count: groups.filter((g) => g.category === c.value).length })),
    ],
    [groups]
  );

  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return groups.filter((g) => {
      if (category !== 'ALL' && g.category !== category) return false;
      if (!q) return true;
      return (
        g.name.toLowerCase().includes(q) ||
        g.versions.some((v) => (v.components?.find((c) => c.type === 'BODY')?.text ?? '').toLowerCase().includes(q))
      );
    });
  }, [groups, category, searchQuery]);

  const rejected = useMemo(() => templates.filter((t) => t.status?.toUpperCase() === 'REJECTED'), [templates]);

  const isFiltered = Boolean(searchQuery.trim()) || category !== 'ALL';
  const previewSiblings = previewing ? groups.find((g) => g.name === previewing.name)?.versions ?? [previewing] : [];

  const confirmDelete = async () => {
    if (!deleting) return;
    setIsDeleting(true);
    try {
      await onDelete(deleting);
      setDeleting(null);
    } catch {
      // The parent already showed the error
    } finally {
      setIsDeleting(false);
    }
  };

  const openFromPreview = (action: (tpl: WhatsAppTemplate) => void) => {
    const tpl = previewing!;
    setPreviewing(null);
    action(tpl);
  };

  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* ── Top bar ── */}
      <header className="h-16 shrink-0 px-4 sm:px-8 flex items-center justify-between gap-4 bg-white border-b border-slate-200">
        <h1 className="text-xl font-bold text-slate-900">Templates</h1>
        <NumberPill
          numbers={numbers}
          connectedPhone={connectedPhone}
          selectedNumberId={selectedNumberId}
          onNumberChange={onNumberChange}
        />
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 pt-6 pb-10">
          {/* ── Category tabs + actions ── */}
          <div className="flex flex-col-reverse lg:flex-row lg:items-end justify-between gap-4 border-b border-slate-200">
            <nav className="flex items-center gap-6 sm:gap-9 overflow-x-auto -mb-px">
              {tabs.map((tab) => {
                const active = category === tab.value;
                return (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() => setCategory(tab.value)}
                    className={`pb-3 text-[15px] whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                      active
                        ? 'border-[#3440a8] text-[#3440a8] font-semibold'
                        : 'border-transparent text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {tab.label} {tab.count}
                  </button>
                );
              })}
            </nav>

            <div className="flex items-center gap-2.5 lg:pb-3">
              <button
                type="button"
                onClick={onRefresh}
                disabled={isLoading || !isConnected}
                className="px-4 py-2.5 text-sm font-semibold rounded-xl border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                Sync from Meta
              </button>
              <button
                type="button"
                onClick={onCreateNew}
                disabled={!isConnected}
                className="px-4 py-2.5 text-sm font-semibold rounded-xl bg-[#3440a8] hover:bg-[#2b358d] text-white transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" />
                New template
              </button>
            </div>
          </div>

          {!isConnected && (
            <p className="mt-5 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-800">
              Connect a WhatsApp number in Settings to create and manage templates.
            </p>
          )}
          {isConnected && loadError && (
            <p className="mt-5 px-4 py-3 rounded-xl border border-red-200 bg-red-50 text-xs text-red-700">
              Couldn&apos;t load templates: {loadError}
            </p>
          )}

          {/* ── Search ── */}
          <div className="mt-4 flex justify-end">
            <div className="relative w-full sm:w-96">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search templates"
                className="w-full pl-10 pr-3 py-2.5 text-sm bg-white border border-slate-200 rounded-xl text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#3440a8]"
              />
            </div>
          </div>

          {/* ── Table ── */}
          <div className="mt-4 bg-white rounded-xl border border-slate-200">
            <div
              className={`hidden md:grid ${GRID_COLUMNS} gap-4 items-center px-6 py-3.5 rounded-t-xl bg-slate-50/80 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider`}
            >
              <span>Name</span>
              <span>Category</span>
              <span>Languages</span>
              <span>Status</span>
              <span />
            </div>

            {isLoading && templates.length === 0 ? (
              Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="px-6 py-5 border-b border-slate-100 last:border-0 animate-pulse flex items-center gap-6">
                  <div className="h-3.5 w-44 bg-slate-100 rounded" />
                  <div className="hidden md:block h-5 w-20 bg-slate-100 rounded-full" />
                  <div className="hidden md:block h-5 w-16 bg-slate-100 rounded" />
                  <div className="hidden md:block h-5 w-24 bg-slate-100 rounded-full" />
                </div>
              ))
            ) : filteredGroups.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <p className="text-sm font-semibold text-slate-700">
                  {isFiltered ? 'No templates match your search' : 'No templates yet'}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {isFiltered
                    ? 'Try a different name or category.'
                    : 'Create a template to send order updates and broadcasts.'}
                </p>
              </div>
            ) : (
              filteredGroups.map((group) => {
                const languages = group.versions.map((v) => v.language);
                const mixedStatus = new Set(group.versions.map((v) => v.status)).size > 1;

                const languageChips = group.versions.map((v) => (
                  <button
                    key={v.id ?? v.language}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPreviewing(v);
                    }}
                    title={`${v.language} · ${statusStyle(v.status).label}`}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 hover:border-slate-300 hover:bg-white cursor-pointer"
                  >
                    {mixedStatus && <span className={`w-1.5 h-1.5 rounded-full ${statusStyle(v.status).dot}`} />}
                    {languageLabel(v.language, languages)}
                  </button>
                ));

                return (
                  <div
                    key={group.name}
                    onClick={() => setPreviewing(group.versions[0])}
                    className={`grid grid-cols-[minmax(0,1fr)_auto] ${GRID_COLUMNS} gap-x-4 gap-y-2 items-center px-6 py-4 md:py-5 border-b border-slate-100 last:border-0 last:rounded-b-xl hover:bg-[#3440a8]/[0.04] cursor-pointer transition-colors`}
                  >
                    <div className="min-w-0">
                      <p className="text-[15px] text-slate-900 font-mono truncate">{group.name}</p>
                      {/* Small screens: the other columns fold under the name */}
                      <div className="md:hidden mt-2 flex flex-wrap items-center gap-1.5">
                        <CategoryPill category={group.category} />
                        <StatusPill status={group.status} />
                        {languageChips}
                      </div>
                    </div>

                    <span className="hidden md:block">
                      <CategoryPill category={group.category} />
                    </span>
                    <span className="hidden md:flex flex-wrap gap-1.5">{languageChips}</span>
                    <span className="hidden md:block">
                      <StatusPill status={group.status} />
                    </span>

                    <div className="flex justify-end">
                      <RowMenu
                        group={group}
                        onPreview={setPreviewing}
                        onEdit={onEdit}
                        onDuplicate={onDuplicate}
                        onDelete={setDeleting}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* ── Rejections ── */}
          {rejected.length > 0 && (
            <div className="mt-8 space-y-3">
              {rejected.map((tpl) => {
                const help = rejectionHelp(tpl);
                const canEdit = !editBlockedReason(tpl);
                const siblings = groups.find((g) => g.name === tpl.name)?.versions.map((v) => v.language) ?? [];
                return (
                  <div
                    key={tpl.id ?? `${tpl.name}_${tpl.language}`}
                    className="flex flex-col sm:flex-row sm:items-center gap-4 px-6 py-5 rounded-xl bg-red-50 border border-red-100"
                  >
                    <AlertTriangle className="hidden sm:block w-6 h-6 text-red-600 shrink-0 self-start mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] font-semibold text-red-700">
                        <span className="font-mono">{tpl.name}</span>
                        {siblings.length > 1 && ` (${languageLabel(tpl.language, siblings)})`} was rejected: {help.title}
                      </p>
                      <p className="mt-1 text-sm text-slate-700 leading-relaxed">{help.fix}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => (canEdit ? onEdit(tpl) : setPreviewing(tpl))}
                      className="shrink-0 px-5 py-2.5 text-sm font-semibold rounded-xl border border-slate-200 bg-white text-slate-900 hover:bg-slate-50 cursor-pointer"
                    >
                      {canEdit ? 'Edit & resubmit' : 'View template'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Preview ── */}
      {previewing && (
        <Modal onClose={() => setPreviewing(null)} className="max-w-md space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900 font-mono truncate">{previewing.name}</h3>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <CategoryPill category={previewing.category} />
                <StatusPill status={previewing.status} />
              </div>
            </div>
            <button type="button" onClick={() => setPreviewing(null)} className={iconButton} title="Close">
              <X className="w-4 h-4" />
            </button>
          </div>

          {previewSiblings.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {previewSiblings.map((v) => (
                <button
                  key={v.id ?? v.language}
                  type="button"
                  onClick={() => setPreviewing(v)}
                  className={`px-2.5 py-1 rounded-md border text-xs font-semibold cursor-pointer ${
                    v === previewing
                      ? 'border-[#3440a8] bg-[#3440a8]/5 text-[#3440a8]'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {languageLabel(v.language, previewSiblings.map((s) => s.language))}
                </button>
              ))}
            </div>
          )}

          {previewing.status?.toUpperCase() === 'REJECTED' && (
            <p className="px-3 py-2 rounded-lg bg-red-50 text-xs text-red-700">
              Rejected: {rejectionHelp(previewing).title}. {rejectionHelp(previewing).fix}
            </p>
          )}

          <TemplatePreview template={previewing} businessName={businessName} />

          {previewing.category !== 'AUTHENTICATION' && (
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => openFromPreview(onDuplicate)}
                className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Duplicate
              </button>
              {!editBlockedReason(previewing) && (
                <button
                  type="button"
                  onClick={() => openFromPreview(onEdit)}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#3440a8] text-white hover:bg-[#2b358d] cursor-pointer"
                >
                  Edit
                </button>
              )}
            </div>
          )}
        </Modal>
      )}

      {/* ── Delete confirmation ── */}
      {deleting && (
        <Modal onClose={() => !isDeleting && setDeleting(null)} className="max-w-sm space-y-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Delete template?</h3>
            <p className="mt-1.5 text-xs text-slate-600">
              <span className="font-mono font-semibold text-slate-900">{deleting.name}</span> ({deleting.language}) will be
              removed from your WhatsApp Business Account. This can&apos;t be undone.
            </p>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleting(null)}
              disabled={isDeleting}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={isDeleting}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 cursor-pointer"
            >
              {isDeleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};
