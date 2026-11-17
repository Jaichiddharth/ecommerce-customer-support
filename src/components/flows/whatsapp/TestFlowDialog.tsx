'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Send, Loader2, CheckCircle2, AlertTriangle, FlaskConical } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { PhoneNumberInput } from '@/components/ui/PhoneNumberInput';
import { toApiError } from '@/lib/api/api-error';
import { errorTitle } from '@/lib/api/notify';
import { COUNTRIES, digitsOnly, emptyPhone, phoneError as getPhoneError, phoneRule, toPhoneDigits, type PhoneValue } from '@/lib/phone';
import { flowsApi, type FlowTestResult } from './wa-api';
import { FieldLabel, inputCls, primaryBtn, secondaryBtn } from './wa-ui';

type TestTemplate = { id: number; name: string; language: string; status: string };

const LAST_PHONE_KEY = 'unocx.flowTest.lastPhone';

function readLastPhone(): PhoneValue | null {
  try {
    const v = JSON.parse(window.localStorage.getItem(LAST_PHONE_KEY) ?? 'null');
    if (!v || typeof v.country !== 'string' || typeof v.number !== 'string') return null;
    if (!COUNTRIES.some((c) => c.code === v.country)) return null;
    // Older saves may hold "+<full number>"; only keep a plain national number.
    if (v.number.trim().startsWith('+')) return null;
    return { country: v.country, number: digitsOnly(v.number).slice(0, phoneRule(v.country).max) };
  } catch {
    return null;
  }
}

/**
 * Test Flow: sends an approved template of a published Flow to any WhatsApp number through the real
 * Cloud API (from a connected number on the Flow's WhatsApp Business Account). Nothing is simulated.
 */
export function TestFlowDialog({
  flowId,
  flowName,
  templates,
  defaultTemplateId,
  onClose,
}: {
  flowId: number;
  flowName: string;
  templates: TestTemplate[];
  defaultTemplateId?: number;
  onClose: () => void;
}) {
  const approved = useMemo(() => templates.filter((t) => t.status === 'APPROVED'), [templates]);
  const [templateId, setTemplateId] = useState<number | ''>(
    approved.find((t) => t.id === defaultTemplateId)?.id ?? approved[0]?.id ?? ''
  );
  const [phoneValue, setPhoneValue] = useState<PhoneValue>(() => emptyPhone());
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<FlowTestResult | null>(null);
  const [error, setError] = useState<{ title: string; message: string; field?: string; ref?: string } | null>(null);

  useEffect(() => {
    const last = readLastPhone();
    if (last) setPhoneValue(last);
  }, []);

  const phone = toPhoneDigits(phoneValue);
  const phoneError = phoneValue.number ? getPhoneError(phoneValue) : 'Enter the WhatsApp number to send the test to.';

  const changePhone = (next: PhoneValue) => {
    setPhoneValue(next);
    if (error?.field === 'phone') setError(null);
  };
  const fieldError = (field: string) => (error?.field === field ? error.message : null);
  const shownPhoneError = (touched && phoneError) || fieldError('phone');

  const send = async () => {
    setTouched(true);
    if (phoneError || !templateId) return;
    setSending(true);
    setError(null);
    try {
      const res = await flowsApi.test(flowId, { phone: `+${phone}`, templateId: Number(templateId) });
      setResult(res);
      try { window.localStorage.setItem(LAST_PHONE_KEY, JSON.stringify(phoneValue)); } catch { /* storage unavailable */ }
    } catch (err) {
      const apiErr = toApiError(err);
      const field = typeof apiErr.details?.field === 'string' ? apiErr.details.field : undefined;
      setError({ title: apiErr.title ?? errorTitle(apiErr), message: apiErr.message, field, ref: apiErr.requestId });
    } finally {
      setSending(false);
    }
  };

  const template = approved.find((t) => t.id === templateId);

  return (
    <Modal
      isOpen
      onClose={sending ? () => {} : onClose}
      title={`Test “${flowName}”`}
      icon={<FlaskConical className="w-4 h-4 text-[#3440a8]" />}
      maxWidth="md"
    >
      {result ? (
        <div className="space-y-4">
          <div className="flex flex-col items-center text-center gap-2 py-3">
            <div className="w-11 h-11 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            </div>
            <p className="text-[13px] font-bold text-slate-800">Test sent to +{result.to}</p>
            <p className="text-[11px] text-slate-500 max-w-xs">
              WhatsApp accepted the message. Open it on that phone and tap the button to try the Flow.
              The answer will appear under Submissions.
            </p>
          </div>
          <dl className="rounded-xl border border-slate-200 bg-slate-50/60 divide-y divide-slate-100 text-[11px]">
            {[
              ['Template', template ? `${template.name} (${template.language})` : '—'],
              ['Sent from', [result.from.name, result.from.phoneNumber].filter(Boolean).join(' · ') || '—'],
              ['WhatsApp message ID', result.execution.metaMessageId ?? '—'],
            ].map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-3 px-3 py-2">
                <dt className="text-slate-400 shrink-0">{label}</dt>
                <dd className="text-slate-700 font-medium text-right break-all">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex justify-end gap-2">
            <button className={secondaryBtn} onClick={() => setResult(null)}>Send another</button>
            <button className={primaryBtn} onClick={onClose}>Done</button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Sends a real WhatsApp message with the template’s Flow button, from your connected number on this
            Flow’s WhatsApp Business Account.
          </p>

          <FieldLabel label="WhatsApp number">
            <PhoneNumberInput
              size="sm"
              autoFocus
              value={phoneValue}
              onChange={changePhone}
              onBlur={() => setTouched(true)}
              error={shownPhoneError || null}
              hint={!phoneError ? `Will send to +${phone}` : undefined}
            />
          </FieldLabel>

          <FieldLabel label="Template" hint={approved.length ? 'Only approved templates that open this Flow can be sent.' : undefined}>
            {approved.length ? (
              <>
                <select
                  value={templateId}
                  onChange={(e) => { setTemplateId(Number(e.target.value)); if (error?.field === 'templateId') setError(null); }}
                  className={`${inputCls} ${fieldError('templateId') ? '!border-red-300' : ''}`}
                >
                  {approved.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}
                </select>
                {fieldError('templateId') && <span className="block text-[10px] text-red-500">{fieldError('templateId')}</span>}
              </>
            ) : (
              <p className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                No approved template opens this Flow yet. Create one under “Flow templates” and wait for Meta’s approval.
              </p>
            )}
          </FieldLabel>

          {error && !error.field && (
            <div role="alert" className="flex items-start gap-2 text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
              <div className="min-w-0">
                <p className="font-semibold">{error.title}</p>
                <p className="break-words">{error.message}</p>
                {error.ref && <p className="text-[10px] text-red-400 mt-0.5">Ref {error.ref}</p>}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button className={secondaryBtn} onClick={onClose} disabled={sending}>Cancel</button>
            <button className={primaryBtn} onClick={send} disabled={sending || !approved.length}>
              {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              {sending ? 'Sending…' : 'Send test'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
