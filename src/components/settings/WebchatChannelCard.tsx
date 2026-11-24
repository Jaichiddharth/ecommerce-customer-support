'use client';

import React, { useState } from 'react';
import { ChevronDown, Loader2, Plus, Unplug } from 'lucide-react';
import { notifyError } from '@/lib/api/notify';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { aiAgentApi } from '@/components/ai-agent/api';
import { ChannelIcon } from '../inbox/ChannelIcon';
import { WebchatSettings } from '../channels/WebchatSettings';
import { Channel, STATUS_META, fmtDate } from './channel-settings';

/** Adds (or reconnects) the Website chat channel; returns its channel id */
export async function connectWebchat(): Promise<number | null> {
  try {
    const w = await aiAgentApi.connectWebchat();
    gooeyToast.success('Website chat added', { description: 'Copy the install code below and paste it on your website.' });
    return w.channelId;
  } catch (err) {
    notifyError(err, { where: 'connectWebchat', title: "Couldn't add the website chat" });
    return null;
  }
}

/** Settings › Channels: the Website chat channel, or an invitation to add it */
export function WebchatChannelSection({
  channel,
  expanded,
  onToggle,
  onDisconnect,
  onChanged,
  canEdit,
}: {
  channel: Channel | null;
  expanded: boolean;
  onToggle: () => void;
  onDisconnect: (channel: Channel) => void;
  onChanged: (channelId: number | null) => void;
  canEdit: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    onChanged(await connectWebchat());
    setBusy(false);
  };

  if (!channel) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-8 flex flex-col items-center text-center">
        <ChannelIcon type="webchat" size="lg" />
        <p className="mt-3 text-sm font-semibold text-slate-800">Add a chat to your website</p>
        <p className="mt-1 text-xs text-slate-500 max-w-md">
          A chat button for any website. Your AI agent welcomes visitors and helps them find products in your store; order questions go to
          WhatsApp, and every chat lands in this inbox.
        </p>
        <button
          type="button"
          onClick={add}
          disabled={!canEdit || busy}
          className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#3440a8] hover:bg-[#2b358c] transition-colors cursor-pointer disabled:opacity-60"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Add website chat
        </button>
      </div>
    );
  }

  const disconnected = channel.status === 'disconnected';
  const status = STATUS_META[channel.status] ?? STATUS_META.error;
  return (
    <div className={`rounded-xl border bg-white transition-shadow ${expanded ? 'border-slate-300 shadow-sm' : 'border-slate-200'}`}>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <ChannelIcon type="webchat" size="lg" />
        <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex-1 min-w-0 text-left cursor-pointer">
          <p className="text-sm font-semibold text-slate-900 truncate">{channel.verified_name || 'Website chat'}</p>
          <p className="text-xs text-slate-500 truncate">
            Chat widget for your website
            <span className="text-slate-400"> · added {fmtDate(channel.createdAt)}</span>
          </p>
        </button>
        <span className={`hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-semibold ${status.pill}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
          {status.label}
        </span>
        {disconnected && (
          <button
            type="button"
            onClick={add}
            disabled={!canEdit || busy}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#3440a8] hover:bg-[#2b358c] transition-colors cursor-pointer disabled:opacity-60"
          >
            {busy ? 'Reconnecting…' : 'Reconnect'}
          </button>
        )}
        {!disconnected && (
          <button
            type="button"
            onClick={onToggle}
            title={expanded ? 'Hide settings' : 'Show settings'}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <ChevronDown className={`w-4 h-4 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>
      {expanded && !disconnected && (
        <div className="px-4 pb-4 pt-4 border-t border-slate-100">
          <WebchatSettings canEdit={canEdit} />
          <div className="mt-4 pt-3 border-t border-slate-100 flex justify-end">
            <button
              type="button"
              onClick={() => onDisconnect(channel)}
              disabled={!canEdit}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-red-600 hover:text-red-700 hover:bg-red-50 border border-red-200 transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
            >
              <Unplug className="w-3.5 h-3.5" />
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
