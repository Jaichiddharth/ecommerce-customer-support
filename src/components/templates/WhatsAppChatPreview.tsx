'use client';

import React from 'react';
import {
  Phone,
  Video,
  MoreVertical,
  Image as ImageIcon,
  FileText,
  Video as VideoIcon,
  ExternalLink,
  Reply,
} from 'lucide-react';
import { HeaderType, TemplateButton } from '@/types/templates';

interface WhatsAppChatPreviewProps {
  businessName?: string;
  headerType: HeaderType;
  headerText?: string;
  /** Sample for the header's {{1}} */
  headerSample?: string;
  /** Local object URL of the uploaded header file, shown instead of the placeholder */
  headerMediaUrl?: string;
  bodyText: string;
  /** bodySamples[0] fills {{1}}, bodySamples[1] fills {{2}}, … */
  bodySamples?: string[];
  footerText?: string;
  buttons: Pick<TemplateButton, 'id' | 'type' | 'text'>[];
  timeString?: string;
}

const TOKEN_RE = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|```[^`]+```|\{\{\d+\}\})/g;

/**
 * Fills `{{n}}` with `samples[n-1]` (unfilled ones stay highlighted)
 * and renders WhatsApp formatting (*bold*, _italic_, ~strike~, ```monospace```).
 */
export const formatWhatsAppText = (text: string, samples: string[] = []): React.ReactNode => {
  if (!text) return null;

  const lines = text.split('\n');
  return lines.map((line, lineIdx) => (
    <React.Fragment key={lineIdx}>
      {line.split(TOKEN_RE).map((token, i) => {
        if (!token) return null;
        const variable = token.match(/^\{\{(\d+)\}\}$/);
        if (variable) {
          const sample = samples[Number(variable[1]) - 1]?.trim();
          return sample ? (
            <span key={i}>{sample}</span>
          ) : (
            <span key={i} className="inline-block bg-[#e0e7ff] text-[#3730a3] px-1 rounded font-mono text-[11px] font-semibold">
              {token}
            </span>
          );
        }
        if (token.length > 6 && token.startsWith('```') && token.endsWith('```')) {
          return (
            <code key={i} className="font-mono bg-slate-100 px-1 py-0.5 rounded text-[12px] text-slate-800">
              {formatWhatsAppText(token.slice(3, -3), samples)}
            </code>
          );
        }
        const inner = token.slice(1, -1);
        if (token.length > 2 && token.startsWith('*') && token.endsWith('*')) {
          return <strong key={i} className="font-semibold text-slate-900">{formatWhatsAppText(inner, samples)}</strong>;
        }
        if (token.length > 2 && token.startsWith('_') && token.endsWith('_')) {
          return <em key={i} className="italic text-slate-800">{formatWhatsAppText(inner, samples)}</em>;
        }
        if (token.length > 2 && token.startsWith('~') && token.endsWith('~')) {
          return <span key={i} className="line-through text-slate-600">{formatWhatsAppText(inner, samples)}</span>;
        }
        return <span key={i}>{token}</span>;
      })}
      {lineIdx < lines.length - 1 && <br />}
    </React.Fragment>
  ));
};

const ButtonIcon: React.FC<{ type: TemplateButton['type'] }> = ({ type }) => {
  if (type === 'URL') return <ExternalLink className="w-3.5 h-3.5" />;
  if (type === 'PHONE_NUMBER') return <Phone className="w-3.5 h-3.5" />;
  return <Reply className="w-3.5 h-3.5" />;
};

export const WhatsAppChatPreview: React.FC<WhatsAppChatPreviewProps> = ({
  businessName = 'Your business',
  headerType,
  headerText = '',
  headerSample,
  headerMediaUrl,
  bodyText,
  bodySamples = [],
  footerText,
  buttons,
  timeString = '10:02',
}) => {
  const initials = businessName.trim().slice(0, 2).toUpperCase() || 'WA';

  return (
    <div className="w-full rounded-2xl overflow-hidden border border-slate-200/80 shadow-md bg-[#f6f5f3] flex flex-col font-sans select-none">
      {/* WhatsApp App Bar */}
      <div className="bg-[#005d4b] text-white px-4 py-3 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-emerald-800/80 border border-emerald-600/50 flex items-center justify-center font-bold text-xs tracking-wider text-white shrink-0">
            {initials}
          </div>
          <div className="min-w-0">
            <h4 className="text-[14px] font-semibold tracking-wide truncate leading-tight">
              {businessName}
            </h4>
            <span className="text-[11px] text-emerald-100/80 flex items-center gap-1">
              Official Business Account
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-white/85">
          <span className="p-1.5"><Video className="w-4 h-4" /></span>
          <span className="p-1.5"><Phone className="w-4 h-4" /></span>
          <span className="p-1.5"><MoreVertical className="w-4 h-4" /></span>
        </div>
      </div>

      {/* WhatsApp Chat Canvas */}
      <div
        className="p-4 min-h-[380px] flex flex-col justify-end"
        style={{
          backgroundColor: '#eae6df',
          backgroundImage: `radial-gradient(#d5cfc5 0.75px, transparent 0.75px)`,
          backgroundSize: '16px 16px',
        }}
      >
        <div className="w-full max-w-[340px] flex flex-col gap-1.5">
          {/* Message Bubble Card */}
          <div className="bg-white rounded-2xl rounded-tl-sm p-3.5 shadow-sm border border-black/5 text-[13px] text-slate-800 leading-relaxed relative">
            {/* Header Content */}
            {headerType === 'TEXT' && headerText && (
              <div className="font-bold text-[14px] text-slate-900 pb-1.5 mb-1.5 border-b border-slate-100 leading-snug">
                {formatWhatsAppText(headerText, headerSample ? [headerSample] : [])}
              </div>
            )}

            {headerType === 'IMAGE' &&
              (headerMediaUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={headerMediaUrl} alt="Header sample" className="w-full max-h-48 object-cover rounded-lg mb-2.5" />
              ) : (
                <div className="w-full h-36 bg-slate-100 rounded-lg mb-2.5 flex flex-col items-center justify-center text-slate-400 border border-slate-200">
                  <ImageIcon className="w-8 h-8 mb-1 text-slate-300" />
                  <span className="text-xs font-medium">Image Header</span>
                </div>
              ))}

            {headerType === 'VIDEO' &&
              (headerMediaUrl ? (
                <video src={headerMediaUrl} className="w-full max-h-48 rounded-lg mb-2.5 bg-black" muted />
              ) : (
                <div className="w-full h-36 bg-slate-900 rounded-lg mb-2.5 flex flex-col items-center justify-center text-white/70 border border-slate-800">
                  <VideoIcon className="w-8 h-8 mb-1 text-white/50" />
                  <span className="text-xs font-medium">Video Header</span>
                </div>
              ))}

            {headerType === 'DOCUMENT' && (
              <div className="w-full p-2.5 bg-slate-50 rounded-lg mb-2.5 flex items-center gap-2.5 text-slate-600 border border-slate-200">
                <FileText className="w-6 h-6 text-indigo-600 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-800 truncate">Document.pdf</p>
                  <p className="text-[10px] text-slate-400">PDF attachment</p>
                </div>
              </div>
            )}

            {/* Body Content */}
            <div className="whitespace-pre-wrap break-words text-slate-800 text-[13px]">
              {bodyText ? (
                formatWhatsAppText(bodyText, bodySamples)
              ) : (
                <span className="text-slate-400 italic">Your message body will appear here...</span>
              )}
            </div>

            {/* Footer Content */}
            {footerText && (
              <div className="mt-2 text-[11px] text-slate-500 font-normal border-t border-slate-100/80 pt-1">
                {footerText}
              </div>
            )}

            {/* Timestamp */}
            <div className="text-[10px] text-slate-400 text-right mt-1 font-mono tracking-tight">
              {timeString}
            </div>
          </div>

          {/* Interactive Buttons (Stacked below bubble) */}
          {buttons.length > 0 && (
            <div className="flex flex-col gap-1 w-full">
              {buttons.map((btn) => (
                <div
                  key={btn.id}
                  className="bg-white/95 py-2.5 px-4 rounded-xl shadow-xs border border-slate-200/90 text-center font-medium text-[13px] text-[#00a884] flex items-center justify-center gap-1.5 select-none"
                >
                  <ButtonIcon type={btn.type} />
                  <span className="truncate">{btn.text || 'Button text'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
