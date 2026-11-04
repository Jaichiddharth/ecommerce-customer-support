'use client';

import { useRouter } from 'next/navigation';
import { AutomationListPage } from '@/components/flows/automations/AutomationListPage';

export default function AutomationsListPage() {
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

