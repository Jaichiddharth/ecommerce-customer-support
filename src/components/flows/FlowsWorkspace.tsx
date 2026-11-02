'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { Workflow, MessageSquareText } from 'lucide-react';
import { LoadingState } from '@/components/ui/states';
import FlowView from './FlowView';

// The screen-based builder is isolated in ./whatsapp and only loaded when opened.
const WhatsAppFlowBuilder = dynamic(() => import('./whatsapp/WhatsAppFlowBuilder'), {
  ssr: false,
  loading: () => <LoadingState label="Loading WhatsApp Flow builder…" className="h-full" />,
});

type BuilderKind = 'automation' | 'whatsapp';

const BUILDERS: { key: BuilderKind; label: string; icon: React.FC<{ className?: string }> }[] = [
  { key: 'automation', label: 'Automations', icon: Workflow },
  { key: 'whatsapp', label: 'WhatsApp Flows', icon: MessageSquareText },
];

/** Hosts the existing automation builder alongside the WhatsApp (Meta) Flow builder. */
export default function FlowsWorkspace() {
  const [kind, setKind] = useState<BuilderKind>('automation');

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
        {kind === 'automation' ? <FlowView /> : <WhatsAppFlowBuilder />}
      </div>
    </div>
  );
}
