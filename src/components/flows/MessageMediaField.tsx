'use client';

import React, { useRef, useState } from 'react';
import { AlertTriangle, FileAudio, FileText, FileVideo, Image as ImageIcon, Loader2, Paperclip, X } from 'lucide-react';
import apiClient from '@/lib/api/client';
import { toApiError } from '@/lib/api/api-error';
import { WHATSAPP_ACCEPT_ATTRIBUTE, formatBytes, validateWhatsAppMedia } from '@/lib/media-limits';
import { automationMediaOf, type AutomationMedia } from '@/lib/automation/media';

const KIND_ICONS = { image: ImageIcon, video: FileVideo, audio: FileAudio, document: FileText } as const;

/**
 * Attachment for a Send Message step. The file is stored in S3 as soon as it's chosen; the step
 * saves only its reference (`media`), and every run sends it from there.
 */
export function MessageMediaField({ value, onChange }: { value: unknown; onChange: (media: AutomationMedia | null) => void }) {
  const media = automationMediaOf({ media: value });
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    const check = validateWhatsAppMedia(file);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await apiClient.post('/api/automations/media', form);
      onChange(data.data as AutomationMedia);
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const Icon = media ? KIND_ICONS[media.kind] ?? FileText : Paperclip;

  return (
    <div className="flex flex-col gap-1.5">
      <input ref={inputRef} type="file" accept={WHATSAPP_ACCEPT_ATTRIBUTE} className="hidden" onChange={(e) => choose(e.target.files?.[0])} />
      {media ? (
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50">
          <Icon className="w-4 h-4 text-slate-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-medium text-slate-700 truncate" title={media.filename}>{media.filename}</p>
            <p className="text-[10.5px] text-slate-500 capitalize">{media.kind} · {formatBytes(media.size)}</p>
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="text-[11px] font-semibold text-[#3440a8] hover:underline disabled:opacity-50"
          >
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Replace'}
          </button>
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={uploading}
            className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
            title="Remove attachment"
            aria-label="Remove attachment"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-dashed border-slate-300 text-[12px] font-medium text-slate-600 hover:border-[#3440a8]/50 hover:text-[#3440a8] hover:bg-[#eef0fb]/50 transition-colors disabled:opacity-60"
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
          {uploading ? 'Uploading…' : 'Attach image, video, audio or document'}
        </button>
      )}
      {error && (
        <p role="alert" className="text-[11px] text-red-600 flex items-start gap-1">
          <AlertTriangle className="w-3 h-3 shrink-0 mt-px" />
          {error}
        </p>
      )}
    </div>
  );
}
