'use client';

import React from 'react';
import { ClipboardList, FileText, Image as ImageIcon, LayoutTemplate, Mic, Film, MapPin } from 'lucide-react';
import type { Message, ReplyPreview } from '@/types';

/** What the thread shows of the message a reply answers */
export interface QuotedMessage {
  id: string;
  author: string;
  /** e.g. "Template · insurence_applicant_form" or "Form response" */
  kind: string | null;
  icon: React.ReactNode | null;
  text: string;
}

const MEDIA_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  image: { label: 'Photo', icon: <ImageIcon className="h-3 w-3" /> },
  sticker: { label: 'Sticker', icon: <ImageIcon className="h-3 w-3" /> },
  video: { label: 'Video', icon: <Film className="h-3 w-3" /> },
  audio: { label: 'Audio', icon: <Mic className="h-3 w-3" /> },
  voice: { label: 'Voice message', icon: <Mic className="h-3 w-3" /> },
  document: { label: 'Document', icon: <FileText className="h-3 w-3" /> },
  location: { label: 'Location', icon: <MapPin className="h-3 w-3" /> },
};

const authorOf = (senderType: string, senderName: string | null | undefined, customerName: string) =>
  senderType === 'customer' ? customerName : senderType === 'bot' || senderType === 'ai' ? 'AI agent' : senderName || 'Agent';

const describe = (opts: {
  isFlowResponse: boolean;
  flowName?: string | null;
  isTemplate: boolean;
  templateName?: string | null;
  mediaType?: string | null;
  text?: string | null;
}): Pick<QuotedMessage, 'kind' | 'icon' | 'text'> => {
  const text = (opts.text ?? '').replace(/\s+/g, ' ').trim();
  if (opts.isFlowResponse) {
    return { kind: opts.flowName ? `Form response · ${opts.flowName}` : 'Form response', icon: <ClipboardList className="h-3 w-3" />, text };
  }
  if (opts.isTemplate) {
    return {
      kind: opts.templateName ? `Template · ${opts.templateName}` : 'Template',
      icon: <LayoutTemplate className="h-3 w-3" />,
      text,
    };
  }
  const media = opts.mediaType ? MEDIA_LABELS[opts.mediaType] : undefined;
  if (media) return { kind: media.label, icon: media.icon, text };
  return { kind: null, icon: null, text: text || 'Message' };
};

/** Quote from the server preview (works when the quoted message isn't loaded in the thread) */
export const quoteFromPreview = (p: ReplyPreview, customerName: string): QuotedMessage => ({
  id: String(p.id),
  author: authorOf(p.senderType, p.senderName, customerName),
  ...describe({
    isFlowResponse: p.isFlowResponse,
    flowName: p.flowName,
    isTemplate: p.mediaType === 'template' || Boolean(p.templateName),
    templateName: p.templateName,
    mediaType: p.mediaType,
    text: p.text,
  }),
});

/** Quote from a message already loaded in the thread (e.g. one that just arrived in real time) */
export const quoteFromMessage = (m: Message, customerName: string): QuotedMessage => ({
  id: m.id,
  author: authorOf(m.sender === 'bot' ? 'ai' : m.sender, m.senderName, customerName),
  ...describe({
    isFlowResponse: Boolean(m.flowResponse),
    flowName: m.flowResponse?.flowName,
    isTemplate: m.type === 'template',
    mediaType: m.mediaType ?? m.type,
    text: m.text,
  }),
});

/** WhatsApp-style quote at the top of a reply bubble; clicking it jumps to the quoted message */
export const ReplyQuote: React.FC<{ quote: QuotedMessage; onClick: () => void; isCustomer: boolean }> = ({ quote, onClick, isCustomer }) => (
  <button
    type="button"
    onClick={onClick}
    title="Go to the message this replies to"
    className={`mb-1.5 block w-full min-w-[200px] cursor-pointer overflow-hidden rounded-lg border-l-[3px] border-[#3440a8] px-2.5 py-1.5 text-left transition-colors ${
      isCustomer ? 'bg-slate-50 hover:bg-slate-100' : 'bg-white/70 hover:bg-white'
    }`}
  >
    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#3440a8]">
      <span className="truncate">{quote.author}</span>
      {quote.kind && (
        <span className="flex min-w-0 items-center gap-1 font-medium text-slate-500">
          <span className="text-slate-300">·</span>
          {quote.icon}
          <span className="truncate">{quote.kind}</span>
        </span>
      )}
    </span>
    {quote.text && <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-slate-600">{quote.text}</span>}
  </button>
);
