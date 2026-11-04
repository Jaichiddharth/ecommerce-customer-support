'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { InboxView, type InboxCounts } from '@/components/InboxView';

export default function InboxPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlConversationId = searchParams.get('c') ?? '';
  const [selectedConversationId, setSelectedConversationId] = useState(urlConversationId);
  const [, setInboxCounts] = useState<InboxCounts>({ unread: 0, ai: 0 });

  // Keep the selection in sync with the URL: clicking "Inbox" in the sidebar (plain /inbox)
  // clears it, and links like /inbox?c=cust-<id> from Contacts/Settings open that conversation
  useEffect(() => {
    setSelectedConversationId(urlConversationId);
  }, [urlConversationId]);

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

