'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import FlowView from '@/components/flows/FlowView';

export default function NewAutomationPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const startFrom = (searchParams.get('from') as 'blank' | 'example') ?? 'blank';

  return (
    <FlowView
      key={`new-${startFrom}`}
      automationId={null}
      startFrom={startFrom}
      onBack={() => router.push('/flows/automations')}
      onCreated={(id) => router.replace(`/flows/automations/${id}`)}
    />
  );
}

