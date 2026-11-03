'use client';

import React, { useState } from 'react';
import FlowView from '../FlowView';
import { AutomationListPage } from './AutomationListPage';

type View = { kind: 'list' } | { kind: 'builder'; automationId: number | null; startFrom?: 'blank' | 'example' };

/**
 * Automations section: the listing, and the existing node-based builder opened for one
 * automation (an existing one by id, or a new one).
 */
export default function AutomationsModule() {
  const [view, setView] = useState<View>({ kind: 'list' });

  if (view.kind === 'builder') {
    return (
      <FlowView
        key={view.automationId ?? `new-${view.startFrom}`}
        automationId={view.automationId}
        startFrom={view.startFrom}
        onBack={() => setView({ kind: 'list' })}
      />
    );
  }

  return (
    <div className="h-full overflow-auto bg-[#f8fafc]">
      <AutomationListPage
        onCreate={(startFrom) => setView({ kind: 'builder', automationId: null, startFrom })}
        onEdit={(id) => setView({ kind: 'builder', automationId: id })}
      />
    </div>
  );
}
