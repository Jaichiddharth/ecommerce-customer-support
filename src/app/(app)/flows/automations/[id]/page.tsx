'use client';

import { useRouter } from 'next/navigation';
import FlowView from '@/components/flows/FlowView';

interface Props {
  params: { id: string };
}

export default function EditAutomationPage({ params }: Props) {
  const router = useRouter();
  const automationId = parseInt(params.id, 10);

  return (
    <FlowView
      key={automationId}
      automationId={automationId}
      onBack={() => router.push('/flows/automations')}
    />
  );
}

