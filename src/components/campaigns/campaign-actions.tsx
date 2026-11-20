'use client';

import React, { useState } from 'react';
import { Ban, Copy, Download, Pause, Play, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { useAuth } from '@/context/AuthContext';
import { canTransition, deleteCampaign, downloadCampaignLogs, duplicateCampaign, setCampaignStatus } from './campaign-store';
import type { Campaign } from './types';

export interface CampaignAction {
  key: 'pause' | 'resume' | 'duplicate' | 'export' | 'cancel' | 'delete';
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}

type Confirm = { kind: 'delete' | 'cancel'; campaign: Campaign };

/**
 * Status actions shared by the list and the details page: pause, resume, duplicate, export logs, cancel, delete.
 * `onDone` runs after a successful action (refresh); `onDeleted` after a delete (e.g. leave the details page).
 */
export function useCampaignActions({ onDone, onDeleted }: { onDone: () => unknown; onDeleted?: () => void }) {
  const { can, hasPermission } = useAuth();
  const canLaunch = hasPermission('create_and_launch_campaigns');
  const canCreate = can('broadcasts', 'create') && canLaunch;
  const canUpdate = can('broadcasts', 'update');
  const canDelete = can('broadcasts', 'delete');

  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const run = async (id: string, action: () => Promise<unknown>, success: string): Promise<boolean> => {
    setBusyId(id);
    try {
      await action();
      gooeyToast.success(success);
      await onDone();
      return true;
    } catch (err) {
      gooeyToast.error(err instanceof Error ? err.message : 'Something went wrong');
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const actionsFor = (c: Campaign): CampaignAction[] => {
    const items: CampaignAction[] = [];
    if (canUpdate && canTransition(c.status, 'paused')) {
      items.push({ key: 'pause', label: 'Pause', icon: <Pause className="w-3.5 h-3.5" />, onClick: () => run(c.id, () => setCampaignStatus(c.id, 'paused'), 'Campaign paused') });
    }
    if (canUpdate && canLaunch && c.status === 'paused') {
      items.push({ key: 'resume', label: 'Resume', icon: <Play className="w-3.5 h-3.5" />, onClick: () => run(c.id, () => setCampaignStatus(c.id, 'running'), 'Campaign resumed') });
    }
    if (canCreate) {
      items.push({ key: 'duplicate', label: 'Duplicate', icon: <Copy className="w-3.5 h-3.5" />, onClick: () => run(c.id, () => duplicateCampaign(c.id), 'Copy saved as a draft') });
    }
    if (c.status !== 'draft' && c.recipientCount > 0) {
      items.push({
        key: 'export',
        label: 'Export logs (CSV)',
        icon: <Download className="w-3.5 h-3.5" />,
        onClick: () => downloadCampaignLogs(c.id).catch((err) => gooeyToast.error(err instanceof Error ? err.message : 'Export failed')),
      });
    }
    if (canUpdate && canTransition(c.status, 'cancelled')) {
      items.push({ key: 'cancel', label: 'Cancel campaign', icon: <Ban className="w-3.5 h-3.5" />, danger: true, onClick: () => setConfirm({ kind: 'cancel', campaign: c }) });
    }
    if (canDelete && (c.status === 'draft' || c.status === 'completed' || c.status === 'cancelled' || c.status === 'failed')) {
      items.push({ key: 'delete', label: 'Delete', icon: <Trash2 className="w-3.5 h-3.5" />, danger: true, onClick: () => setConfirm({ kind: 'delete', campaign: c }) });
    }
    return items;
  };

  const confirmAction = async () => {
    if (!confirm) return;
    const { kind, campaign } = confirm;
    if (kind === 'delete') {
      if (await run(campaign.id, () => deleteCampaign(campaign.id), 'Campaign deleted')) onDeleted?.();
    } else {
      await run(campaign.id, () => setCampaignStatus(campaign.id, 'cancelled'), 'Campaign cancelled');
    }
    setConfirm(null);
  };

  const busy = confirm !== null && busyId === confirm.campaign.id;

  const confirmModal = (
    <Modal isOpen={confirm !== null} onClose={() => !busy && setConfirm(null)} title={confirm?.kind === 'delete' ? 'Delete campaign?' : 'Cancel campaign?'} maxWidth="sm">
      <p className="text-xs text-slate-600">
        {confirm?.kind === 'delete' ? (
          <>
            <span className="font-semibold text-slate-900">{confirm.campaign.name || 'This campaign'}</span> and its logs will be removed. This
            can&apos;t be undone.
          </>
        ) : (
          <>
            Contacts that haven&apos;t received <span className="font-semibold text-slate-900">{confirm?.campaign.name}</span> yet won&apos;t get it.
            Messages already sent stay sent. A cancelled campaign can&apos;t be restarted; duplicate it to send again.
          </>
        )}
      </p>
      <div className="mt-5 flex items-center justify-end gap-2">
        <button type="button" onClick={() => setConfirm(null)} disabled={busy} className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer">
          Keep it
        </button>
        <button
          type="button"
          onClick={confirmAction}
          disabled={busy}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 cursor-pointer"
        >
          {busy ? 'Working…' : confirm?.kind === 'delete' ? 'Delete' : 'Cancel campaign'}
        </button>
      </div>
    </Modal>
  );

  return { actionsFor, confirmModal, busyId, canCreate, canUpdate };
}
