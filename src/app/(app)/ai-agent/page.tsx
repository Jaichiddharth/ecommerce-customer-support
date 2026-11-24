import { Suspense } from 'react';
import { AiAgentView } from '@/components/ai-agent/AiAgentView';
import { LoadingState } from '@/components/ui/states';

export default function AiAgentPage() {
  // The view reads ?tab= with useSearchParams, which needs a Suspense boundary
  return (
    <Suspense fallback={<LoadingState label="Loading AI agent…" />}>
      <AiAgentView />
    </Suspense>
  );
}
