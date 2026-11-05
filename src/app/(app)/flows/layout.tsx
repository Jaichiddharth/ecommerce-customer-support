'use client';

import React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Workflow, MessageSquareText } from 'lucide-react';

type BuilderKind = 'automation' | 'whatsapp';

const BUILDERS: { key: BuilderKind; label: string; icon: React.FC<{ className?: string }>; path: string }[] = [
  { key: 'automation', label: 'Automations', icon: Workflow, path: '/flows/automations' },
  { key: 'whatsapp', label: 'WhatsApp Flows', icon: MessageSquareText, path: '/flows/whatsapp' },
];

export default function FlowsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const kind: BuilderKind = pathname.startsWith('/flows/whatsapp') ? 'whatsapp' : 'automation';

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <div className="h-10 px-3 bg-[#f4f6fb] border-b border-slate-200 flex items-center gap-1 shrink-0">
        {BUILDERS.map(({ key, label, icon: Icon, path }) => (
          <button
            key={key}
            onClick={() => router.push(path)}
            className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-colors
              ${kind === key ? 'bg-white text-[#3440a8] shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700 hover:bg-white/60 border border-transparent'}`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

