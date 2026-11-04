'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { InboxView, type InboxCounts } from '@/components/InboxView';

export default function InboxPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedConversationId, setSelectedConversationId] = useState(
    searchParams.get('c') ?? ''
  );
  const [, setInboxCounts] = useState<InboxCounts>({ unread: 0, ai: 0 });

  const handleSelectConversation = (id: string) => {
    setSelectedConversationId(id);
    if (id) {
      router.replace(`/inbox?c=${id}`, { scroll: false });
    } else {
      router.replace('/inbox', { scroll: false });
    }
  };

  return (
    <InboxView
      selectedConversationId={selectedConversationId}
      onSelectConversation={handleSelectConversation}
      onCountsChange={setInboxCounts}
    />
  );
}

