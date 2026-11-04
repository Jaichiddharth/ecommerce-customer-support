'use client';

import React from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import {
  BREACH_CONTACT_EMAIL,
  CONSENT_CONFIRMATIONS,
  DPDP_COMPLIANCE_DEADLINE,
  INACTIVE_CONTACT_RETENTION_MONTHS,
  OPT_IN_KEYWORDS,
  OPT_OUT_KEYWORDS,
} from '@/types/consent';

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
      {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px] text-slate-600 mb-2">{children}</p>;
}

function KeywordChips({ keywords }: { keywords: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {keywords.map((k) => (
        <span key={k} className="px-3 py-1 rounded-full bg-slate-100 text-[12.5px] font-semibold text-slate-700">
          {k}
        </span>
      ))}
    </div>
  );
}

/** A value that can't be edited yet */
function ReadOnlyBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 h-10 px-3 rounded-lg border border-slate-200 bg-slate-50 text-[13px] text-slate-800">
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
    </div>
  );
}

/**
 * Settings → Consent & privacy. Read-only for now: the values are fixed in `@/types/consent`, which is also what
 * the WhatsApp webhook uses to detect opt-out / opt-in keywords.
 */
export function ConsentPrivacySection() {
  return (
    <div className="px-8 pb-10 space-y-5 max-w-5xl">
      <div className="flex items-start gap-2.5 rounded-xl bg-[#eef0fb] px-4 py-3">
        <ShieldCheck className="w-4 h-4 text-[#3440a8] mt-0.5 shrink-0" />
        <p className="text-[13px] text-slate-800">
          India&apos;s DPDP Rules require full compliance by {DPDP_COMPLIANCE_DEADLINE}. These settings produce the consent log for
          every contact.
        </p>
      </div>

      <Card
        title="Opt-out and retention"
        subtitle="Customers opt out by replying with a stop keyword. Each store and WhatsApp number keeps its own consent per contact."
      >
        <div className="grid gap-6 lg:grid-cols-[1fr_200px_240px]">
          <div>
            <FieldLabel>Stop keywords</FieldLabel>
            <KeywordChips keywords={OPT_OUT_KEYWORDS} />
          </div>
          <div>
            <FieldLabel>Erase inactive contacts after</FieldLabel>
            <ReadOnlyBox>
              {INACTIVE_CONTACT_RETENTION_MONTHS} <span className="text-slate-500">months</span>
            </ReadOnlyBox>
          </div>
          <div>
            <FieldLabel>Breach contact (DPO)</FieldLabel>
            <ReadOnlyBox>{BREACH_CONTACT_EMAIL}</ReadOnlyBox>
          </div>
        </div>

        <div className="mt-6">
          <FieldLabel>Opt-in keywords</FieldLabel>
          <KeywordChips keywords={OPT_IN_KEYWORDS} />
        </div>

        <p className="mt-5 text-[11.5px] text-slate-500 leading-relaxed">
          The whole message must be the keyword (any case, punctuation ignored). WhatsApp&apos;s own &quot;Stop promotions&quot; button
          and delivery error 131050 also mark a contact as opted out. Opted-out contacts receive nothing from you (no replies,
          templates or campaigns) until they reply with an opt-in keyword.
        </p>
      </Card>

      <Card
        title="Confirmation messages"
        subtitle="Sent automatically when a customer opts out or back in, while WhatsApp's 24-hour window is open."
      >
        <div className="grid gap-4 md:grid-cols-2">
          {(['opted_out', 'opted_in'] as const).map((status) => (
            <div key={status}>
              <FieldLabel>{status === 'opted_out' ? 'After opting out' : 'After opting in'}</FieldLabel>
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13px] text-slate-800 leading-relaxed">
                {CONSENT_CONFIRMATIONS[status]}
              </p>
            </div>
          ))}
        </div>
      </Card>

      <p className="flex items-center gap-1.5 text-[11.5px] text-slate-400">
        <Lock className="w-3 h-3" />
        These settings are fixed for now and can&apos;t be edited.
      </p>
    </div>
  );
}
