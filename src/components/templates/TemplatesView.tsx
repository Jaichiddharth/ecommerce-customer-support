'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { TemplatesListView, TemplateNumber } from './TemplatesListView';
import { TemplateEditorView, TemplateEditorMode } from './TemplateEditorView';
import { WhatsAppTemplate, TemplateStatus } from '@/types/templates';
import { apiClient } from '@/lib/api/client';
import { notifyError } from '@/lib/api/notify';
import { toApiError } from '@/lib/api/api-error';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { formatPhone } from '@/components/inbox/inbox-types';
import { useRealtime } from '@/lib/hooks/useRealtime';
import type { RealtimeEvent } from '@/lib/realtime';

const TEMPLATE_STATUSES: TemplateStatus[] = ['APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED'];

/** Template names can be 80 characters with no spaces; this lets them wrap inside a toast */
const WRAP_DESCRIPTION = { description: 'wrap-anywhere' };

interface TemplatesChannel {
  name?: string;
  phoneNumber?: string;
  metaPhoneNumberId?: string;
  wabaId?: string;
}

export const TemplatesView: React.FC = () => {
  const [editor, setEditor] = useState<{ mode: TemplateEditorMode; template: WhatsAppTemplate | null } | null>(null);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // null until the first response says whether a WhatsApp channel exists
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [channel, setChannel] = useState<TemplatesChannel | null>(null);
  const [numbers, setNumbers] = useState<TemplateNumber[]>([]);
  // undefined until chosen: the server then uses the active number
  const [phoneNumberId, setPhoneNumberId] = useState<string | undefined>();
  const requestRef = useRef(0);

  useEffect(() => {
    apiClient
      .get('/api/channels', { params: { type: 'whatsapp', includeDisconnected: 'false' } })
      .then((res) => {
        const list: any[] = Array.isArray(res.data?.channels) ? res.data.channels : [];
        setNumbers(
          list
            .filter((c) => c.metaPhoneNumberId)
            .map((c) => ({
              phoneNumberId: c.metaPhoneNumberId,
              name: c.verified_name || c.name || 'WhatsApp',
              phone: formatPhone(c.phoneNumber),
            }))
        );
      })
      // The switcher is optional; templates still load for the active number
      .catch(() => setNumbers([]));
  }, []);

  const fetchTemplates = useCallback(async () => {
    const requestId = ++requestRef.current;
    setIsLoading(true);
    try {
      const res = await apiClient.get('/api/channels/whatsapp/templates', { params: { phoneNumberId } });
      if (requestId !== requestRef.current) return;
      setIsConnected(Boolean(res.data.connected));
      setChannel(res.data.channel ?? null);
      setTemplates(Array.isArray(res.data.templates) ? res.data.templates : []);
      setLoadError(res.data.error ?? null);
    } catch (err) {
      if (requestId === requestRef.current) setLoadError(toApiError(err).message);
    } finally {
      if (requestId === requestRef.current) setIsLoading(false);
    }
  }, [phoneNumberId]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // Meta's review result arrives over SSE: update the row in place, no Sync needed
  const handleTemplateStatus = (event: Extract<RealtimeEvent, { type: 'template.status' }>) => {
    if (channel?.wabaId && event.wabaId !== channel.wabaId) return; // another number's business account
    // Other events (FLAGGED, REINSTATED, …) or a template this page hasn't loaded: reload the list
    const status = TEMPLATE_STATUSES.find((s) => s === event.status);
    if (!status || !templates.some((t) => t.id === event.templateId)) {
      fetchTemplates();
      return;
    }
    setTemplates((prev) =>
      prev.map((t) =>
        t.id === event.templateId
          ? { ...t, status, rejected_reason: status === 'REJECTED' ? event.reason ?? 'NONE' : t.rejected_reason }
          : t
      )
    );

    // The name goes in the description, which wraps; toast titles stay on one line
    const label = `${event.name} (${event.language})`;
    if (event.status === 'APPROVED') gooeyToast.success('Template approved', { description: label, classNames: WRAP_DESCRIPTION });
    else if (event.status === 'REJECTED') {
      gooeyToast.error('Template rejected', { description: `${label}. See the reason below the list.`, classNames: WRAP_DESCRIPTION });
    } else if (event.status === 'PAUSED' || event.status === 'DISABLED') {
      gooeyToast.warning(`Template ${event.status.toLowerCase()} by Meta`, { description: label, classNames: WRAP_DESCRIPTION });
    }
  };

  useRealtime({ onTemplateStatus: handleTemplateStatus });

  const handleNumberChange = (id: string) => {
    // Never show one number's templates under another
    setTemplates([]);
    setLoadError(null);
    setPhoneNumberId(id);
  };

  const handleDelete = async (template: WhatsAppTemplate) => {
    try {
      await apiClient.delete('/api/channels/whatsapp/templates', {
        params: { name: template.name, hsm_id: template.id, phoneNumberId: channel?.metaPhoneNumberId },
      });
      gooeyToast.success('Template deleted', {
        description: `${template.name} (${template.language})`,
        classNames: WRAP_DESCRIPTION,
      });
      // With an id only that language version is deleted on Meta; without one, every version of the name
      setTemplates((prev) =>
        prev.filter((t) => (template.id ? t.id !== template.id : t.name !== template.name))
      );
    } catch (err) {
      notifyError(err, { where: 'TemplatesView.handleDelete', title: 'Template not deleted' });
      throw err;
    }
  };

  const handleSuccess = () => {
    setEditor(null);
    fetchTemplates();
  };

  const businessName = channel?.name || 'Your business';

  if (editor) {
    return (
      <TemplateEditorView
        mode={editor.mode}
        initialTemplate={editor.template}
        onBack={() => setEditor(null)}
        onSuccess={handleSuccess}
        businessName={businessName}
        connectedNumber={channel?.phoneNumber ?? null}
        phoneNumberId={channel?.metaPhoneNumberId}
      />
    );
  }

  return (
    <TemplatesListView
      templates={templates}
      isLoading={isLoading}
      loadError={loadError}
      onRefresh={fetchTemplates}
      onCreateNew={() => setEditor({ mode: 'create', template: null })}
      onEdit={(template) => setEditor({ mode: 'edit', template })}
      onDuplicate={(template) => setEditor({ mode: 'duplicate', template })}
      onDelete={handleDelete}
      businessName={businessName}
      isConnected={isConnected !== false}
      numbers={numbers}
      connectedPhone={channel?.phoneNumber ? formatPhone(channel.phoneNumber) : undefined}
      selectedNumberId={phoneNumberId ?? channel?.metaPhoneNumberId}
      onNumberChange={handleNumberChange}
    />
  );
};
