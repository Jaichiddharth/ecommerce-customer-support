'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FlowField } from '@/lib/automation/variables';
import { flowsApi, type PublishedFlowOption } from './whatsapp/wa-api';

/**
 * Published Flows with their questions, loaded once per page and shared by every builder panel
 * (Send WhatsApp Flow picker, variable picker, Flow conditions, live validation).
 */
let cache: Promise<PublishedFlowOption[]> | null = null;

function load(): Promise<PublishedFlowOption[]> {
  cache ??= flowsApi.published().catch((err) => {
    cache = null; // retry on the next panel open
    throw err;
  });
  return cache;
}

export function usePublishedFlows(): { flows: PublishedFlowOption[] | null; failed: boolean } {
  const [flows, setFlows] = useState<PublishedFlowOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    load()
      .then((list) => alive && setFlows(list))
      .catch(() => {
        if (!alive) return;
        setFlows([]);
        setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  return { flows, failed };
}

/** Questions per Flow id; null until the Flows have loaded (checks by name are skipped meanwhile). */
export function useFlowFields(): Map<number, FlowField[]> | undefined {
  const { flows, failed } = usePublishedFlows();
  return useMemo(() => {
    if (!flows || failed) return undefined;
    return new Map(flows.map((f) => [f.id, f.publishedVersion?.fields ?? []]));
  }, [flows, failed]);
}
