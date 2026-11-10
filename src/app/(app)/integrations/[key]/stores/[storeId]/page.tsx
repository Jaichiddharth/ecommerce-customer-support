'use client';

import { use } from 'react';
import { notFound, useRouter, useSearchParams } from 'next/navigation';
import { STORE_DETAIL_TABS, ShopifyStoreDetailView, type StoreDetailTab } from '@/components/shopify/ShopifyStoreDetailView';

interface Props {
  params: Promise<{ key: string; storeId: string }>;
}

/** /integrations/shopify/stores/[storeId]?tab=overview|products|orders|customers — one connected Shopify store */
export default function IntegrationStorePage({ params }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { key, storeId: rawStoreId } = use(params);

  const storeId = Number(rawStoreId);
  // Only Shopify has stores; anything else (or a malformed id) is not a page
  if (key !== 'shopify' || !Number.isInteger(storeId) || storeId <= 0) notFound();

  const requested = searchParams.get('tab');
  const tab: StoreDetailTab = STORE_DETAIL_TABS.find((t) => t === requested) ?? 'overview';

  return (
    <ShopifyStoreDetailView
      storeId={storeId}
      tab={tab}
      onTabChange={(next) => {
        const base = `/integrations/shopify/stores/${storeId}`;
        router.replace(next === 'overview' ? base : `${base}?tab=${next}`, { scroll: false });
      }}
    />
  );
}
