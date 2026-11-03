'use client';

import React, { useState } from 'react';
import { LayoutList, FileText, Inbox } from 'lucide-react';
import type { WaFlow } from '@/lib/whatsapp-flows/wa-flow-types';
import WhatsAppFlowBuilder, { type BuilderMode } from './WhatsAppFlowBuilder';
import { FlowListPage } from './FlowListPage';
import { FlowDetailsPage } from './FlowDetailsPage';
import { TemplatesPage } from './TemplatesPage';
import { SubmissionsPage } from './SubmissionsPage';

type Section = 'flows' | 'templates' | 'submissions';

type View =
  | { kind: 'section'; section: Section; flowFilter?: number }
  | { kind: 'builder'; flowId: number | null; draft?: WaFlow; mode?: BuilderMode }
  | { kind: 'details'; flowId: number };

const SECTIONS: { key: Section; label: string; icon: React.FC<{ className?: string }> }[] = [
  { key: 'flows', label: 'Flows', icon: LayoutList },
  { key: 'templates', label: 'Flow templates', icon: FileText },
  { key: 'submissions', label: 'Submissions', icon: Inbox },
];

/**
 * WhatsApp Flows module: listing, screen builder, details (versions / templates / automations),
 * Flow-button templates and customer submissions. Independent of the Automation Builder; the
 * automation "Send WhatsApp Flow" action only references published Flows by id.
 */
export default function WhatsAppFlowsModule() {
  const [view, setView] = useState<View>({ kind: 'section', section: 'flows' });

  const openBuilder = (flowId: number | null, draft?: WaFlow, mode?: BuilderMode) => setView({ kind: 'builder', flowId, draft, mode });
  const openDetails = (flowId: number) => setView({ kind: 'details', flowId });
  const openSection = (section: Section, flowFilter?: number) => setView({ kind: 'section', section, flowFilter });

  if (view.kind === 'builder') {
    return (
      <WhatsAppFlowBuilder
        key={view.flowId ?? 'new'}
        flowId={view.flowId}
        initialDraft={view.draft}
        initialMode={view.mode}
        onBack={() => openSection('flows')}
        onOpenDetails={openDetails}
      />
    );
  }

  const active: Section = view.kind === 'section' ? view.section : 'flows';
  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-[#f8fafc]">
      <div className="h-11 px-4 bg-white border-b border-slate-200 flex items-center gap-1 shrink-0">
        {SECTIONS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => openSection(key)}
            className={`flex items-center gap-1.5 text-[12px] font-semibold px-3 h-11 border-b-2 transition-colors
              ${active === key && view.kind === 'section' ? 'border-[#3440a8] text-[#3440a8]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {view.kind === 'details' && (
          <FlowDetailsPage
            flowId={view.flowId}
            onBack={() => openSection('flows')}
            onEdit={(id) => openBuilder(id)}
            onPreview={(id) => openBuilder(id, undefined, 'preview')}
            onOpenSubmissions={(id) => openSection('submissions', id)}
            onOpenTemplates={(id) => openSection('templates', id)}
          />
        )}
        {view.kind === 'section' && view.section === 'flows' && (
          <FlowListPage
            onCreate={(draft) => openBuilder(null, draft)}
            onEdit={(id) => openBuilder(id)}
            onPreview={(id) => openBuilder(id, undefined, 'preview')}
            onDetails={openDetails}
          />
        )}
        {view.kind === 'section' && view.section === 'templates' && (
          <TemplatesPage flowFilter={view.flowFilter} onOpenFlow={openDetails} />
        )}
        {view.kind === 'section' && view.section === 'submissions' && (
          <SubmissionsPage flowFilter={view.flowFilter} onOpenFlow={openDetails} />
        )}
      </div>
    </div>
  );
}
