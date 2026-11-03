import type { WaComponent, WaFlow, WaScreen } from './wa-flow-types';
import { DEFAULT_FLOW_VERSION, WA_PALETTE_ITEMS, normalizeOrder, uid } from './wa-component-registry';

const KNOWN_TYPES = new Set(WA_PALETTE_ITEMS.map((i) => i.type));
const MAX_SCREENS = 50;

/**
 * Defensive restore of an editor model from untrusted input (browser storage or an API body):
 * drops unknown components, fills defaults added in later builds, and keeps the shape the
 * generator/validator expect. Returns null when the input isn't a flow at all.
 */
export function sanitizeFlowDefinition(raw: unknown): WaFlow | null {
  const f = raw as Partial<WaFlow> | null;
  if (!f || typeof f !== 'object' || !Array.isArray(f.screens)) return null;

  const screens: WaScreen[] = f.screens
    .slice(0, MAX_SCREENS)
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

  const now = new Date().toISOString();
  return {
    id: typeof f.id === 'string' && f.id ? f.id : uid('flow'),
    name: String(f.name ?? 'Untitled Flow'),
    version: typeof f.version === 'string' && f.version ? f.version : DEFAULT_FLOW_VERSION,
    screens,
    createdAt: f.createdAt || now,
    updatedAt: f.updatedAt || now,
  };
}
