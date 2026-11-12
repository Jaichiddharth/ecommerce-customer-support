'use client';

import { use, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { IntegrationsView, type IntegrationKey } from '@/components/integrations/IntegrationsView';
import { gooeyToast } from '@/components/ui/goey-toaster';

interface Props {
  params: Promise<{ key: string }>;
}

export default function IntegrationDetailPage({ params }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { key: rawKey } = use(params);
  const key = rawKey as IntegrationKey;
  // The OAuth result already announced: effects can run twice (Strict Mode) before the URL is cleaned up
  const handledResultRef = useRef<string | null>(null);

  // Handle Shopify OAuth callback result
  useEffect(() => {
    const result = searchParams.get('shopify');
    if (!result) return;

    const resultKey = searchParams.toString();
    if (handledResultRef.current === resultKey) return;
    handledResultRef.current = resultKey;

    const shop = searchParams.get('shop');
    const name = searchParams.get('name');
    const storeLabel = name && shop ? `${name} (${shop})` : name || shop || 'Your Shopify store';

    if (result === 'connected') {
      gooeyToast.success('Shopify store connected', {
        description: `${storeLabel} has been connected to your workspace.`,
      });
    } else if (result === 'reconnected') {
      gooeyToast.success('Shopify store reconnected', {
        description: `${storeLabel} has been re-authorized. Access to products and orders is restored.`,
      });
    } else if (result === 'error') {
      gooeyToast.error('Unable to connect Shopify store', {
        description: searchParams.get('message') || 'Shopify authorization could not be completed. Please try again.',
      });
    }
    // Strip the OAuth result params from the URL
    window.history.replaceState(null, '', `/integrations/${key}`);
  }, [key, searchParams]);

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
