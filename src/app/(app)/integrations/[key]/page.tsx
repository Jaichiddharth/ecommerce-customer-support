'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { IntegrationsView, type IntegrationKey } from '@/components/integrations/IntegrationsView';
import { gooeyToast } from '@/components/ui/goey-toaster';

interface Props {
  params: { key: string };
}

export default function IntegrationDetailPage({ params }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const key = params.key as IntegrationKey;

  // Handle Shopify OAuth callback result
  useEffect(() => {
    const result = searchParams.get('shopify');
    if (!result) return;

    if (result === 'connected') {
      gooeyToast.success('Shopify store connected', { description: searchParams.get('shop') ?? undefined });
    } else if (result === 'error') {
      gooeyToast.error("Couldn't connect Shopify", {
        description: searchParams.get('message') || 'The Shopify authorization failed. Please try again.',
      });
    }
    // Strip the OAuth result params from the URL
    window.history.replaceState(null, '', `/integrations/${key}`);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <IntegrationsView
      openIntegration={key}
      onOpenIntegration={(k: IntegrationKey | null) => {
        if (k) router.push(`/integrations/${k}`);
        else router.push('/integrations');
      }}
    />
  );
}
