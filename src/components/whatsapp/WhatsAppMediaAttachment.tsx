'use client';

import React, { useState, useEffect, useRef } from 'react';
import { apiClient } from '@/lib/api/client';
import {
  FileText,
  Download,
  ExternalLink,
  Loader2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

/** Global in-memory cache to prevent re-fetching the same media */
const mediaBlobCache = new Map<string, string>();
const pendingFetches = new Map<string, Promise<string>>();

/**
 * Fetches WhatsApp media securely using apiClient with Authorization header.
 * Zero tokens in query params or URLs.
 */
export async function getWhatsAppMediaBlobUrl(rawMediaUrl: string): Promise<string> {
  if (!rawMediaUrl) return '';

  // Non-WhatsApp URLs (e.g. https://... from external hosting or local blobs)
  if (!rawMediaUrl.startsWith('whatsapp-media:') && !rawMediaUrl.startsWith('/api/channels/whatsapp/media/')) {
    return rawMediaUrl;
  }

  const cleanId = rawMediaUrl
    .replace(/^whatsapp-media:/, '')
    .replace(/^\/api\/channels\/whatsapp\/media\//, '')
    .split('?')[0];

  if (mediaBlobCache.has(cleanId)) {
    return mediaBlobCache.get(cleanId)!;
  }

  if (pendingFetches.has(cleanId)) {
    return pendingFetches.get(cleanId)!;
  }

  const fetchPromise = (async () => {
    try {
      const response = await apiClient.get(`/api/channels/whatsapp/media/${cleanId}`, {
        responseType: 'blob',
      });
      const blobUrl = URL.createObjectURL(response.data);
      mediaBlobCache.set(cleanId, blobUrl);
      return blobUrl;
    } finally {
      pendingFetches.delete(cleanId);
    }
  })();

  pendingFetches.set(cleanId, fetchPromise);
  return fetchPromise;
}

export interface WhatsAppMediaAttachmentProps {
  mediaUrl: string;
  mediaType?: string;
  msgType?: string;
  msgText?: string;
  isAgent?: boolean;
  senderName?: string;
  fullTimestamp?: string;
  onPreview: (previewData: {
    url: string;
    type: 'image' | 'video' | 'audio' | 'document' | string;
    senderName?: string;
    timestamp?: string;
    caption?: string;
  }) => void;
}

export const WhatsAppMediaAttachment: React.FC<WhatsAppMediaAttachmentProps> = ({
  mediaUrl,
  mediaType,
  msgType,
  msgText,
  isAgent,
  senderName,
  fullTimestamp,
  onPreview,
}) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  const cleanCaption =
    msgText &&
      !msgText.match(/^\[(Image|Video|Audio|Document|Voice|Sticker)\](\s*(No caption|attachment)?)?$/i) &&
      msgText !== '[Image] No caption' &&
      msgText !== '[Video] No caption'
      ? msgText.trim()
      : '';

  const loadMedia = async () => {
    if (!mediaUrl) {
      setLoading(false);
      return;
    }

    // Direct external URLs don't need blob fetching
    if (!mediaUrl.startsWith('whatsapp-media:') && !mediaUrl.startsWith('/api/channels/whatsapp/media/')) {
      setBlobUrl(mediaUrl);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const url = await getWhatsAppMediaBlobUrl(mediaUrl);
      if (isMountedRef.current) {
        setBlobUrl(url);
        setLoading(false);
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setError('Failed to load media');
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    loadMedia();
    return () => {
      isMountedRef.current = false;
    };
  }, [mediaUrl]);

  const mType = (mediaType || msgType || '').toLowerCase();
  const isSticker = mType === 'sticker';

  // Loading Skeleton
  if (loading) {
    if (isSticker) {
      return <div className="mb-1 h-32 w-32 rounded-xl bg-slate-100 animate-pulse" />;
    }
    return (
      <div className="mb-2 rounded-xl bg-slate-100 border border-slate-200/60 p-4 max-w-sm flex items-center justify-center gap-2 animate-pulse min-h-[120px]">
        <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
        <span className="text-xs text-slate-400 font-medium">Loading attachment...</span>
      </div>
    );
  }

  // Error State
  if (error || !blobUrl) {
    return (
      <div className="mb-2 rounded-xl bg-red-50/60 border border-red-200 p-3 max-w-sm flex items-center justify-between gap-2 text-xs text-red-700">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
          <span>{error || 'Attachment unavailable'}</span>
        </div>
        <button
          type="button"
          onClick={loadMedia}
          className="text-xs font-semibold text-red-600 hover:text-red-800 flex items-center gap-1 cursor-pointer"
        >
          <RefreshCw className="w-3 h-3" /> Retry
        </button>
      </div>
    );
  }

  // Sticker: WhatsApp size (transparent WebP, may be animated), no frame or caption
  if (isSticker) {
    return (
      <img
        src={blobUrl}
        alt="Sticker"
        className="mb-1 h-32 w-32 object-contain cursor-pointer"
        onClick={() => onPreview({ url: blobUrl, type: 'image', senderName, timestamp: fullTimestamp })}
      />
    );
  }

  // Image Attachment
  if (
    mType === 'image' ||
    blobUrl.match(/\.(jpeg|jpg|gif|png|webp)($|\?)/i) ||
    (mType !== 'video' && mType !== 'audio' && mType !== 'document' && !blobUrl.match(/\.(pdf|doc|docx|mp4|mp3|ogg|wav)($|\?)/i))
  ) {
    return (
      <div className="mb-2 rounded-xl overflow-hidden max-w-sm border border-black/5 bg-black/5 group relative">
        <img
          src={blobUrl}
          alt="Attachment"
          className="w-full h-auto max-h-72 object-contain rounded-xl cursor-pointer hover:opacity-95 transition-opacity"
          onClick={() =>
            onPreview({
              url: blobUrl,
              type: 'image',
              senderName,
              timestamp: fullTimestamp,
              caption: cleanCaption,
            })
          }
        />
      </div>
    );
  }

  // Video Attachment
  if (mType === 'video' || blobUrl.match(/\.(mp4|mov|webm)($|\?)/i)) {
    return (
      <div className="mb-2 rounded-xl overflow-hidden max-w-sm">
        <video
          src={blobUrl}
          controls
          controlsList="nodownload nofullscreen noplaybackrate"
          disablePictureInPicture
          className="w-full rounded-xl max-h-72"
        />
        <div className="flex justify-end pt-1 pr-2">
          <button
            type="button"
            onClick={() =>
              onPreview({
                url: blobUrl,
                type: 'video',
                senderName,
                timestamp: fullTimestamp,
                caption: cleanCaption,
              })
            }
            className={`text-[10px] font-semibold flex items-center gap-1 cursor-pointer hover:underline ${isAgent ? 'text-white/80 hover:text-white' : 'text-blue-600'
              }`}
          >
            <ExternalLink className="w-3 h-3" /> Expand Video
          </button>
        </div>
      </div>
    );
  }

  // Audio Attachment
  if (mType === 'audio' || mType === 'voice' || blobUrl.match(/\.(mp3|ogg|wav|m4a|aac)($|\?)/i)) {
    return (
      <div className="mb-2 rounded-xl p-1">
        <audio src={blobUrl} controls className="w-full min-w-[220px]" />
      </div>
    );
  }

  // Document Attachment
  const docTitle = msgText && msgText.startsWith('[Document]') ? msgText.replace('[Document]', '').trim() : 'View Document';
  return (
    <div
      onClick={() =>
        onPreview({
          url: blobUrl,
          type: 'document',
          senderName,
          timestamp: fullTimestamp,
          caption: cleanCaption || docTitle,
        })
      }
      className={`mb-2 p-3 rounded-xl flex items-center gap-3 transition-all cursor-pointer border ${isAgent
        ? 'bg-white/15 hover:bg-white/25 border-white/20 text-white'
        : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-800'
        }`}
    >
      <div className={`p-2 rounded-lg ${isAgent ? 'bg-white/20 text-white' : 'bg-[#eff6ff] text-[#2563eb]'}`}>
        <FileText className="w-5 h-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-xs truncate">{docTitle}</p>
        <p className={`text-[10px] ${isAgent ? 'text-white/80' : 'text-slate-400'}`}>Click to preview document</p>
      </div>
      <Download className={`w-4 h-4 shrink-0 ${isAgent ? 'text-white/80' : 'text-slate-400'}`} />
    </div>
  );
};
