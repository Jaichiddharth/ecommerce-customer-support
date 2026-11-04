'use client';

import dynamic from 'next/dynamic';
import { LoadingState } from '@/components/ui/states';

const WhatsAppFlowsModule = dynamic(
  () => import('@/components/flows/whatsapp/WhatsAppFlowsModule'),
  {
    ssr: false,
    loading: () => <LoadingState label="Loading WhatsApp Flows…" className="h-full" />,
  }
);

/** Catch-all for /flows/whatsapp and all sub-paths — the module manages its own internal navigation. */
export default function WhatsAppFlowsCatchAll() {
  return (
    <div className="h-full overflow-hidden">
      <WhatsAppFlowsModule />
    </div>
  );
}

