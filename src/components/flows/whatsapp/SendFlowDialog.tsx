'use client';

import React, { useEffect, useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { notifyError } from '@/lib/api/notify';
import { flowsApi, type FlowDetails, type Recipient } from './wa-api';
import { FieldLabel, inputCls, primaryBtn, secondaryBtn } from './wa-ui';

/** Send a published Flow to one contact, via an approved template or (inside 24h) an interactive message. */
export function SendFlowDialog({
  flowId,
  flowName,
  templates,
  onClose,
  onSent,
}: {
  flowId: number;
  flowName: string;
  templates: FlowDetails['templates'];
  onClose: () => void;
  onSent: () => void;
}) {
  const approved = templates.filter((t) => t.status === 'APPROVED');
  const [method, setMethod] = useState<'template' | 'interactive'>(approved.length ? 'template' : 'interactive');
  const [templateId, setTemplateId] = useState<number | ''>(approved[0]?.id ?? '');
  const [cta, setCta] = useState('Open form');
  const [bodyText, setBodyText] = useState(`Please fill in: ${flowName}`);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Recipient[]>([]);
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (recipient || q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => {
      flowsApi.recipients(q.trim()).then(setResults).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, recipient]);

  const canSend = !!recipient && (method === 'template' ? !!templateId : cta.trim() && bodyText.trim());

  const send = async () => {
    if (!recipient) return;
    setSending(true);
    try {
      await flowsApi.send(flowId, {
        customerId: recipient.id,
        method,
        ...(method === 'template' ? { templateId: Number(templateId) } : { cta: cta.trim(), bodyText: bodyText.trim() }),
      });
      onSent();
    } catch (err) {
      notifyError(err, { where: 'SendFlowDialog', title: 'Flow not sent' });
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Send “${flowName}”`} maxWidth="md">
      <div className="space-y-4">
        <FieldLabel label="Recipient">
          {recipient ? (
            <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-[12px]">
              <span><strong>{recipient.name}</strong> <span className="text-slate-500">+{recipient.phone}</span></span>
              <button className="text-[11px] text-[#3440a8] font-semibold" onClick={() => { setRecipient(null); setQ(''); }}>Change</button>
            </div>
          ) : (
            <div className="relative">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts by name or phone…" className={inputCls} autoFocus />
              {results.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full max-h-52 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg">
                  {results.map((r) => (
                    <li key={r.id}>
                      <button className="w-full text-left px-3 py-2 text-[12px] hover:bg-slate-50" onClick={() => setRecipient(r)}>
                        <strong>{r.name}</strong> <span className="text-slate-500">+{r.phone}</span>
                        {r.channelName && <span className="text-[10px] text-slate-400"> · {r.channelName}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </FieldLabel>

        <FieldLabel label="Sending method">
          <div className="grid grid-cols-2 gap-2">
            {([
              ['template', 'Approved template', 'Any time'],
              ['interactive', 'Interactive message', 'Only within 24h of the customer’s last message'],
            ] as const).map(([value, label, hint]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMethod(value)}
                className={`text-left px-3 py-2 rounded-lg border text-[12px] ${method === value ? 'border-[#3440a8] bg-[#3440a8]/5' : 'border-slate-200 hover:bg-slate-50'}`}
              >
                <span className="block font-semibold text-slate-700">{label}</span>
                <span className="block text-[10px] text-slate-400">{hint}</span>
              </button>
            ))}
          </div>
        </FieldLabel>

        {method === 'template' ? (
          <FieldLabel label="Template" hint={approved.length ? 'Only approved templates that open this Flow are listed.' : undefined}>
            {approved.length ? (
              <select value={templateId} onChange={(e) => setTemplateId(Number(e.target.value))} className={inputCls}>
                {approved.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}
              </select>
            ) : (
              <p className="text-[11px] text-amber-600">No approved template opens this Flow yet. Create one under “Flow templates”, or use an interactive message.</p>
            )}
          </FieldLabel>
        ) : (
          <>
            <FieldLabel label="Message text">
              <textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} rows={3} className={`${inputCls} resize-none`} maxLength={1024} />
            </FieldLabel>
            <FieldLabel label="Button text" hint="Keep it under 30 characters, without emoji.">
              <input value={cta} onChange={(e) => setCta(e.target.value)} className={inputCls} maxLength={30} />
            </FieldLabel>
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button className={secondaryBtn} onClick={onClose}>Cancel</button>
          <button className={primaryBtn} onClick={send} disabled={!canSend || sending}>
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send Flow
          </button>
        </div>
      </div>
    </Modal>
  );
}
