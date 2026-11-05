'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import FlowView from '@/components/flows/FlowView';
import { EmptyState } from '@/components/ui/states';

interface Props {
  // Route params are a Promise in this Next.js version (reading .id directly gives undefined → NaN)
  params: Promise<{ id: string }>;
}

export default function EditAutomationPage({ params }: Props) {
  const router = useRouter();
  const { id } = use(params);
  const automationId = /^\d+$/.test(id) ? Number(id) : null;
  const back = () => router.push('/flows/automations');

  if (!automationId) {
    return (
      <EmptyState
        className="h-full"
        title="Automation not found"
        description="This link doesn't point to an automation."
        action={
          <button onClick={back} className="text-[12px] font-semibold text-white bg-[#3440a8] hover:bg-[#2a3490] px-3.5 py-2 rounded-lg">
            Back to automations
          </button>
        }
      />
    );
  }

  return <FlowView key={automationId} automationId={automationId} onBack={back} />;
}
