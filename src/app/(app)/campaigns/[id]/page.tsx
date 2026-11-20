'use client';

import { use } from 'react';
import { CampaignWizard } from '@/components/campaigns/wizard/CampaignWizard';

interface Props {
  // Route params are a Promise in this Next.js version
  params: Promise<{ id: string }>;
}

export default function EditCampaignPage({ params }: Props) {
  const { id } = use(params);
  return <CampaignWizard key={id} campaignId={id} />;
}
