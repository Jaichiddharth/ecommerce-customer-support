'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { Workflow, MessageSquareText, Lock } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { LoadingState } from '@/components/ui/states';
import AutomationsModule from './automations/AutomationsModule';

// The WhatsApp Flows module (listing, screen builder, templates, submissions) lives in ./whatsapp and only loads when opened.
const WhatsAppFlowsModule = dynamic(() => import('./whatsapp/WhatsAppFlowsModule'), {
  ssr: false,
  loading: () => <LoadingState label="Loading WhatsApp Flows…" className="h-full" />,
});

type BuilderKind = 'automation' | 'whatsapp';

const BUILDERS: { key: BuilderKind; label: string; icon: React.FC<{ className?: string }> }[] = [
  { key: 'automation', label: 'Automations', icon: Workflow },
  { key: 'whatsapp', label: 'WhatsApp Flows', icon: MessageSquareText },
];

/** Hosts Automations (listing + node builder) alongside WhatsApp Flows (listing + screen builder). */
export default function FlowsWorkspace() {
  const [kind, setKind] = useState<BuilderKind>('automation');
  const { can } = useAuth();

  if (!can('flows', 'read')) {
    return (
      <div className="h-full flex items-center justify-center p-6 bg-slate-50">
        <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 p-8 text-center flex flex-col items-center shadow-xs">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-600 mb-4">
            <Lock className="w-6 h-6 stroke-[2]" />
          </div>
          <h2 className="text-lg font-bold text-slate-900">Flows Access Restricted</h2>
          <p className="mt-2 text-xs text-slate-500 leading-relaxed">
            Your role does not have permission to view Flows and Automations. Contact your workspace administrator to request access.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <div className="h-10 px-3 bg-[#f4f6fb] border-b border-slate-200 flex items-center gap-1 shrink-0">
        {BUILDERS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setKind(key)}
            className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-colors
              ${kind === key ? 'bg-white text-[#3440a8] shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700 hover:bg-white/60 border border-transparent'}`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        {kind === 'automation' ? <AutomationsModule /> : <WhatsAppFlowsModule />}
      </div>
    </div>
  );
}
