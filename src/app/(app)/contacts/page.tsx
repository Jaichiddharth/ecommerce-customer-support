'use client';

import { useRouter } from 'next/navigation';
import { ContactsView } from '@/components/contacts/ContactsView';

export default function ContactsPage() {
  const router = useRouter();
  return (
    <ContactsView
      onOpenConversation={(customerId) => router.push(`/inbox?c=cust-${customerId}`)}
    />
  );
}
