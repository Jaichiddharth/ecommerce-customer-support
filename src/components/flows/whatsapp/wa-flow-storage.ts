import type { WaComponent, WaFlow, WaScreen } from './wa-flow-types';
import { DEFAULT_FLOW_VERSION, WA_PALETTE_ITEMS, normalizeOrder, uid } from './wa-component-registry';

// Mirrors the existing automation builder (FlowView), which persists to localStorage.
// Kept under its own key so the two builders never share or overwrite state.
const STORAGE_KEY = 'unocx_whatsapp_flows';
const STORAGE_VERSION = 1;

interface StoredFlows {
  v: number;
  flows: WaFlow[];
}

const KNOWN_TYPES = new Set(WA_PALETTE_ITEMS.map((i) => i.type));

/** Defensive restore: drops unknown components and fills defaults added in later builds. */
function reviveFlow(raw: WaFlow): WaFlow | null {
  if (!raw || typeof raw.id !== 'string' || !Array.isArray(raw.screens)) return null;
  const screens: WaScreen[] = raw.screens
    .filter((s) => s && typeof s.uid === 'string')
    .map((s) => ({
      uid: s.uid,
      id: String(s.id ?? ''),
      title: String(s.title ?? ''),
      success: s.success !== false,
      components: normalizeOrder(
        (Array.isArray(s.components) ? s.components : [])
          .filter((c: WaComponent) => c && typeof c.uid === 'string' && KNOWN_TYPES.has(c.type))
          .map((c: WaComponent) =>
            'options' in c && Array.isArray(c.options)
              ? { ...c, options: c.options.map((o) => ({ ...o, uid: o.uid || uid('o') })) }
              : c,
          ),
      ),
    }));
  return {
    id: raw.id,
    name: String(raw.name ?? 'Untitled Flow'),
    version: raw.version || DEFAULT_FLOW_VERSION,
    screens,
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

export function loadFlows(): WaFlow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredFlows;
    if (!Array.isArray(parsed.flows)) return [];
    return parsed.flows.map(reviveFlow).filter((f): f is WaFlow => f !== null);
  } catch {
    return [];
  }
}

function writeFlows(flows: WaFlow[]) {
  const data: StoredFlows = { v: STORAGE_VERSION, flows };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/** Inserts or replaces `flow`; returns the saved copy (with a fresh updatedAt). Throws if storage is unavailable. */
export function saveFlow(flow: WaFlow): WaFlow {
  const saved = { ...flow, updatedAt: new Date().toISOString() };
  const flows = loadFlows();
  const idx = flows.findIndex((f) => f.id === flow.id);
  if (idx >= 0) flows[idx] = saved;
  else flows.push(saved);
  writeFlows(flows);
  return saved;
}

export function deleteFlow(id: string) {
  writeFlows(loadFlows().filter((f) => f.id !== id));
}
