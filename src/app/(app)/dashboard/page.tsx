'use client';

import { useRouter } from 'next/navigation';
import { DashboardView } from '@/components/DashboardView';

export default function DashboardPage() {
  const router = useRouter();
  return (
    <DashboardView
      setActiveTab={(tab) => router.push(`/${tab}`)}
      onSelectConversation={(id) => router.push(`/inbox?c=${id}`)}
    />
  );
}

