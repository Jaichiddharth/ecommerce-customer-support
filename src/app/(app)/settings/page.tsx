'use client';

import { useRouter } from 'next/navigation';
import { SettingsView } from '@/components/SettingsView';

export default function SettingsPage() {
  const router = useRouter();
  return (
    <SettingsView
      onOpenConversation={(id) => router.push(`/inbox?c=${id}`)}
    />
  );
}

