import { AppError } from '@/lib/errors';

export type PageKey =
  | 'home'
  | 'inbox'
  | 'contacts'
  | 'ai'
  | 'flows'
  | 'broadcasts'
  | 'templates'
  | 'analytics'
  | 'integrations'
  | 'settings';

export type CrudAction = 'create' | 'read' | 'update' | 'delete';

export interface PageCrudPermissions {
  create: boolean;
  read: boolean;
  update: boolean;
  delete: boolean;
}

export const WORKSPACE_PAGES_DEF: Array<{
  key: PageKey;
  label: string;
  category: 'Workspace' | 'Setup';
  description: string;
}> = [
  { key: 'home', label: 'Home / Dashboard', category: 'Workspace', description: 'Workspace metrics, performance overview & summary' },
  { key: 'inbox', label: 'Inbox', category: 'Workspace', description: 'Customer chats, multi-channel messaging & replies' },
  { key: 'contacts', label: 'Contacts', category: 'Workspace', description: 'Customer profiles, audience segments, tags & consent' },
  { key: 'ai', label: 'AI agent', category: 'Workspace', description: 'Autonomous AI resolutions, prompts & bot triggers' },
  { key: 'flows', label: 'Flows', category: 'Workspace', description: 'Visual chatbot automation builder, triggers & workflows' },
  { key: 'broadcasts', label: 'Broadcasts', category: 'Workspace', description: 'Outbound marketing campaigns & bulk messaging blasts' },
  { key: 'templates', label: 'Templates', category: 'Workspace', description: 'WhatsApp HSM message templates, approval status & sync' },
  { key: 'analytics', label: 'Analytics', category: 'Workspace', description: 'Resolution times, agent KPIs, CSAT & conversation reports' },
  { key: 'integrations', label: 'Integrations', category: 'Setup', description: 'Shopify stores, WhatsApp Cloud API & third-party connectors' },
  { key: 'settings', label: 'Settings', category: 'Setup', description: 'Workspace settings, team management, billing & security' },
];

export function getDefaultPagePermissions(role?: string): Record<string, PageCrudPermissions> {
  const norm = (role || 'AGENT').toUpperCase();
  const result: Record<string, PageCrudPermissions> = {};

  WORKSPACE_PAGES_DEF.forEach((page) => {
    if (norm === 'OWNER') {
      result[page.key] = { create: true, read: true, update: true, delete: true };
    } else if (norm === 'ADMIN') {
      result[page.key] = { create: true, read: true, update: true, delete: page.key !== 'settings' };
    } else if (norm === 'AGENT') {
      if (['inbox', 'contacts'].includes(page.key)) {
        result[page.key] = { create: true, read: true, update: true, delete: false };
      } else if (['home', 'ai', 'flows', 'broadcasts', 'templates', 'analytics'].includes(page.key)) {
        result[page.key] = { create: false, read: true, update: false, delete: false };
      } else {
        result[page.key] = { create: false, read: false, update: false, delete: false };
      }
    } else {
      // VIEWER
      if (['integrations', 'settings'].includes(page.key)) {
        result[page.key] = { create: false, read: false, update: false, delete: false };
      } else {
        result[page.key] = { create: false, read: true, update: false, delete: false };
      }
    }
  });

  return result;
}

export function canUser(
  user: { role?: string; customPermissions?: any } | null | undefined,
  page: string,
  action: CrudAction
): boolean {
  if (!user) return false;
  const role = (user.role || 'AGENT').toUpperCase();

  // Normalize aliases if any
  const normalizedPage = page === 'automations' ? 'flows' : page;

  // Check custom override for this specific page & action
  const pagePerms = user.customPermissions?.pagePermissions?.[normalizedPage];
  if (pagePerms && typeof pagePerms === 'object' && typeof pagePerms[action] === 'boolean') {
    return pagePerms[action];
  }

  // Fallback to role-based default
  const defaults = getDefaultPagePermissions(role);
  return Boolean(defaults[normalizedPage]?.[action]);
}

export function assertPagePermission(
  user: { role?: string; customPermissions?: any } | null | undefined,
  page: string,
  action: CrudAction
): void {
  if (!canUser(user, page, action)) {
    throw new AppError('FORBIDDEN', {
      message: `You do not have permission to ${action} ${page}.`,
      expected: true,
      details: { page, action },
    });
  }
}

