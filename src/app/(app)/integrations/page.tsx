'use client';

import { useRouter } from 'next/navigation';
import { IntegrationsView, type IntegrationKey } from '@/components/integrations/IntegrationsView';

export default function IntegrationsPage() {
  const router = useRouter();
  return (
    <IntegrationsView
      openIntegration={null}
      onOpenIntegration={(key: IntegrationKey | null) => {
        if (key) router.push(`/integrations/${key}`);
      }}
    />
  );
}

