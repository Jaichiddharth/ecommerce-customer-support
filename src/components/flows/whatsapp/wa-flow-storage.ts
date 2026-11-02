import type { WaFlow } from '@/lib/whatsapp-flows/wa-flow-types';
import { sanitizeFlowDefinition } from '@/lib/whatsapp-flows/wa-flow-sanitize';

// Drafts created before Flows were stored on the server lived in localStorage under this key.
// They are only read now, so the merchant can import them once; nothing new is written here.
const STORAGE_KEY = 'unocx_whatsapp_flows';

export function loadLocalDrafts(): WaFlow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { flows?: unknown[] };
    if (!Array.isArray(parsed.flows)) return [];
    return parsed.flows.map(sanitizeFlowDefinition).filter((f): f is WaFlow => f !== null);
  } catch {
    return [];
  }
}

/** Removes imported drafts from browser storage (keeps any that failed to import). */
export function forgetLocalDrafts(importedIds: string[]) {
  try {
    const remaining = loadLocalDrafts().filter((f) => !importedIds.includes(f.id));
    if (remaining.length) localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, flows: remaining }));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable — nothing to clean up */
  }
}
