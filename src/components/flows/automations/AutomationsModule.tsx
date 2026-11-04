'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { AutomationListPage } from './AutomationListPage';

/**
 * Automations section: shows the list page and navigates to the builder via URL.
 */
export default function AutomationsModule() {
  const router = useRouter();

  return (
    <div className="h-full overflow-auto bg-[#f8fafc]">
      <AutomationListPage
        onCreate={(startFrom) => router.push(`/flows/automations/new?from=${startFrom}`)}
        onEdit={(id) => router.push(`/flows/automations/${id}`)}
      />
    </div>
  );
}
