'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import apiClient from '@/lib/api/client';
import { useAuth } from '@/context/AuthContext';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { Modal } from '@/components/ui/Modal';
import type { WorkspaceTrial } from '@/lib/trial';
import {
  Plus,
  Users,
  Lock,
  Check,
  Shield,
  Loader2,
  Sparkles,
  AlertCircle,
  Copy,
  Clock,
  Sliders,
  Send,
  Zap,
  CheckCircle2,
  X,
  LayoutGrid,
  Inbox,
  Bot,
  Megaphone,
  FileText,
  BarChart3,
  Plug,
  Settings,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';

export interface PageCrudPermissions {
  create: boolean;
  read: boolean;
  update: boolean;
  delete: boolean;
}

export interface PageDefinition {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  category: 'Workspace' | 'Setup';
}

export const WORKSPACE_PAGES: PageDefinition[] = [
  { key: 'home', label: 'Home / Dashboard', icon: LayoutGrid, description: 'Workspace metrics, performance overview & summary', category: 'Workspace' },
  { key: 'inbox', label: 'Inbox', icon: Inbox, description: 'Customer chats, multi-channel messaging & replies', category: 'Workspace' },
  { key: 'contacts', label: 'Contacts', icon: Users, description: 'Customer profiles, audience segments, tags & consent', category: 'Workspace' },
  { key: 'ai', label: 'AI agent', icon: Sparkles, description: 'Autonomous AI resolutions, prompts & bot triggers', category: 'Workspace' },
  { key: 'flows', label: 'Flows', icon: Bot, description: 'Visual chatbot automation builder, triggers & workflows', category: 'Workspace' },
  { key: 'broadcasts', label: 'Broadcasts', icon: Megaphone, description: 'Outbound marketing campaigns & bulk messaging blasts', category: 'Workspace' },
  { key: 'templates', label: 'Templates', icon: FileText, description: 'WhatsApp HSM message templates, approval status & sync', category: 'Workspace' },
  { key: 'analytics', label: 'Analytics', icon: BarChart3, description: 'Resolution times, agent KPIs, CSAT & conversation reports', category: 'Workspace' },
  { key: 'integrations', label: 'Integrations', icon: Plug, description: 'Shopify stores, WhatsApp Cloud API & third-party connectors', category: 'Setup' },
  { key: 'settings', label: 'Settings', icon: Settings, description: 'Workspace settings, team management, billing & security', category: 'Setup' },
];

export interface PermissionAreaConfig {
  key: string;
  label: string;
  subtext: (role: string) => string;
  adminOnly?: boolean;
}

export const PERMISSION_AREAS: PermissionAreaConfig[] = [
  {
    key: 'inbox',
    label: 'Conversations',
    subtext: () => 'Assigned and own-team chats',
  },
  {
    key: 'contacts',
    label: 'Contacts',
    subtext: () => 'Profiles, tags, notes',
  },
  {
    key: 'broadcasts',
    label: 'Campaigns',
    subtext: () => 'Broadcasts and segments',
  },
  {
    key: 'templates',
    label: 'Templates',
    subtext: () => 'WhatsApp message templates',
  },
  {
    key: 'flows',
    label: 'Flows',
    subtext: () => 'Flow builder and automations',
  },
  {
    key: 'ai',
    label: 'AI agent',
    subtext: () => 'Take over and hand back chats',
  },
  {
    key: 'integrations',
    label: 'Catalog and payments',
    subtext: () => 'Send products and payment requests',
  },
  {
    key: 'analytics',
    label: 'Analytics',
    subtext: () => 'Own and team reports',
  },
  {
    key: 'team',
    label: 'Team and roles',
    adminOnly: true,
    subtext: (role: string) => {
      const r = (role || '').toUpperCase();
      return r === 'ADMIN' || r === 'OWNER'
        ? 'Invite, edit and manage team members and roles'
        : `Not available to the ${role.charAt(0) + role.slice(1).toLowerCase()} role`;
    },
  },
  {
    key: 'settings',
    label: 'Channels and settings',
    adminOnly: true,
    subtext: (role: string) => {
      const r = (role || '').toUpperCase();
      return r === 'ADMIN' || r === 'OWNER'
        ? 'Workspace channels, routing & configuration'
        : `Not available to the ${role.charAt(0) + role.slice(1).toLowerCase()} role`;
    },
  },
  {
    key: 'billing',
    label: 'Billing',
    adminOnly: true,
    subtext: (role: string) => {
      const r = (role || '').toUpperCase();
      return r === 'ADMIN' || r === 'OWNER'
        ? 'Plan, invoices and payment methods'
        : `Not available to the ${role.charAt(0) + role.slice(1).toLowerCase()} role`;
    },
  },
];

export type RoleAccessLevel = 'full' | 'edit' | 'view' | 'none';

export interface RoleOverviewAreaConfig {
  key: string;
  label: string;
  subtitle: string;
  defaults: {
    OWNER: RoleAccessLevel;
    ADMIN: RoleAccessLevel;
    AGENT: RoleAccessLevel;
    VIEWER: RoleAccessLevel;
  };
  notes?: Partial<Record<'OWNER' | 'ADMIN' | 'AGENT' | 'VIEWER', string>>;
}

export const ROLE_OVERVIEW_AREAS: RoleOverviewAreaConfig[] = [
  {
    key: 'inbox',
    label: 'Conversations',
    subtitle: 'Inbox, replies, assignment',
    defaults: { OWNER: 'full', ADMIN: 'full', AGENT: 'edit', VIEWER: 'view' },
    notes: { AGENT: 'Assigned and own teams' },
  },
  {
    key: 'contacts',
    label: 'Contacts',
    subtitle: 'Profiles, tags, consent',
    defaults: { OWNER: 'full', ADMIN: 'full', AGENT: 'edit', VIEWER: 'view' },
  },
  {
    key: 'broadcasts',
    label: 'Campaigns',
    subtitle: 'Broadcasts and segments',
    defaults: { OWNER: 'full', ADMIN: 'full', AGENT: 'view', VIEWER: 'view' },
  },
  {
    key: 'templates',
    label: 'Templates',
    subtitle: 'WhatsApp message templates',
    defaults: { OWNER: 'full', ADMIN: 'full', AGENT: 'view', VIEWER: 'none' },
  },
  {
    key: 'flows',
    label: 'Flows',
    subtitle: 'Flow builder and automations',
    defaults: { OWNER: 'full', ADMIN: 'full', AGENT: 'none', VIEWER: 'none' },
  },
  {
    key: 'ai',
    label: 'AI agent',
    subtitle: 'Knowledge, actions, guardrails',
    defaults: { OWNER: 'full', ADMIN: 'full', AGENT: 'view', VIEWER: 'none' },
    notes: { AGENT: 'Can take over chats' },
  },
  {
    key: 'integrations',
    label: 'Catalog and payments',
    subtitle: 'WhatsApp catalog, payment setup',
    defaults: { OWNER: 'full', ADMIN: 'full', AGENT: 'view', VIEWER: 'none' },
  },
  {
    key: 'analytics',
    label: 'Analytics',
    subtitle: 'Reports and exports',
    defaults: { OWNER: 'full', ADMIN: 'full', AGENT: 'view', VIEWER: 'view' },
    notes: { AGENT: 'Own and team stats' },
  },
  {
    key: 'team',
    label: 'Team and roles',
    subtitle: 'Invites, roles, permissions',
    defaults: { OWNER: 'full', ADMIN: 'edit', AGENT: 'none', VIEWER: 'none' },
    notes: { ADMIN: "Can't change Owners" },
  },
  {
    key: 'settings',
    label: 'Channels and settings',
    subtitle: 'Numbers, routing, hours, API',
    defaults: { OWNER: 'full', ADMIN: 'full', AGENT: 'none', VIEWER: 'none' },
  },
  {
    key: 'billing',
    label: 'Billing',
    subtitle: 'Plan, invoices, payment method',
    defaults: { OWNER: 'full', ADMIN: 'view', AGENT: 'none', VIEWER: 'none' },
  },
];

export type EditableRoleDefaultsMap = Record<string, Record<'ADMIN' | 'AGENT' | 'VIEWER', RoleAccessLevel>>;

export function getInitialRoleOverviewDefaults(): EditableRoleDefaultsMap {
  const map: EditableRoleDefaultsMap = {};
  ROLE_OVERVIEW_AREAS.forEach((area) => {
    map[area.key] = {
      ADMIN: area.defaults.ADMIN,
      AGENT: area.defaults.AGENT,
      VIEWER: area.defaults.VIEWER,
    };
  });
  return map;
}

export function accessLevelToCrud(level: RoleAccessLevel): PageCrudPermissions {
  if (level === 'full') return { read: true, create: true, update: true, delete: true };
  if (level === 'edit') return { read: true, create: true, update: true, delete: false };
  if (level === 'view') return { read: true, create: false, update: false, delete: false };
  return { read: false, create: false, update: false, delete: false };
}

export function crudToAccessLevel(crud: PageCrudPermissions): RoleAccessLevel {
  if (crud.read && crud.create && crud.update && crud.delete) return 'full';
  if (crud.create || crud.update || crud.delete) return 'edit';
  if (crud.read) return 'view';
  return 'none';
}

export type RoleKey = 'OWNER' | 'ADMIN' | 'AGENT' | 'VIEWER';
export type RoleCrudDefaultsMap = Record<RoleKey, Record<string, PageCrudPermissions>>;
export type RoleDescriptionsMap = Record<RoleKey, string>;

export function getInitialRoleCrudDefaults(): RoleCrudDefaultsMap {
  const result: RoleCrudDefaultsMap = { OWNER: {}, ADMIN: {}, AGENT: {}, VIEWER: {} };
  (['OWNER', 'ADMIN', 'AGENT', 'VIEWER'] as RoleKey[]).forEach((role) => {
    ROLE_OVERVIEW_AREAS.forEach((area) => {
      result[role][area.key] = accessLevelToCrud(area.defaults[role]);
    });
  });
  return result;
}

export function getInitialRoleDescriptions(): RoleDescriptionsMap {
  return {
    OWNER: 'Everything, including billing and deleting the workspace.',
    ADMIN: 'Runs the workspace: channels, flows, AI agent, team. Billing is view-only.',
    AGENT: 'Answers customers in their teams and languages. Sees campaigns and reports.',
    VIEWER: 'Read-only access to conversations, contacts and reports.',
  };
}

function RoleAccessBadge({ level }: { level: RoleAccessLevel }) {
  if (level === 'full') {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#1e2a78] text-white">
        Full
      </span>
    );
  }
  if (level === 'edit') {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-[#1e2a78]">
        Edit
      </span>
    );
  }
  if (level === 'view') {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700">
        View
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium border border-dashed border-slate-300 text-slate-400 bg-white">
      No access
    </span>
  );
}

export function getDefaultPagePermissions(role: string): Record<string, PageCrudPermissions> {
  const norm = (role || 'AGENT').toUpperCase();
  const result: Record<string, PageCrudPermissions> = {};

  const allKeys = [
    'home',
    'inbox',
    'contacts',
    'broadcasts',
    'templates',
    'flows',
    'ai',
    'integrations',
    'analytics',
    'team',
    'settings',
    'billing',
  ];

  allKeys.forEach((key) => {
    if (norm === 'OWNER') {
      result[key] = { create: true, read: true, update: true, delete: true };
    } else if (norm === 'ADMIN') {
      if (key === 'settings') {
        result[key] = { create: true, read: true, update: true, delete: false };
      } else if (key === 'billing') {
        result[key] = { create: false, read: true, update: false, delete: false };
      } else {
        result[key] = { create: true, read: true, update: true, delete: true };
      }
    } else if (norm === 'AGENT') {
      if (['inbox', 'contacts'].includes(key)) {
        result[key] = { create: true, read: true, update: true, delete: false };
      } else if (['home', 'ai', 'broadcasts', 'templates', 'analytics', 'integrations'].includes(key)) {
        result[key] = { create: false, read: true, update: false, delete: false };
      } else {
        result[key] = { create: false, read: false, update: false, delete: false };
      }
    } else {
      // VIEWER
      if (['inbox', 'contacts', 'home', 'ai', 'broadcasts', 'templates', 'analytics'].includes(key)) {
        result[key] = { create: false, read: true, update: false, delete: false };
      } else {
        result[key] = { create: false, read: false, update: false, delete: false };
      }
    }
  });

  return result;
}

export function getRoleDefaultLabel(role: string, areaKey: string): string {
  const norm = (role || 'AGENT').toUpperCase();
  const area = PERMISSION_AREAS.find((a) => a.key === areaKey);
  if (area && 'adminOnly' in area && area.adminOnly && norm !== 'OWNER' && norm !== 'ADMIN') {
    return 'Admin or Owner only';
  }
  const def = getDefaultPagePermissions(norm)[areaKey];
  if (!def || (!def.read && !def.create && !def.update && !def.delete)) {
    return 'No access';
  }
  if (def.read && def.create && def.update && def.delete) {
    return 'Full access';
  }
  if (def.read && def.create && def.update && !def.delete) {
    return 'View, create, edit';
  }
  if (def.read && !def.create && !def.update && !def.delete) {
    return 'View only';
  }
  const parts: string[] = [];
  if (def.read) parts.push('view');
  if (def.create) parts.push('create');
  if (def.update) parts.push('edit');
  if (def.delete) parts.push('delete');
  return parts.join(', ');
}

export interface PermissionDiff {
  totalChanges: number;
  summaryText: string;
}

export function calculatePermissionDiff(
  current: Record<string, PageCrudPermissions>,
  role: string
): PermissionDiff {
  const defaults = getDefaultPagePermissions(role);
  let totalChanges = 0;
  const footerPhrases: string[] = [];

  PERMISSION_AREAS.forEach((area) => {
    const cur = current[area.key] || { create: false, read: false, update: false, delete: false };
    const def = defaults[area.key] || { create: false, read: false, update: false, delete: false };

    if (cur.read !== def.read) totalChanges++;
    if (cur.create !== def.create) totalChanges++;
    if (cur.update !== def.update) totalChanges++;
    if (cur.delete !== def.delete) totalChanges++;

    const changedActions: string[] = [];
    if (cur.create !== def.create) changedActions.push(cur.create ? 'create' : 'no create');
    if (cur.update !== def.update) changedActions.push(cur.update ? 'edit' : 'no edit');
    if (cur.delete !== def.delete) changedActions.push(cur.delete ? 'delete' : 'no delete');
    if (cur.read !== def.read) changedActions.push(cur.read ? 'view' : 'no view');

    if (changedActions.length > 0) {
      footerPhrases.push(`${area.label} ${changedActions.join(' and ')}`);
    }
  });

  return {
    totalChanges,
    summaryText: footerPhrases.join(', ') || 'No overrides',
  };
}

export function formatJoinedDate(dateStr?: string): string {
  if (!dateStr) return 'Joined recently';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Joined recently';
    const day = d.getDate();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `Joined ${day} ${months[d.getMonth()]} ${d.getFullYear()}`;
  } catch {
    return 'Joined recently';
  }
}

export interface RoleCardConfig {
  role: 'OWNER' | 'ADMIN' | 'AGENT' | 'VIEWER';
  label: string;
  description: string;
  allowedPills: string[];
  deniedPills: string[];
}

export const ROLES_CONFIG: RoleCardConfig[] = [
  {
    role: 'OWNER',
    label: 'Owner',
    description: 'Everything, including billing and deleting the workspace.',
    allowedPills: ['Full workspace control', 'Manage billing & subscription', 'Delete workspace', 'Manage all roles & permissions'],
    deniedPills: [],
  },
  {
    role: 'ADMIN',
    label: 'Admin',
    description: 'Runs the workspace: channels, flows, AI agent, team. Billing is view-only.',
    allowedPills: ['Manage channels & routing', 'Create & edit flows', 'Invite & manage team', 'Configure AI agent', 'Broadcast campaigns', 'Manage contacts'],
    deniedPills: ['View billing only', 'Cannot delete workspace'],
  },
  {
    role: 'AGENT',
    label: 'Agent',
    description: 'Answers customers in their teams and languages. Sees campaigns and reports.',
    allowedPills: ['Reply in assigned and team chats', 'Edit contacts', 'Take over from AI', 'View campaigns'],
    deniedPills: ['No flows', 'No settings', 'No billing'],
  },
  {
    role: 'VIEWER',
    label: 'Viewer',
    description: 'Read-only access to conversations, contacts and reports.',
    allowedPills: ['View conversations', 'View contacts', 'View reports & analytics', 'View campaigns'],
    deniedPills: ['No flows', 'No settings', 'No billing'],
  },
];

export function getMemberPagePermissions(member: TeamMember): Record<string, PageCrudPermissions> {
  const defaults = getDefaultPagePermissions(member.role);
  const stored = (member.customPermissions as any)?.pagePermissions;
  if (!stored || typeof stored !== 'object') {
    return defaults;
  }
  const merged: Record<string, PageCrudPermissions> = { ...defaults };
  [...WORKSPACE_PAGES.map((p) => p.key), ...PERMISSION_AREAS.map((a) => a.key)].forEach((key) => {
    if (stored[key]) {
      merged[key] = {
        create: Boolean(stored[key].create),
        read: Boolean(stored[key].read),
        update: Boolean(stored[key].update),
        delete: Boolean(stored[key].delete),
      };
    }
  });
  return merged;
}

export function hasCustomPagePermissions(member: TeamMember): boolean {
  return Boolean(
    member.customPermissions &&
      typeof member.customPermissions === 'object' &&
      (member.customPermissions as any).pagePermissions
  );
}

export interface TeamMember {
  id: number;
  name: string;
  email: string;
  role: 'OWNER' | 'ADMIN' | 'AGENT' | 'VIEWER' | string;
  teams: string[];
  languages: string[];
  stores?: string[];
  customPermissions?: Record<string, any> | null;
  status: 'active' | 'online' | 'away' | 'invited' | string;
  isOnline?: boolean;
  avatarUrl?: string | null;
  twoFactorEnabled?: boolean;
  createdAt?: string;
}

export interface PendingInvitation {
  id: number;
  email: string;
  name: string | null;
  role: string;
  teams: string[];
  languages: string[];
  stores: string[];
  token: string;
  inviterName: string | null;
  inviterEmail: string | null;
  status: string;
  expiresAt: string;
  createdAt: string;
}

export interface ConnectedStore {
  id: number;
  name: string;
  domain: string;
  status: string;
}

export interface RolePermissionsMatrix {
  OWNER: Record<string, boolean>;
  ADMIN: Record<string, boolean>;
  AGENT: Record<string, boolean>;
  VIEWER: Record<string, boolean>;
}

const PERMISSION_ROWS = [
  { key: 'view_and_reply_chats', label: 'View and reply to chats' },
  { key: 'see_all_chats', label: 'See all chats (not just assigned)' },
  { key: 'send_templates_outside_24h', label: 'Send templates outside 24 h' },
  { key: 'create_and_launch_campaigns', label: 'Create and launch campaigns' },
  { key: 'edit_bots_and_flows', label: 'Edit bots and flows' },
  { key: 'export_contacts_and_consent', label: 'Export contacts and consent log' },
  { key: 'erase_contacts', label: 'Erase contacts' },
  { key: 'manage_billing_and_integrations', label: 'Manage billing and integrations' },
] as const;

const AVAILABLE_TEAMS = ['All', 'Support', 'Sales', 'Wholesale', 'Marketing', 'Billing'];
const AVAILABLE_LANGUAGES = ['EN', 'TA', 'HI', 'TE', 'KN', 'ML', 'ES', 'FR'];

const LANGUAGE_LABELS: Record<string, string> = {
  EN: 'English',
  TA: 'Tamil',
  HI: 'Hindi',
  TE: 'Telugu',
  KN: 'Kannada',
  ML: 'Malayalam',
  ES: 'Spanish',
  FR: 'French',
};

function formatLanguageNames(languages?: string[]): string {
  const list = languages && languages.length > 0 ? languages : ['EN'];
  return list.map((code) => LANGUAGE_LABELS[code.toUpperCase()] || code).join(', ');
}

function formatStoresLabel(memberStores: string[] | undefined, allStores: ConnectedStore[]): string {
  if (!memberStores || memberStores.length === 0 || memberStores.includes('All')) {
    return 'All stores';
  }
  return memberStores
    .map((domain) => allStores.find((s) => s.domain === domain)?.name || domain)
    .join(', ');
}

function joinNaturalList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function formatRolePermissionSummary(
  role: string,
  current: Record<string, PageCrudPermissions>,
  totalChanges: number
): string {
  const roleUpper = (role || 'AGENT').toUpperCase();
  const roleLabel = roleUpper.charAt(0) + roleUpper.slice(1).toLowerCase();

  if (roleUpper === 'OWNER') {
    return 'Everything, including billing and deleting the workspace';
  }

  if (totalChanges === 0) {
    if (roleUpper === 'ADMIN') {
      return 'Runs the workspace: channels, flows, AI agent, team. Billing is view-only';
    }
    if (roleUpper === 'VIEWER') {
      return 'Read-only access to conversations, contacts and reports';
    }
    return 'Answers customers in their teams and languages. Sees campaigns and reports';
  }

  const defaults = getDefaultPagePermissions(roleUpper);
  const addedGroups = new Map<string, string[]>();
  const removedGroups = new Map<string, string[]>();

  PERMISSION_AREAS.forEach((area) => {
    const cur = current[area.key] || { create: false, read: false, update: false, delete: false };
    const def = defaults[area.key] || { create: false, read: false, update: false, delete: false };

    const addedActions: string[] = [];
    const removedActions: string[] = [];

    if (cur.read && !def.read) addedActions.push('view');
    if (cur.create && !def.create) addedActions.push('create');
    if (cur.update && !def.update) addedActions.push('edit');
    if (cur.delete && !def.delete) addedActions.push('delete');

    if (!cur.read && def.read) removedActions.push('view');
    if (!cur.create && def.create) removedActions.push('create');
    if (!cur.update && def.update) removedActions.push('edit');
    if (!cur.delete && def.delete) removedActions.push('delete');

    if (addedActions.length > 0) {
      const actionKey = joinNaturalList(addedActions);
      const existing = addedGroups.get(actionKey) || [];
      addedGroups.set(actionKey, [...existing, area.label]);
    }

    if (removedActions.length > 0) {
      const actionKey = joinNaturalList(removedActions);
      const existing = removedGroups.get(actionKey) || [];
      removedGroups.set(actionKey, [...existing, area.label]);
    }
  });

  const parts: string[] = [];
  if (addedGroups.size > 0) {
    const addedPhrases = Array.from(addedGroups.entries()).map(
      ([actions, areas]) => `${actions} ${joinNaturalList(areas)}`
    );
    parts.push(`plus ${joinNaturalList(addedPhrases)}`);
  }
  if (removedGroups.size > 0) {
    const removedPhrases = Array.from(removedGroups.entries()).map(
      ([actions, areas]) => `${actions} ${joinNaturalList(areas)}`
    );
    parts.push(`without ${joinNaturalList(removedPhrases)}`);
  }

  return `${roleLabel} defaults, ${parts.join(', ')}`;
}

function getInitials(name: string) {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getAvatarColor(name: string) {
  const colors = [
    'bg-emerald-600 text-white',
    'bg-indigo-100 text-indigo-700',
    'bg-rose-600 text-white',
    'bg-amber-500 text-white',
    'bg-sky-600 text-white',
    'bg-purple-600 text-white',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

interface PagePermissionsMatrixProps {
  member: TeamMember;
  permissions: Record<string, PageCrudPermissions>;
  onChange: (updated: Record<string, PageCrudPermissions>) => void;
  onSave: () => void;
  onClose: () => void;
  isSaving: boolean;
  canManage: boolean;
  isModal?: boolean;
}

export const PagePermissionsMatrix: React.FC<PagePermissionsMatrixProps> = ({
  member,
  permissions,
  onChange,
  onSave,
  onClose,
  isSaving,
  canManage,
  isModal = false,
}) => {
  const { dbUser } = useAuth();
  const roleUpper = (member.role || 'AGENT').toUpperCase();
  const isTargetOwner = roleUpper === 'OWNER';
  const isTargetAdmin = roleUpper === 'ADMIN';

  const actorRole = (dbUser?.role || 'AGENT').toUpperCase();
  const isActorOwner = actorRole === 'OWNER';
  const isActorAdmin = actorRole === 'ADMIN';
  const isSelf = Boolean(
    dbUser && (member.id === dbUser.id || (member.email && dbUser.email && member.email.toLowerCase() === dbUser.email.toLowerCase()))
  );

  const isTargetAgentOrViewer = roleUpper === 'AGENT' || roleUpper === 'VIEWER';

  // Permission edit rules:
  // - Owner can edit CRUD permissions for all members
  // - Admin can edit custom CRUD permissions for Agent and Viewer roles
  const canEdit = isActorOwner || (isActorAdmin && isTargetAgentOrViewer);
  const isPermissionsLocked = !canEdit;

  const effectivePermissions = permissions;

  const toggleCell = (pageKey: string, action: keyof PageCrudPermissions) => {
    if (!canEdit || isSaving) return;
    const current = effectivePermissions[pageKey] || { create: false, read: false, update: false, delete: false };
    onChange({
      ...effectivePermissions,
      [pageKey]: {
        ...current,
        [action]: !current[action],
      },
    });
  };

  const toggleAllForPage = (pageKey: string) => {
    if (!canEdit || isSaving) return;
    const current = effectivePermissions[pageKey] || { create: false, read: false, update: false, delete: false };
    const allChecked = current.create && current.read && current.update && current.delete;
    const nextVal = !allChecked;
    onChange({
      ...effectivePermissions,
      [pageKey]: { create: nextVal, read: nextVal, update: nextVal, delete: nextVal },
    });
  };

  const toggleAllForAction = (action: keyof PageCrudPermissions) => {
    if (!canEdit || isSaving) return;
    const allChecked = WORKSPACE_PAGES.every((p) => effectivePermissions[p.key]?.[action]);
    const nextVal = !allChecked;
    const updated = { ...effectivePermissions };
    WORKSPACE_PAGES.forEach((p) => {
      updated[p.key] = {
        ...(updated[p.key] || { create: false, read: false, update: false, delete: false }),
        [action]: nextVal,
      };
    });
    onChange(updated);
  };

  const applyPreset = (preset: 'all' | 'readOnly' | 'defaults' | 'clear') => {
    if (!canEdit || isSaving) return;
    if (preset === 'defaults') {
      onChange(getDefaultPagePermissions(member.role));
      return;
    }
    const updated: Record<string, PageCrudPermissions> = {};
    WORKSPACE_PAGES.forEach((p) => {
      if (preset === 'all') {
        updated[p.key] = { create: true, read: true, update: true, delete: true };
      } else if (preset === 'readOnly') {
        updated[p.key] = { create: false, read: true, update: false, delete: false };
      } else if (preset === 'clear') {
        updated[p.key] = { create: false, read: false, update: false, delete: false };
      }
    });
    onChange(updated);
  };

  const countGranted = useMemo(() => {
    let count = 0;
    WORKSPACE_PAGES.forEach((p) => {
      const perm = effectivePermissions[p.key];
      if (perm?.create) count++;
      if (perm?.read) count++;
      if (perm?.update) count++;
      if (perm?.delete) count++;
    });
    return count;
  }, [effectivePermissions]);

  const totalPossible = WORKSPACE_PAGES.length * 4;

  const isAllCreate = WORKSPACE_PAGES.every((p) => effectivePermissions[p.key]?.create);
  const isAllRead = WORKSPACE_PAGES.every((p) => effectivePermissions[p.key]?.read);
  const isAllUpdate = WORKSPACE_PAGES.every((p) => effectivePermissions[p.key]?.update);
  const isAllDelete = WORKSPACE_PAGES.every((p) => effectivePermissions[p.key]?.delete);

  return (
    <div className="space-y-3 w-full max-w-full">
      {/* Top Banner & Presets */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5 border-b border-slate-200 w-full">
        <div className="min-w-0 flex-1">
          <div className="flex items-center flex-wrap gap-1.5 sm:gap-2">
            <span className="font-bold text-slate-900 text-sm">
              Page Permissions: <span className="text-[#1e2a78]">{member.name}</span>
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-[#eef0fb] text-[#1e2a78] uppercase">
              {roleUpper}
            </span>
            {isPermissionsLocked && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-amber-100 text-amber-900 border border-amber-200">
                <Lock className="w-3 h-3 text-amber-700" />
                Locked
              </span>
            )}
            {!isPermissionsLocked && hasCustomPagePermissions(member) && (
              <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-purple-100 text-purple-700">
                Custom Overrides Active
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {isPermissionsLocked
              ? 'Page permissions are in read-only mode. Only Workspace Owners can edit member roles and CRUD permissions.'
              : 'Configure individual Create, Read, Update, and Delete permissions across all pages for this user.'}
          </p>
        </div>

        {/* Preset Toolbar */}
        {canManage && (
          canEdit ? (
            <div className="flex items-center flex-wrap gap-1 shrink-0">
              <button
                type="button"
                onClick={() => applyPreset('all')}
                className="px-2 py-1 text-[11px] font-semibold bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg cursor-pointer transition-colors shadow-2xs shrink-0"
              >
                Grant All
              </button>
              <button
                type="button"
                onClick={() => applyPreset('readOnly')}
                className="px-2 py-1 text-[11px] font-semibold bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg cursor-pointer transition-colors shadow-2xs shrink-0"
              >
                Read Only
              </button>
              <button
                type="button"
                onClick={() => applyPreset('defaults')}
                className="px-2 py-1 text-[11px] font-semibold bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg cursor-pointer transition-colors shadow-2xs flex items-center gap-1 shrink-0"
              >
                <RotateCcw className="w-3 h-3 text-slate-500" />
                Role Defaults
              </button>
              <button
                type="button"
                onClick={() => applyPreset('clear')}
                className="px-2 py-1 text-[11px] font-semibold bg-white border border-slate-200 hover:border-red-200 hover:bg-red-50 text-slate-600 hover:text-red-600 rounded-lg cursor-pointer transition-colors shadow-2xs shrink-0"
              >
                Clear All
              </button>
            </div>
          ) : (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-600 shadow-2xs shrink-0">
              <Lock className="w-3.5 h-3.5 text-slate-500 stroke-[2.2]" />
              <span>Permissions Locked</span>
            </div>
          )
        )}
      </div>

      {isPermissionsLocked && (
        <div className="p-2.5 sm:p-3 bg-amber-50/90 border border-amber-200/90 rounded-xl flex items-start gap-2.5 text-xs text-amber-900 shadow-2xs">
          <div className="w-6 h-6 rounded-lg bg-amber-100 border border-amber-200 flex items-center justify-center shrink-0 text-amber-700 mt-0.5">
            <Lock className="w-3.5 h-3.5 stroke-[2.5]" />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-amber-950 flex items-center gap-1.5">
              <span>Page Permissions · Read-Only Mode</span>
              <span className="px-1.5 py-0.5 bg-amber-200/70 text-amber-900 rounded text-[10px] uppercase font-bold tracking-wider">
                Locked
              </span>
            </p>
            <p className="text-amber-800/90 mt-0.5 leading-relaxed">
              Only users logged in as <strong>Workspace Owner</strong> have permission to edit member roles and customize CRUD page permissions.
            </p>
          </div>
        </div>
      )}

      {/* Pages CRUD Matrix Table */}
      <div className="border border-slate-200 rounded-xl bg-white shadow-2xs overflow-hidden w-full max-w-full">
        <div className="max-h-[340px] sm:max-h-[420px] overflow-y-auto">
          <table className="w-full text-left text-xs border-collapse table-auto">
            <thead className="sticky top-0 bg-slate-50 z-10 shadow-2xs">
              <tr className="border-b border-slate-200 bg-slate-50 text-[10.5px] font-bold text-slate-600 uppercase tracking-wider">
              <th className="py-2 px-3 font-semibold">Page / Module</th>
              
              {/* CREATE Column */}
              <th className="py-2 px-1 text-center font-semibold w-12 sm:w-16">
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-slate-700 font-bold text-[10px] sm:text-[11px]">CREATE</span>
                  {canManage && (
                    <label className={`inline-flex items-center ${canEdit ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`} title={canEdit ? "Toggle all Create permissions" : "Permissions locked"}>
                      <input
                        type="checkbox"
                        checked={isAllCreate}
                        disabled={!canEdit || isSaving}
                        onChange={() => toggleAllForAction('create')}
                        className="w-3.5 h-3.5 rounded text-[#1e2a78] border-slate-300 focus:ring-[#1e2a78] cursor-pointer disabled:cursor-not-allowed"
                      />
                    </label>
                  )}
                </div>
              </th>

              {/* READ Column */}
              <th className="py-2 px-1 text-center font-semibold w-12 sm:w-16">
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-slate-700 font-bold text-[10px] sm:text-[11px]">READ</span>
                  {canManage && (
                    <label className={`inline-flex items-center ${canEdit ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`} title={canEdit ? "Toggle all Read permissions" : "Permissions locked"}>
                      <input
                        type="checkbox"
                        checked={isAllRead}
                        disabled={!canEdit || isSaving}
                        onChange={() => toggleAllForAction('read')}
                        className="w-3.5 h-3.5 rounded text-[#1e2a78] border-slate-300 focus:ring-[#1e2a78] cursor-pointer disabled:cursor-not-allowed"
                      />
                    </label>
                  )}
                </div>
              </th>

              {/* UPDATE Column */}
              <th className="py-2 px-1 text-center font-semibold w-12 sm:w-16">
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-slate-700 font-bold text-[10px] sm:text-[11px]">UPDATE</span>
                  {canManage && (
                    <label className={`inline-flex items-center ${canEdit ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`} title={canEdit ? "Toggle all Update permissions" : "Permissions locked"}>
                      <input
                        type="checkbox"
                        checked={isAllUpdate}
                        disabled={!canEdit || isSaving}
                        onChange={() => toggleAllForAction('update')}
                        className="w-3.5 h-3.5 rounded text-[#1e2a78] border-slate-300 focus:ring-[#1e2a78] cursor-pointer disabled:cursor-not-allowed"
                      />
                    </label>
                  )}
                </div>
              </th>

              {/* DELETE Column */}
              <th className="py-2 px-1 text-center font-semibold w-12 sm:w-16">
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-slate-700 font-bold text-[10px] sm:text-[11px]">DELETE</span>
                  {canManage && (
                    <label className={`inline-flex items-center ${canEdit ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`} title={canEdit ? "Toggle all Delete permissions" : "Permissions locked"}>
                      <input
                        type="checkbox"
                        checked={isAllDelete}
                        disabled={!canEdit || isSaving}
                        onChange={() => toggleAllForAction('delete')}
                        className="w-3.5 h-3.5 rounded text-[#1e2a78] border-slate-300 focus:ring-[#1e2a78] cursor-pointer disabled:cursor-not-allowed"
                      />
                    </label>
                  )}
                </div>
              </th>

              {/* Row Toggle */}
              <th className="py-2 px-2 text-center font-semibold text-slate-500 w-12 sm:w-14 text-[10px] sm:text-[11px]">Row</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {WORKSPACE_PAGES.map((page) => {
              const Icon = page.icon;
              const perm = effectivePermissions[page.key] || { create: false, read: false, update: false, delete: false };
              const isRowAll = perm.create && perm.read && perm.update && perm.delete;
              const isRowNone = !perm.create && !perm.read && !perm.update && !perm.delete;

              return (
                <tr key={page.key} className="hover:bg-slate-50/80 transition-colors">
                  {/* Page / Module info */}
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-indigo-50/80 border border-indigo-100 flex items-center justify-center shrink-0 text-[#1e2a78]">
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-slate-900 text-xs truncate">{page.label}</span>
                          <span className="text-[9.5px] px-1 py-0.2 rounded bg-slate-100 text-slate-500 font-medium">
                            {page.category}
                          </span>
                        </div>
                        <p className="text-[10.5px] text-slate-400 truncate max-w-[200px] sm:max-w-xs">{page.description}</p>
                      </div>
                    </div>
                  </td>

                  {/* Create Checkbox */}
                  <td className="py-2 px-1 text-center">
                    <label className={`inline-flex items-center justify-center p-0.5 ${canEdit ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                      <input
                        type="checkbox"
                        checked={Boolean(perm.create)}
                        disabled={!canEdit || isSaving}
                        onChange={() => toggleCell(page.key, 'create')}
                        className="w-3.5 h-3.5 rounded text-[#1e2a78] border-slate-300 focus:ring-[#1e2a78] cursor-pointer disabled:cursor-not-allowed disabled:opacity-80"
                      />
                    </label>
                  </td>

                  {/* Read Checkbox */}
                  <td className="py-2 px-1 text-center">
                    <label className={`inline-flex items-center justify-center p-0.5 ${canEdit ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                      <input
                        type="checkbox"
                        checked={Boolean(perm.read)}
                        disabled={!canEdit || isSaving}
                        onChange={() => toggleCell(page.key, 'read')}
                        className="w-3.5 h-3.5 rounded text-[#1e2a78] border-slate-300 focus:ring-[#1e2a78] cursor-pointer disabled:cursor-not-allowed disabled:opacity-80"
                      />
                    </label>
                  </td>

                  {/* Update Checkbox */}
                  <td className="py-2 px-1 text-center">
                    <label className={`inline-flex items-center justify-center p-0.5 ${canEdit ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                      <input
                        type="checkbox"
                        checked={Boolean(perm.update)}
                        disabled={!canEdit || isSaving}
                        onChange={() => toggleCell(page.key, 'update')}
                        className="w-3.5 h-3.5 rounded text-[#1e2a78] border-slate-300 focus:ring-[#1e2a78] cursor-pointer disabled:cursor-not-allowed disabled:opacity-80"
                      />
                    </label>
                  </td>

                  {/* Delete Checkbox */}
                  <td className="py-2 px-1 text-center">
                    <label className={`inline-flex items-center justify-center p-0.5 ${canEdit ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                      <input
                        type="checkbox"
                        checked={Boolean(perm.delete)}
                        disabled={!canEdit || isSaving}
                        onChange={() => toggleCell(page.key, 'delete')}
                        className="w-3.5 h-3.5 rounded text-[#1e2a78] border-slate-300 focus:ring-[#1e2a78] cursor-pointer disabled:cursor-not-allowed disabled:opacity-80"
                      />
                    </label>
                  </td>

                  {/* Row toggle button */}
                  <td className="py-2 px-2 text-center">
                    {canManage && (
                      canEdit ? (
                        <button
                          type="button"
                          onClick={() => toggleAllForPage(page.key)}
                          disabled={isSaving}
                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded transition-colors cursor-pointer ${
                            isRowAll
                              ? 'bg-indigo-50 text-[#1e2a78] hover:bg-indigo-100'
                              : isRowNone
                                ? 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                          title="Toggle all CRUD permissions for this page"
                        >
                          {isRowAll ? 'All ✓' : isRowNone ? 'None' : 'Mixed'}
                        </button>
                      ) : (
                        <span
                          className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 inline-flex items-center gap-0.5 cursor-not-allowed"
                          title="Permissions locked"
                        >
                          <Lock className="w-2.5 h-2.5 text-slate-400" />
                          {isRowAll ? 'All ✓' : isRowNone ? 'None' : 'Mixed'}
                        </span>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      {/* Action Footer Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-1 w-full">
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] sm:text-xs text-slate-500 font-medium">
            <strong>{countGranted}</strong> of <strong>{totalPossible}</strong> permissions granted
          </span>
          <div className="w-20 sm:w-24 bg-slate-200 h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-[#1e2a78] h-full rounded-full transition-all duration-300"
              style={{ width: `${Math.round((countGranted / totalPossible) * 100)}%` }}
            />
          </div>
        </div>

        <div className="flex items-center gap-2 justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg cursor-pointer transition-colors"
          >
            {isModal ? 'Close' : 'Collapse'}
          </button>

          {canEdit && (
            <button
              type="button"
              onClick={onSave}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#1e2a78] hover:bg-[#16205e] disabled:opacity-50 text-white text-xs font-semibold cursor-pointer shadow-sm transition-all shrink-0"
            >
              {isSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5 stroke-[2.5]" />
              )}
              Save permissions
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export const TeamRolesSection: React.FC = () => {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);
  const [stores, setStores] = useState<ConnectedStore[]>([]);
  const [seats, setSeats] = useState<{ used: number; total: number; plan: string; available?: number }>({
    used: 1,
    total: 10,
    plan: 'Growth',
    available: 9,
  });
  const [currentRole, setCurrentRole] = useState<string>('ADMIN');
  const [isLoading, setIsLoading] = useState(true);
  const [trial, setTrial] = useState<WorkspaceTrial | null>(null);

  // Tabs & filters state
  const [activeTab, setActiveTab] = useState<'members' | 'invitations'>('members');
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');

  // Modals state
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isUpgradeOpen, setIsUpgradeOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isEditReadOnly, setIsEditReadOnly] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);

  // Multi-email invite form state
  const [emailInput, setEmailInput] = useState('');
  const [emailChips, setEmailChips] = useState<string[]>([]);
  const [inviteRole, setInviteRole] = useState<'OWNER' | 'ADMIN' | 'AGENT' | 'VIEWER'>('AGENT');
  const [useCustomPermissions, setUseCustomPermissions] = useState(false);
  const [customPermissions, setCustomPermissions] = useState<Record<string, boolean>>({
    view_and_reply_chats: true,
    see_all_chats: false,
    send_templates_outside_24h: true,
    create_and_launch_campaigns: false,
    edit_bots_and_flows: false,
    export_contacts_and_consent: false,
    erase_contacts: false,
    manage_billing_and_integrations: false,
  });
  const [inviteStores, setInviteStores] = useState<string[]>(['All']);
  const [inviteTeams, setInviteTeams] = useState<string[]>(['Support']);
  const [inviteLanguages, setInviteLanguages] = useState<string[]>(['EN']);
  const [isSubmittingInvite, setIsSubmittingInvite] = useState(false);
  const [createdInvitesPreview, setCreatedInvitesPreview] = useState<Array<{ email: string; inviteUrl: string; emailSent: boolean }> | null>(null);

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<string>('AGENT');
  const [editTeams, setEditTeams] = useState<string[]>([]);
  const [editLanguages, setEditLanguages] = useState<string[]>([]);
  const [editStores, setEditStores] = useState<string[]>([]);
  const [editStatus, setEditStatus] = useState<string>('active');
  const [editTab, setEditTab] = useState<'role' | 'permissions'>('role');
  const [editPermissions, setEditPermissions] = useState<Record<string, PageCrudPermissions>>({});
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);

  // Upgrading state
  const [isUpgrading, setIsUpgrading] = useState(false);

  // Role overview ("What each role can do") & Role defaults page state
  const [orgPermissions, setOrgPermissions] = useState<Record<string, any> | null>(null);
  const [roleOverviewDefaults, setRoleOverviewDefaults] = useState<EditableRoleDefaultsMap>(() => getInitialRoleOverviewDefaults());
  const [roleCrudDefaults, setRoleCrudDefaults] = useState<RoleCrudDefaultsMap>(() => getInitialRoleCrudDefaults());
  const [roleDescriptions, setRoleDescriptions] = useState<RoleDescriptionsMap>(() => getInitialRoleDescriptions());
  const [isEditDefaultsOpen, setIsEditDefaultsOpen] = useState(false);
  const [selectedDefaultsRole, setSelectedDefaultsRole] = useState<RoleKey>('AGENT');
  const [draftRoleCrudDefaults, setDraftRoleCrudDefaults] = useState<RoleCrudDefaultsMap>(() => getInitialRoleCrudDefaults());
  const [draftRoleDescriptions, setDraftRoleDescriptions] = useState<RoleDescriptionsMap>(() => getInitialRoleDescriptions());
  const [isSavingRoleDefaults, setIsSavingRoleDefaults] = useState(false);

  const fetchTeamData = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await apiClient.get('/api/team');
      if (res.data?.success) {
        setMembers(res.data.members || []);
        if (res.data.pendingInvitations) setPendingInvitations(res.data.pendingInvitations);
        if (res.data.stores) setStores(res.data.stores);
        if (res.data.seats) setSeats(res.data.seats);
        if (res.data.trial) setTrial(res.data.trial);
        if (res.data.currentRole) setCurrentRole(res.data.currentRole);
        if (res.data.permissions) {
          setOrgPermissions(res.data.permissions);
          if (res.data.permissions.pageDefaults) {
            const base = getInitialRoleOverviewDefaults();
            const saved = res.data.permissions.pageDefaults as EditableRoleDefaultsMap;
            const merged: EditableRoleDefaultsMap = {};
            Object.keys(base).forEach((k) => {
              merged[k] = {
                ADMIN: saved[k]?.ADMIN || base[k].ADMIN,
                AGENT: saved[k]?.AGENT || base[k].AGENT,
                VIEWER: saved[k]?.VIEWER || base[k].VIEWER,
              };
            });
            setRoleOverviewDefaults(merged);
          }
          if (res.data.permissions.roleCrudDefaults) {
            const baseCrud = getInitialRoleCrudDefaults();
            const savedCrud = res.data.permissions.roleCrudDefaults as Partial<RoleCrudDefaultsMap>;
            const mergedCrud: RoleCrudDefaultsMap = {
              OWNER: baseCrud.OWNER,
              ADMIN: { ...baseCrud.ADMIN, ...(savedCrud.ADMIN || {}) },
              AGENT: { ...baseCrud.AGENT, ...(savedCrud.AGENT || {}) },
              VIEWER: { ...baseCrud.VIEWER, ...(savedCrud.VIEWER || {}) },
            };
            setRoleCrudDefaults(mergedCrud);
          }
          if (res.data.permissions.roleDescriptions) {
            setRoleDescriptions({
              ...getInitialRoleDescriptions(),
              ...res.data.permissions.roleDescriptions,
            });
          }
        }
      }
    } catch (err: any) {
      gooeyToast.error('Failed to load team and roles', { description: err.message });
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleOpenEditDefaults = () => {
    const crudCopy: RoleCrudDefaultsMap = { OWNER: {}, ADMIN: {}, AGENT: {}, VIEWER: {} };
    (['OWNER', 'ADMIN', 'AGENT', 'VIEWER'] as RoleKey[]).forEach((r) => {
      ROLE_OVERVIEW_AREAS.forEach((a) => {
        const cur = roleCrudDefaults[r]?.[a.key] || accessLevelToCrud(a.defaults[r]);
        crudCopy[r][a.key] = { ...cur };
      });
    });
    setDraftRoleCrudDefaults(crudCopy);
    setDraftRoleDescriptions({ ...roleDescriptions });
    setSelectedDefaultsRole('AGENT');
    setIsEditDefaultsOpen(true);
  };

  const handleSaveRoleDefaults = async () => {
    try {
      setIsSavingRoleDefaults(true);
      const nextPageDefaults: EditableRoleDefaultsMap = {};
      ROLE_OVERVIEW_AREAS.forEach((area) => {
        nextPageDefaults[area.key] = {
          ADMIN: crudToAccessLevel(draftRoleCrudDefaults.ADMIN[area.key] || accessLevelToCrud(area.defaults.ADMIN)),
          AGENT: crudToAccessLevel(draftRoleCrudDefaults.AGENT[area.key] || accessLevelToCrud(area.defaults.AGENT)),
          VIEWER: crudToAccessLevel(draftRoleCrudDefaults.VIEWER[area.key] || accessLevelToCrud(area.defaults.VIEWER)),
        };
      });

      const payload = {
        ...(orgPermissions || {}),
        pageDefaults: nextPageDefaults,
        roleCrudDefaults: draftRoleCrudDefaults,
        roleDescriptions: draftRoleDescriptions,
      };
      const res = await apiClient.patch('/api/team/permissions', { permissions: payload });
      if (res.data?.success) {
        setRoleOverviewDefaults(nextPageDefaults);
        setRoleCrudDefaults(draftRoleCrudDefaults);
        setRoleDescriptions(draftRoleDescriptions);
        if (res.data.permissions) setOrgPermissions(res.data.permissions);
        setIsEditDefaultsOpen(false);
        gooeyToast.success('Role defaults updated');
      }
    } catch (err: any) {
      gooeyToast.error('Failed to update role defaults', {
        description: err.response?.data?.message || err.message,
      });
    } finally {
      setIsSavingRoleDefaults(false);
    }
  };

  const handleResetSelectedRoleDefaults = () => {
    const initialCrud = getInitialRoleCrudDefaults();
    const initialDesc = getInitialRoleDescriptions();
    setDraftRoleCrudDefaults((prev) => ({
      ...prev,
      [selectedDefaultsRole]: initialCrud[selectedDefaultsRole],
    }));
    setDraftRoleDescriptions((prev) => ({
      ...prev,
      [selectedDefaultsRole]: initialDesc[selectedDefaultsRole],
    }));
  };

  useEffect(() => {
    fetchTeamData();
  }, [fetchTeamData]);

  const { hasPermission, dbUser, refreshDbUser, can } = useAuth();
  const canManageBilling = hasPermission('manage_billing_and_integrations');

  const actorRoleUpper = (dbUser?.role || currentRole || '').toUpperCase();
  const isActorOwner = actorRoleUpper === 'OWNER';
  const isActorAdmin = actorRoleUpper === 'ADMIN';

  const canManage = useMemo(() => {
    return isActorOwner || isActorAdmin;
  }, [isActorOwner, isActorAdmin]);

  const canCreateMember = canManage && can('settings', 'create');
  const canUpdateMember = canManage && can('settings', 'update');
  const canDeleteMember = canManage && can('settings', 'delete');

  // Seat metrics
  const availableSeats = Math.max(0, seats.total - seats.used);
  const isSeatLimitReached = seats.used >= seats.total;
  const seatsPercentage = Math.min(100, Math.round((seats.used / Math.max(1, seats.total)) * 100));

  // Email chip helpers
  const addEmailChip = (val: string) => {
    const trimmed = val.trim().toLowerCase();
    if (trimmed && trimmed.includes('@') && !emailChips.includes(trimmed)) {
      setEmailChips((prev) => [...prev, trimmed]);
      setEmailInput('');
    }
  };

  const removeEmailChip = (email: string) => {
    setEmailChips((prev) => prev.filter((e) => e !== email));
  };

  const handleEmailKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (['Enter', ',', ' ', ';'].includes(e.key)) {
      e.preventDefault();
      addEmailChip(emailInput);
    } else if (e.key === 'Backspace' && !emailInput && emailChips.length > 0) {
      setEmailChips((prev) => prev.slice(0, -1));
    }
  };

  const handleEmailPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text');
    const parts = pasted.split(/[\s,;]+/).filter((p) => p && p.includes('@'));
    if (parts.length > 0) {
      setEmailChips((prev) => Array.from(new Set([...prev, ...parts.map((p) => p.toLowerCase().trim())])));
      setEmailInput('');
    }
  };

  // Submit Invitations
  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // If there is text in input, add it first
    let allEmails = [...emailChips];
    if (emailInput.trim() && emailInput.includes('@')) {
      allEmails = Array.from(new Set([...allEmails, emailInput.trim().toLowerCase()]));
      setEmailChips(allEmails);
      setEmailInput('');
    }

    if (allEmails.length === 0) {
      gooeyToast.error('Please enter at least one valid work email.');
      return;
    }

    if (seats.used + allEmails.length > seats.total) {
      gooeyToast.error('Seat limit exceeded', {
        description: `Inviting ${allEmails.length} member(s) would exceed your ${seats.total} seats limit. Please upgrade your plan.`,
      });
      setIsUpgradeOpen(true);
      return;
    }

    try {
      setIsSubmittingInvite(true);
      const clientOrigin =
        window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
          ? 'https://cure-thriving-bobbing.ngrok-free.dev'
          : window.location.origin;

      const res = await apiClient.post('/api/team', {
        emails: allEmails,
        role: inviteRole,
        customPermissions: useCustomPermissions ? customPermissions : null,
        stores: inviteStores,
        teams: inviteTeams,
        languages: inviteLanguages,
        originUrl: clientOrigin,
      });

      if (res.data?.success) {
        gooeyToast.success(res.data.message || 'Invitations sent!');
        if (res.data.invitations && res.data.invitations.length > 0) {
          setCreatedInvitesPreview(res.data.invitations);
        } else {
          setIsInviteOpen(false);
          resetInviteForm();
        }
        fetchTeamData();
      }
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message;
      gooeyToast.error('Failed to send invitations', { description: msg });
      if (err.response?.status === 409 && msg.includes('upgrade')) {
        setIsUpgradeOpen(true);
      }
    } finally {
      setIsSubmittingInvite(false);
    }
  };

  const resetInviteForm = () => {
    setEmailChips([]);
    setEmailInput('');
    setInviteRole('AGENT');
    setUseCustomPermissions(false);
    setInviteStores(['All']);
    setInviteTeams(['Support']);
    setInviteLanguages(['EN']);
    setCreatedInvitesPreview(null);
  };

  // Resend invitation
  const handleResendInvite = async (invitationId: number, email: string) => {
    try {
      const clientOrigin =
        window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
          ? 'https://cure-thriving-bobbing.ngrok-free.dev'
          : window.location.origin;

      const res = await apiClient.post('/api/invitations/resend', {
        invitationId,
        email,
        originUrl: clientOrigin,
      });
      if (res.data?.success) {
        gooeyToast.success(`Invitation resent to ${email}`);
        if (res.data.invitation?.inviteUrl) {
          navigator.clipboard.writeText(res.data.invitation.inviteUrl);
          gooeyToast.info('Invitation link copied to clipboard!');
        }
        fetchTeamData();
      }
    } catch (err: any) {
      gooeyToast.error('Failed to resend invitation', { description: err.response?.data?.message || err.message });
    }
  };

  // Revoke invitation
  const handleRevokeInvite = async (invitationId: number, email: string) => {
    if (!confirm(`Are you sure you want to revoke the invitation for ${email}?`)) return;
    try {
      const res = await apiClient.delete(`/api/invitations/revoke/${invitationId}`);
      if (res.data?.success) {
        gooeyToast.success(`Invitation for ${email} revoked`);
        fetchTeamData();
      }
    } catch (err: any) {
      gooeyToast.error('Failed to revoke invitation', { description: err.response?.data?.message || err.message });
    }
  };

  // Copy single-use invite link
  const handleCopyInviteLink = (token: string, email: string) => {
    const url = `https://cure-thriving-bobbing.ngrok-free.dev/invite/${token}`;
    navigator.clipboard.writeText(url);
    gooeyToast.success(`Invitation link for ${email} copied!`, {
      description: 'Single-use secure link (expires in 7 days).',
    });
  };

  // Handle plan upgrade
  const handleUpgradePlan = async (plan: string) => {
    if (!canManageBilling) {
      gooeyToast.error('You do not have permission to manage billing or upgrade plans.');
      return;
    }
    try {
      setIsUpgrading(true);
      const res = await apiClient.post('/api/team/upgrade', { plan });
      if (res.data?.success) {
        gooeyToast.success(`Successfully upgraded to ${res.data.plan} plan!`, {
          description: `You now have ${res.data.maxSeats} total seats.`,
        });
        setIsUpgradeOpen(false);
        fetchTeamData();
      }
    } catch (err: any) {
      gooeyToast.error('Failed to upgrade plan', { description: err.message });
    } finally {
      setIsUpgrading(false);
    }
  };

  // Open edit or view modal for member
  const handleOpenEdit = (member: TeamMember, readOnly = false) => {
    setEditingMember(member);
    setEditName(member.name);
    setEditRole(member.role);
    setEditTeams(member.teams && member.teams.length > 0 ? member.teams : ['Support']);
    setEditLanguages(member.languages && member.languages.length > 0 ? member.languages : ['EN']);
    setEditStores(member.stores || []);
    setEditStatus(member.status || 'active');
    setEditTab('role');
    setEditPermissions(getMemberPagePermissions(member));
    setIsEditReadOnly(readOnly);
    setIsEditOpen(true);
  };

  // Handle saving edited member
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMember || isEditReadOnly) return;

    try {
      setIsSubmittingEdit(true);
      const existingCustom = (editingMember.customPermissions as Record<string, any>) || {};
      const updatedCustom = {
        ...existingCustom,
        pagePermissions: editPermissions,
      };

      const res = await apiClient.patch(`/api/team/${editingMember.id}`, {
        name: editName.trim(),
        role: editRole,
        teams: editTeams,
        languages: editLanguages,
        stores: editStores,
        status: editStatus,
        customPermissions: updatedCustom,
      });

      if (res.data?.success) {
        gooeyToast.success(`Updated ${editingMember.name}`);
        if (dbUser && (editingMember.id === dbUser.id || editingMember.email === dbUser.email)) {
          refreshDbUser();
        }
        setIsEditOpen(false);
        setEditingMember(null);
        fetchTeamData();
      }
    } catch (err: any) {
      gooeyToast.error('Failed to update member', { description: err.response?.data?.message || err.message });
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  const editDiff = useMemo(() => {
    return calculatePermissionDiff(editPermissions, editRole);
  }, [editPermissions, editRole]);

  const currentRoleConfig = useMemo(() => {
    return (
      ROLES_CONFIG.find((rc) => rc.role === editRole.toUpperCase()) ||
      ROLES_CONFIG[2]
    );
  }, [editRole]);

  const firstName = useMemo(() => {
    return editingMember?.name ? editingMember.name.trim().split(/\s+/)[0] : 'Member';
  }, [editingMember]);

  const isEditingMemberOwner = editingMember?.role?.toUpperCase() === 'OWNER';
  const isEditingSelf = Boolean(
    dbUser && editingMember && (editingMember.id === dbUser.id || (editingMember.email && dbUser.email && editingMember.email.toLowerCase() === dbUser.email.toLowerCase()))
  );

  const ownerCount = useMemo(
    () => members.filter((m) => (m.role || '').toUpperCase() === 'OWNER').length,
    [members]
  );

  // Handle removing a member
  const handleDeleteMember = async (member: TeamMember) => {
    const isTargetOwner = (member.role || '').toUpperCase() === 'OWNER';
    if (isTargetOwner && ownerCount <= 1) {
      gooeyToast.error('Cannot remove the only Owner', {
        description: 'At least one Owner is required per workspace.',
      });
      return;
    }

    if (!confirm(`Are you sure you want to remove ${member.name} from the workspace?`)) return;

    try {
      const res = await apiClient.delete(`/api/team/${member.id}`);
      if (res.data?.success) {
        gooeyToast.success(`${member.name} has been removed`);
        fetchTeamData();
      }
    } catch (err: any) {
      gooeyToast.error('Failed to remove member', { description: err.response?.data?.message || err.message });
    }
  };

  const filteredMembers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return members.filter((member) => {
      const roleNormalized = (member.role || 'AGENT').toUpperCase();
      if (roleFilter !== 'ALL' && roleNormalized !== roleFilter) return false;
      if (!q) return true;
      return (
        (member.name || '').toLowerCase().includes(q) ||
        (member.email || '').toLowerCase().includes(q)
      );
    });
  }, [members, searchQuery, roleFilter]);

  const filteredInvitations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return pendingInvitations.filter((inv) => {
      const roleNormalized = (inv.role || 'AGENT').toUpperCase();
      if (roleFilter !== 'ALL' && roleNormalized !== roleFilter) return false;
      if (!q) return true;
      return (
        (inv.email || '').toLowerCase().includes(q) ||
        (inv.name || '').toLowerCase().includes(q)
      );
    });
  }, [pendingInvitations, searchQuery, roleFilter]);

  const isAgentOrViewer = actorRoleUpper === 'AGENT' || actorRoleUpper === 'VIEWER';

  if (isAgentOrViewer) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center px-4">
        <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-600 shadow-2xs">
          <Lock className="w-6 h-6 stroke-[2]" />
        </div>
        <div>
          <p className="text-base font-bold text-slate-900">Team & roles access restricted</p>
          <p className="text-xs text-slate-500 mt-1 max-w-sm leading-relaxed">
            Your role does not have permission to view or manage workspace team members and roles. Contact your workspace administrator or owner to request access.
          </p>
        </div>
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 text-slate-600 text-[11px] font-semibold">
          <Shield className="w-3.5 h-3.5 text-amber-500" />
          Permission required: Workspace Administrator or Owner
        </div>
      </div>
    );
  }

  if (isEditDefaultsOpen) {
    const roleLabel = selectedDefaultsRole.charAt(0) + selectedDefaultsRole.slice(1).toLowerCase();
    const isSelectedRoleLocked =
      selectedDefaultsRole === 'OWNER' || (selectedDefaultsRole === 'ADMIN' && !isActorOwner);
    const roleMembers = members.filter(
      (m) => (m.role || 'AGENT').toUpperCase() === selectedDefaultsRole
    );
    const membersWithOverrides = roleMembers
      .map((m) => ({
        member: m,
        changes: calculatePermissionDiff(getMemberPagePermissions(m), selectedDefaultsRole).totalChanges,
      }))
      .filter((x) => x.changes > 0);

    const initialCrudForRole = getInitialRoleCrudDefaults()[selectedDefaultsRole];
    const currentDraftCrudForRole = draftRoleCrudDefaults[selectedDefaultsRole] || initialCrudForRole;
    const savedCrudForRole = roleCrudDefaults[selectedDefaultsRole] || initialCrudForRole;

    let diffsFromUnoCxDefaults = 0;
    let unsavedChangesCount = 0;
    if ((draftRoleDescriptions[selectedDefaultsRole] || '') !== (roleDescriptions[selectedDefaultsRole] || '')) {
      unsavedChangesCount++;
    }
    ROLE_OVERVIEW_AREAS.forEach((area) => {
      const d = currentDraftCrudForRole[area.key] || accessLevelToCrud(area.defaults[selectedDefaultsRole]);
      const base = initialCrudForRole[area.key];
      const saved = savedCrudForRole[area.key] || base;
      (['read', 'create', 'update', 'delete'] as const).forEach((act) => {
        if (d[act] !== base[act]) diffsFromUnoCxDefaults++;
        if (d[act] !== saved[act]) unsavedChangesCount++;
      });
    });

    return (
      <div className="px-6 sm:px-8 pt-2 pb-14 max-w-6xl space-y-5 font-sans">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs font-medium">
          <button
            type="button"
            onClick={() => setIsEditDefaultsOpen(false)}
            className="text-[#1e2a78] hover:underline font-semibold cursor-pointer"
          >
            Team &amp; roles
          </button>
          <span className="text-slate-300">/</span>
          <span className="text-slate-500">Role defaults</span>
        </div>

        {/* Header */}
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Role defaults
          </h2>
          <p className="text-[13.5px] text-slate-500 mt-1 leading-relaxed">
            Set what everyone with a role can do. Changes apply to every member with that role. Personal changes made on a member stay in place.
          </p>
        </div>

        {/* Role Selector Tabs */}
        <div className="flex flex-wrap items-center gap-2.5">
          {(['OWNER', 'ADMIN', 'AGENT', 'VIEWER'] as RoleKey[]).map((rk) => {
            const label = rk.charAt(0) + rk.slice(1).toLowerCase();
            const count = members.filter((m) => (m.role || 'AGENT').toUpperCase() === rk).length;
            const isActive = selectedDefaultsRole === rk;
            return (
              <button
                key={rk}
                type="button"
                onClick={() => setSelectedDefaultsRole(rk)}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  isActive
                    ? 'bg-[#1e2a78] text-white shadow-sm'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span>{label}</span>
                <span
                  className={`px-1.5 py-0.5 rounded-md text-[11px] font-bold ${
                    isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Description & Applies To Card */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-bold text-slate-900 mb-2">
                {roleLabel} description
              </label>
              <input
                type="text"
                value={draftRoleDescriptions[selectedDefaultsRole] || ''}
                disabled={isSelectedRoleLocked}
                onChange={(e) => {
                  const val = e.target.value;
                  setDraftRoleDescriptions((prev) => ({ ...prev, [selectedDefaultsRole]: val }));
                }}
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs sm:text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-[#1e2a78] disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed"
              />
              <p className="text-[11px] text-slate-400 mt-1.5">
                Shown when someone picks this role for a member.
              </p>
            </div>

            <div>
              <div className="text-xs font-bold text-slate-900 mb-1.5">Applies to</div>
              <div className="text-xs sm:text-[13px] text-slate-600">
                {roleMembers.length === 0
                  ? `No members currently have the ${roleLabel} role.`
                  : `${roleMembers.length} ${roleMembers.length === 1 ? 'member' : 'members'}: ${roleMembers
                      .map((m) => m.name)
                      .join(', ')}`}
              </div>
              {membersWithOverrides.length > 0 && (
                <div className="mt-3 rounded-xl bg-amber-50/80 border border-amber-200/70 px-3.5 py-2.5 text-xs text-amber-900">
                  {membersWithOverrides.length === 1
                    ? `${membersWithOverrides[0].member.name} has ${membersWithOverrides[0].changes} personal ${
                        membersWithOverrides[0].changes === 1 ? 'change' : 'changes'
                      }. They're kept when you save.`
                    : `${membersWithOverrides.length} members have personal changes. They're kept when you save.`}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Permissions Matrix Card */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="px-5 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm sm:text-base font-bold text-slate-900">
                {roleLabel} permissions
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {diffsFromUnoCxDefaults === 0
                  ? 'Matches the UnoCX defaults.'
                  : `${diffsFromUnoCxDefaults} ${
                      diffsFromUnoCxDefaults === 1 ? 'change' : 'changes'
                    } from UnoCX defaults.`}
              </p>
            </div>
            {!isSelectedRoleLocked && (
              <button
                type="button"
                onClick={handleResetSelectedRoleDefaults}
                className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors cursor-pointer self-start sm:self-auto"
              >
                Reset to UnoCX defaults
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/70 border-b border-slate-100 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-3 px-5 sm:px-6 w-[38%]">AREA</th>
                  <th className="py-3 px-3 text-center w-[10%]">VIEW</th>
                  <th className="py-3 px-3 text-center w-[10%]">CREATE</th>
                  <th className="py-3 px-3 text-center w-[10%]">EDIT</th>
                  <th className="py-3 px-3 text-center w-[10%]">DELETE</th>
                  <th className="py-3 px-5 sm:px-6 w-[22%]">LEVEL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {ROLE_OVERVIEW_AREAS.map((area) => {
                  const isAdminOnlyArea = ['team', 'settings', 'billing'].includes(area.key);
                  const isRowRestricted =
                    isAdminOnlyArea && (selectedDefaultsRole === 'AGENT' || selectedDefaultsRole === 'VIEWER');
                  const isRowDisabled = isSelectedRoleLocked || isRowRestricted;
                  const crud =
                    currentDraftCrudForRole[area.key] ||
                    accessLevelToCrud(area.defaults[selectedDefaultsRole]);
                  const level = crudToAccessLevel(crud);

                  return (
                    <tr
                      key={area.key}
                      className={`transition-colors ${
                        isRowRestricted ? 'bg-slate-50/30 opacity-60' : 'hover:bg-slate-50/50'
                      }`}
                    >
                      <td className="py-3.5 px-5 sm:px-6 align-middle">
                        <div className="font-semibold text-slate-900 text-[13px]">{area.label}</div>
                        <div className="text-xs text-slate-400 mt-0.5">{area.subtitle}</div>
                      </td>

                      {(['read', 'create', 'update', 'delete'] as const).map((actionKey) => {
                        const checked = Boolean(crud[actionKey]);
                        return (
                          <td key={actionKey} className="py-3.5 px-3 text-center align-middle">
                            <button
                              type="button"
                              disabled={isRowDisabled}
                              onClick={() => {
                                if (isRowDisabled) return;
                                setDraftRoleCrudDefaults((prev) => {
                                  const roleMap = prev[selectedDefaultsRole] || {};
                                  const existing =
                                    roleMap[area.key] ||
                                    accessLevelToCrud(area.defaults[selectedDefaultsRole]);
                                  const nextVal = !existing[actionKey];
                                  const nextCrud: PageCrudPermissions = {
                                    ...existing,
                                    [actionKey]: nextVal,
                                    // If enabling create/update/delete, ensure view (read) is also enabled
                                    ...(actionKey !== 'read' && nextVal ? { read: true } : {}),
                                    // If disabling view (read), disable create/update/delete too
                                    ...(actionKey === 'read' && !nextVal
                                      ? { create: false, update: false, delete: false }
                                      : {}),
                                  };
                                  return {
                                    ...prev,
                                    [selectedDefaultsRole]: {
                                      ...roleMap,
                                      [area.key]: nextCrud,
                                    },
                                  };
                                });
                              }}
                              className={`inline-flex items-center justify-center w-4 h-4 rounded border transition-all ${
                                isRowDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                              } ${
                                checked
                                  ? 'bg-[#1e2a78] border-[#1e2a78] text-white'
                                  : 'bg-white border-slate-300 hover:border-slate-400'
                              }`}
                            >
                              {checked && <Check className="w-3 h-3 stroke-[3]" />}
                            </button>
                          </td>
                        );
                      })}

                      <td className="py-3.5 px-5 sm:px-6 align-middle">
                        {isRowRestricted ? (
                          <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                            <Lock className="w-3.5 h-3.5" />
                            Admin or Owner only
                          </span>
                        ) : (
                          <RoleAccessBadge level={level} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-xs text-slate-500 px-1">
          Permissions only apply inside each member&apos;s stores, teams and languages. Settings, Team and Billing can only be given to Admins and Owners.
        </p>

        {/* Bottom Action Bar */}
        <div className="bg-white rounded-2xl border border-slate-200/80 px-5 sm:px-6 py-4 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="text-xs text-slate-500">
            {unsavedChangesCount === 0
              ? `No changes to ${roleLabel} defaults.`
              : `${unsavedChangesCount} ${unsavedChangesCount === 1 ? 'change' : 'changes'} to ${roleLabel} defaults.`}
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <button
              type="button"
              onClick={() => setIsEditDefaultsOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSavingRoleDefaults || isSelectedRoleLocked}
              onClick={handleSaveRoleDefaults}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#1e2a78] hover:bg-[#16205e] disabled:opacity-50 text-white text-xs font-semibold cursor-pointer shadow-sm transition-all"
            >
              {isSavingRoleDefaults && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save role defaults
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 sm:px-8 pt-2 pb-14 max-w-6xl space-y-5 font-sans">
      {/* Top Subtitle & Action */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-[13.5px] text-slate-500 leading-relaxed">
          Invite people, choose what they can do, and limit which stores, teams and languages they work in.
        </p>

        {canManage && (
          <div className="flex items-center gap-2.5 shrink-0">
            {isSeatLimitReached && canManageBilling && (
              <button
                type="button"
                onClick={() => setIsUpgradeOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 text-xs font-semibold shadow-2xs transition-all cursor-pointer"
              >
                <Zap className="w-3.5 h-3.5 text-amber-600" />
                Upgrade plan
              </button>
            )}

            <button
              type="button"
              disabled={!canCreateMember}
              onClick={canCreateMember ? () => {
                resetInviteForm();
                setIsInviteOpen(true);
              } : undefined}
              title={!canCreateMember ? 'You do not have permission to invite team members' : undefined}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold shadow-sm transition-all shrink-0 ${
                canCreateMember
                  ? 'bg-[#1e2a78] hover:bg-[#16205e] text-white cursor-pointer'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed opacity-60'
              }`}
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              Invite member
              {!canCreateMember && <Lock className="w-3.5 h-3.5 ml-1 text-slate-400" />}
            </button>
          </div>
        )}
      </div>

      {/* ─── Seats Overview Card ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs px-5 py-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex-1 min-w-0 max-w-2xl">
            <p className="text-[13px] text-slate-500">
              <strong className="font-semibold text-slate-900">
                {seats.used} of {seats.total} seats used
              </strong>{' '}
              · {seats.plan} plan ·{' '}
              {isSeatLimitReached ? (
                <span className="text-amber-700 font-semibold">Limit reached</span>
              ) : (
                <span>{availableSeats} available</span>
              )}
            </p>
            <div className="mt-2.5 w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 rounded-full ${
                  isSeatLimitReached
                    ? 'bg-amber-500'
                    : seatsPercentage > 75
                      ? 'bg-indigo-600'
                      : 'bg-[#1e2a78]'
                }`}
                style={{ width: `${Math.max(seats.used > 0 ? 2 : 0, seatsPercentage)}%` }}
              />
            </div>
          </div>

          <p className="text-xs text-slate-500 shrink-0">
            Owners and Admins sign in with 2-step verification.
          </p>
        </div>

        {/* Limit Warning Notice if full */}
        {isSeatLimitReached && (
          <div className="mt-4 p-3 bg-amber-50/70 border border-amber-200/80 rounded-xl flex items-center justify-between gap-3 text-xs text-amber-900">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                All <strong>{seats.total} seats</strong> on your current plan have been allocated.{' '}
                {canManageBilling
                  ? 'Upgrade to Pro (25 seats) or Enterprise to invite more teammates.'
                  : 'Contact an administrator with billing permissions to upgrade.'}
              </span>
            </div>
            {canManageBilling && (
              <button
                type="button"
                onClick={() => setIsUpgradeOpen(true)}
                className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold shrink-0 cursor-pointer shadow-2xs"
              >
                Upgrade now
              </button>
            )}
          </div>
        )}
      </div>

      {/* ─── Members & Invitations Card ──────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
        {/* Tabs & Search/Filter Toolbar */}
        <div className="px-5 sm:px-6 pt-3.5 border-b border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => setActiveTab('members')}
              className={`pb-3.5 text-[13.5px] font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'members'
                  ? 'border-[#1e2a78] text-[#1e2a78]'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <span>Team members</span>
              <span>{members.length}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('invitations')}
              className={`pb-3.5 text-[13.5px] font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'invitations'
                  ? 'border-[#1e2a78] text-[#1e2a78]'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <span>Pending invitations</span>
              <span>{pendingInvitations.length}</span>
            </button>
          </div>

          <div className="pb-3 flex items-center gap-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search members"
                className="pl-8 pr-3 py-1.5 w-44 sm:w-52 text-xs bg-white border border-slate-200 rounded-lg text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-[#1e2a78] focus:ring-1 focus:ring-[#1e2a78]"
              />
            </div>

            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              aria-label="Filter by role"
              className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:border-[#1e2a78] focus:ring-1 focus:ring-[#1e2a78] cursor-pointer"
            >
              <option value="ALL">All roles</option>
              <option value="OWNER">Owner</option>
              <option value="ADMIN">Admin</option>
              <option value="AGENT">Agent</option>
              <option value="VIEWER">Viewer</option>
            </select>
          </div>
        </div>

        {/* ── Tab 1: Active Team Members Table ── */}
        {activeTab === 'members' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  <th className="py-3 px-5 sm:px-6 font-semibold">Member</th>
                  <th className="py-3 px-4 font-semibold">Role and permissions</th>
                  <th className="py-3 px-4 font-semibold">Works on</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-5 sm:px-6 text-right font-semibold"></th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr>
                    <td colSpan={5} className="py-14 text-center text-xs text-slate-400">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto text-[#1e2a78] mb-2" />
                      Loading team members…
                    </td>
                  </tr>
                ) : filteredMembers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-14 text-center text-xs text-slate-400">
                      {members.length === 0 ? (
                        'No team members found.'
                      ) : (
                        <div className="space-y-2">
                          <p>No team members match your search or role filter.</p>
                          <button
                            type="button"
                            onClick={() => {
                              setSearchQuery('');
                              setRoleFilter('ALL');
                            }}
                            className="text-[#1e2a78] font-semibold hover:underline cursor-pointer"
                          >
                            Clear filters
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : (
                  filteredMembers.map((member) => {
                    const roleNormalized = (member.role || 'AGENT').toUpperCase();
                    const roleLabel = roleNormalized.charAt(0) + roleNormalized.slice(1).toLowerCase();
                    const isMemberOwner = roleNormalized === 'OWNER';
                    const isActorAdmin = actorRoleUpper === 'ADMIN';
                    const canManageThisMember = isActorOwner || (isActorAdmin && !isMemberOwner);
                    const isViewOnlyRow = isMemberOwner || !canManageThisMember;

                    const memberPerms = getMemberPagePermissions(member);
                    const diff = calculatePermissionDiff(memberPerms, roleNormalized);
                    const permissionSummary = formatRolePermissionSummary(roleNormalized, memberPerms, diff.totalChanges);

                    const storesLabel = formatStoresLabel(member.stores, stores);
                    const teamsLabel = member.teams && member.teams.length > 0 ? member.teams.join(', ') : 'Support';
                    const languagesLabel = formatLanguageNames(member.languages);

                    const statusLower = (member.status || '').toLowerCase();
                    const isInvited = statusLower === 'invited';
                    const isDeactivated =
                      statusLower === 'away' || statusLower === 'offline' || statusLower === 'deactivated';
                    const isActive = !isInvited && !isDeactivated && (member.isOnline || statusLower === 'online' || statusLower === 'active');

                    const roleBadgeClass =
                      roleNormalized === 'OWNER'
                        ? 'bg-[#111847] text-white'
                        : roleNormalized === 'ADMIN' || roleNormalized === 'AGENT'
                          ? 'bg-[#eef0fb] text-[#3440a8]'
                          : 'bg-slate-100 text-slate-700';

                    return (
                      <tr key={member.id} className="hover:bg-slate-50/60 transition-colors">
                        {/* Member */}
                        <td className="py-4 px-5 sm:px-6 align-middle">
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-9 h-9 rounded-full flex items-center justify-center font-semibold text-xs shrink-0 ${getAvatarColor(
                                member.name
                              )}`}
                            >
                              {member.avatarUrl ? (
                                <img
                                  src={member.avatarUrl}
                                  alt={member.name}
                                  className="w-full h-full rounded-full object-cover"
                                />
                              ) : (
                                getInitials(member.name)
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-900 text-[13.5px] leading-snug truncate">
                                {member.name}
                              </p>
                              <p className="text-xs text-slate-500 truncate">{member.email}</p>
                            </div>
                          </div>
                        </td>

                        {/* Role and Permissions */}
                        <td className="py-4 px-4 align-middle">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-[11.5px] font-semibold ${roleBadgeClass}`}
                            >
                              {roleLabel}
                            </span>

                            {isMemberOwner ? (
                              <span className="inline-flex items-center gap-1 text-xs text-slate-500 font-medium">
                                <Lock className="w-3 h-3 text-slate-400" />
                                Full access, can&apos;t be limited
                              </span>
                            ) : (
                              diff.totalChanges > 0 && (
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200/70 text-[11px] font-semibold">
                                  Customized · {diff.totalChanges} {diff.totalChanges === 1 ? 'change' : 'changes'}
                                </span>
                              )
                            )}
                          </div>
                          <p className="text-xs text-slate-500 mt-1 leading-snug">{permissionSummary}</p>
                        </td>

                        {/* Works on */}
                        <td className="py-4 px-4 align-middle">
                          <div className="text-xs leading-relaxed space-y-0.5">
                            <div>
                              <span className="font-semibold text-slate-700">Stores:</span>{' '}
                              <span className="text-slate-600">{storesLabel}</span>
                            </div>
                            <div>
                              <span className="font-semibold text-slate-700">Teams:</span>{' '}
                              <span className="text-slate-600">{teamsLabel}</span>
                            </div>
                            <div>
                              <span className="font-semibold text-slate-700">Languages:</span>{' '}
                              <span className="text-slate-600">{languagesLabel}</span>
                            </div>
                          </div>
                        </td>

                        {/* Status */}
                        <td className="py-4 px-4 align-middle whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5 text-xs font-medium">
                            {isInvited ? (
                              <>
                                <span className="w-2 h-2 rounded-full bg-blue-500" />
                                <span className="text-blue-700">Invited</span>
                              </>
                            ) : isActive ? (
                              <>
                                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                                <span className="text-emerald-700">Active</span>
                              </>
                            ) : (
                              <>
                                <span className="w-2 h-2 rounded-full bg-slate-300" />
                                <span className="text-slate-500">Deactivated</span>
                              </>
                            )}
                          </div>
                        </td>

                        {/* Edit / View & Remove Actions */}
                        <td className="py-4 px-5 sm:px-6 text-right align-middle">
                          {canManage && (
                            <div className="inline-flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => handleOpenEdit(member, isViewOnlyRow)}
                                className="px-3.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 shadow-2xs transition-colors cursor-pointer"
                              >
                                {isViewOnlyRow ? 'View' : 'Edit'}
                              </button>

                              {canDeleteMember &&
                                !(dbUser && (member.id === dbUser.id || (member.email && dbUser.email && member.email.toLowerCase() === dbUser.email.toLowerCase()))) && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (isMemberOwner && !isActorOwner) {
                                        gooeyToast.error('Cannot remove Owner', {
                                          description: 'Only a Workspace Owner can remove an Owner.',
                                        });
                                        return;
                                      }
                                      if (isMemberOwner && ownerCount <= 1) {
                                        gooeyToast.error('Cannot remove the only Owner', {
                                          description: 'At least one Owner is required per workspace.',
                                        });
                                        return;
                                      }
                                      if (roleNormalized === 'ADMIN' && !isActorOwner) {
                                        gooeyToast.error('Cannot remove Administrator', {
                                          description: 'Only the Workspace Owner can remove an Administrator.',
                                        });
                                        return;
                                      }
                                      handleDeleteMember(member);
                                    }}
                                    title={
                                      isMemberOwner && ownerCount <= 1
                                        ? 'At least one Owner is required per workspace'
                                        : `Remove ${member.name}`
                                    }
                                    className={`p-1.5 rounded-lg border border-slate-200 bg-white transition-colors cursor-pointer ${
                                      isMemberOwner && ownerCount <= 1
                                        ? 'text-slate-300 hover:bg-slate-50'
                                        : 'text-slate-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50/60'
                                    }`}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Tab 2: Pending Invitations Table ── */}
        {activeTab === 'invitations' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  <th className="py-3 px-5 sm:px-6 font-semibold">Invited email</th>
                  <th className="py-3 px-4 font-semibold">Role</th>
                  <th className="py-3 px-4 font-semibold">Works on</th>
                  <th className="py-3 px-4 font-semibold">Expires in</th>
                  <th className="py-3 px-5 sm:px-6 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredInvitations.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-14 text-center text-xs text-slate-400">
                      {pendingInvitations.length === 0
                        ? 'No pending invitations. All invited members have joined!'
                        : 'No pending invitations match your search or role filter.'}
                    </td>
                  </tr>
                ) : (
                  filteredInvitations.map((inv) => {
                    const daysLeft = Math.max(
                      0,
                      Math.ceil((new Date(inv.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                    );
                    const invRoleUpper = (inv.role || 'AGENT').toUpperCase();
                    const invRoleLabel = invRoleUpper.charAt(0) + invRoleUpper.slice(1).toLowerCase();

                    return (
                      <tr key={inv.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-4 px-5 sm:px-6 align-middle">
                          <div>
                            <span className="font-semibold text-slate-900 text-[13.5px]">{inv.email}</span>
                            <p className="text-xs text-slate-400 mt-0.5">
                              Invited by {inv.inviterName || 'Admin'}
                            </p>
                          </div>
                        </td>

                        <td className="py-4 px-4 align-middle">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-md bg-[#eef0fb] text-[#3440a8] text-[11.5px] font-semibold">
                            {invRoleLabel}
                          </span>
                        </td>

                        <td className="py-4 px-4 align-middle">
                          <div className="text-xs leading-relaxed space-y-0.5">
                            <div>
                              <span className="font-semibold text-slate-700">Stores:</span>{' '}
                              <span className="text-slate-600">{formatStoresLabel(inv.stores, stores)}</span>
                            </div>
                            <div>
                              <span className="font-semibold text-slate-700">Teams:</span>{' '}
                              <span className="text-slate-600">
                                {inv.teams && inv.teams.length > 0 ? inv.teams.join(', ') : 'Support'}
                              </span>
                            </div>
                            <div>
                              <span className="font-semibold text-slate-700">Languages:</span>{' '}
                              <span className="text-slate-600">{formatLanguageNames(inv.languages)}</span>
                            </div>
                          </div>
                        </td>

                        <td className="py-4 px-4 align-middle text-xs text-slate-600">
                          <span className="inline-flex items-center gap-1 text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-full font-medium text-[11px]">
                            <Clock className="w-3 h-3" />
                            {daysLeft > 0 ? `${daysLeft} days` : 'Expiring soon'}
                          </span>
                        </td>

                        <td className="py-4 px-5 sm:px-6 text-right align-middle">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleCopyInviteLink(inv.token, inv.email)}
                              title="Copy secure single-use invitation link"
                              className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                            >
                              <Copy className="w-3.5 h-3.5 text-slate-500" />
                              Copy link
                            </button>

                            <button
                              type="button"
                              onClick={() => handleResendInvite(inv.id, inv.email)}
                              title="Resend email with new 7-day token"
                              className="px-2.5 py-1.5 rounded-lg bg-[#1e2a78] hover:bg-[#16205e] text-white text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                            >
                              <Send className="w-3.5 h-3.5" />
                              Resend
                            </button>

                            <button
                              type="button"
                              onClick={() => handleRevokeInvite(inv.id, inv.email)}
                              title="Revoke invitation"
                              className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 cursor-pointer transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── What Each Role Can Do (Role Defaults Matrix) ───────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="px-5 sm:px-6 pt-6 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <h3 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                What each role can do
              </h3>
              <p className="text-xs sm:text-[13px] text-slate-500 mt-1 max-w-2xl leading-relaxed">
                These are the defaults for everyone with that role. To give one person more or less, open their row and choose Permissions. Owner always has full access.
              </p>
            </div>
            {(isActorOwner || isActorAdmin) && (
              <button
                type="button"
                onClick={handleOpenEditDefaults}
                className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 transition-colors cursor-pointer shrink-0 self-start shadow-2xs"
              >
                Edit role defaults
              </button>
            )}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-4">
            <div className="inline-flex items-center gap-1.5">
              <RoleAccessBadge level="full" />
              <span className="text-xs text-slate-500">view, create, edit, delete</span>
            </div>
            <div className="inline-flex items-center gap-1.5">
              <RoleAccessBadge level="edit" />
              <span className="text-xs text-slate-500">view, create, edit</span>
            </div>
            <div className="inline-flex items-center gap-1.5">
              <RoleAccessBadge level="view" />
              <span className="text-xs text-slate-500">see only</span>
            </div>
            <div className="inline-flex items-center gap-1.5">
              <RoleAccessBadge level="none" />
              <span className="text-xs text-slate-500">hidden</span>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/70 border-y border-slate-100 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-5 sm:px-6 w-[36%]">AREA</th>
                <th className="py-3 px-4 w-[14%]">OWNER</th>
                <th className="py-3 px-4 w-[16%]">ADMIN</th>
                <th className="py-3 px-4 w-[18%]">AGENT</th>
                <th className="py-3 px-5 sm:px-6 w-[16%]">VIEWER</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {ROLE_OVERVIEW_AREAS.map((area) => {
                const saved = roleOverviewDefaults[area.key] || area.defaults;
                const adminLevel = saved.ADMIN || area.defaults.ADMIN;
                const agentLevel = saved.AGENT || area.defaults.AGENT;
                const viewerLevel = saved.VIEWER || area.defaults.VIEWER;

                return (
                  <tr key={area.key} className="hover:bg-slate-50/50 transition-colors">
                    <td className="py-3.5 px-5 sm:px-6 align-middle">
                      <div className="font-semibold text-slate-900 text-[13px]">{area.label}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{area.subtitle}</div>
                    </td>
                    <td className="py-3.5 px-4 align-middle">
                      <RoleAccessBadge level="full" />
                    </td>
                    <td className="py-3.5 px-4 align-middle">
                      <div className="flex flex-col items-start gap-1">
                        <RoleAccessBadge level={adminLevel} />
                        {area.notes?.ADMIN && (
                          <span className="text-[11px] text-slate-400 leading-tight">{area.notes.ADMIN}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 align-middle">
                      <div className="flex flex-col items-start gap-1">
                        <RoleAccessBadge level={agentLevel} />
                        {area.notes?.AGENT && (
                          <span className="text-[11px] text-slate-400 leading-tight">{area.notes.AGENT}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-5 sm:px-6 align-middle">
                      <div className="flex flex-col items-start gap-1">
                        <RoleAccessBadge level={viewerLevel} />
                        {area.notes?.VIEWER && (
                          <span className="text-[11px] text-slate-400 leading-tight">{area.notes.VIEWER}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Modal: Invite Member(s) ────────────────────────────────────────────── */}
      <Modal
        isOpen={isInviteOpen}
        onClose={() => {
          setIsInviteOpen(false);
          resetInviteForm();
        }}
        title="Invite team members"
        maxWidth="lg"
      >
        {createdInvitesPreview ? (
          /* Confirmation / Copy Link View */
          <div className="space-y-4 pt-2">
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-sm text-emerald-950">Invitations generated successfully</h4>
                <p className="text-xs text-emerald-800 mt-0.5">
                  Transactional emails have been dispatched with SPF/DKIM authentication. You can also copy the secure single-use links below to send them directly:
                </p>
              </div>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto">
              {createdInvitesPreview.map((inv, idx) => (
                <div key={idx} className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between gap-3 text-xs">
                  <div className="truncate">
                    <span className="font-semibold text-slate-800 block">{inv.email}</span>
                    <span className="text-[11px] text-slate-400 font-mono truncate block max-w-sm">
                      {inv.inviteUrl}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(inv.inviteUrl);
                      gooeyToast.success(`Copied invite link for ${inv.email}`);
                    }}
                    className="px-2.5 py-1 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg font-semibold flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Copy
                  </button>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setIsInviteOpen(false);
                  resetInviteForm();
                }}
                className="px-4 py-2 bg-[#1e2a78] hover:bg-[#16205e] text-white text-xs font-semibold rounded-xl cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          /* Main Multi-Invite Form */
          <form onSubmit={handleInviteSubmit} className="space-y-5 pt-1">
            {trial && (
              <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-xl flex items-start gap-2.5 text-xs text-amber-950">
                <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block">Workspace Trial: {trial.daysLeft} day{trial.daysLeft === 1 ? '' : 's'} remaining</span>
                  <p className="text-[11px] text-amber-800 leading-normal mt-0.5">
                    Invited team members join this workspace and share the owner&apos;s trial timeline (Day {trial.currentDay} of {trial.totalDays}, ends {trial.formattedExpiresAt}).
                  </p>
                </div>
              </div>
            )}

            {/* Multi-email input chips */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Email addresses *
                </label>
                <span className="text-[11px] text-slate-400">
                  Enter one or more emails (separated by comma, space, or enter)
                </span>
              </div>

              <div className="min-h-12 p-2 bg-slate-50 border border-slate-200 rounded-xl focus-within:bg-white focus-within:border-[#1e2a78] focus-within:ring-1 focus-within:ring-[#1e2a78] flex flex-wrap items-center gap-1.5 transition-colors">
                {emailChips.map((chip) => (
                  <span
                    key={chip}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-slate-200 text-slate-800 rounded-lg text-xs font-medium shadow-2xs"
                  >
                    {chip}
                    <button
                      type="button"
                      onClick={() => removeEmailChip(chip)}
                      className="text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <input
                  type="email"
                  placeholder={emailChips.length === 0 ? "e.g. sarah@store.com, raj@store.com" : "Add another email..."}
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  onKeyDown={handleEmailKeyDown}
                  onPaste={handleEmailPaste}
                  onBlur={() => {
                    if (emailInput.trim()) addEmailChip(emailInput);
                  }}
                  className="flex-1 min-w-[160px] bg-transparent text-xs py-1 px-1 focus:outline-none text-slate-800 placeholder:text-slate-400"
                />
              </div>

              {/* Dynamic Seat impact preview */}
              <div className="mt-1.5 flex items-center justify-between text-[11px]">
                <span className="text-slate-500">
                  {emailChips.length > 0 ? (
                    <>
                      <strong>{emailChips.length} member(s)</strong> selected · will use{' '}
                      <strong>{seats.used + emailChips.length} of {seats.total} seats</strong> on {seats.plan} plan
                    </>
                  ) : (
                    <span>{seats.used} of {seats.total} seats used on {seats.plan} plan</span>
                  )}
                </span>
                {seats.used + (emailChips.length || 1) > seats.total && canManageBilling && (
                  <button
                    type="button"
                    onClick={() => setIsUpgradeOpen(true)}
                    className="text-amber-700 font-bold hover:underline cursor-pointer flex items-center gap-0.5"
                  >
                    <Zap className="w-3 h-3" /> Upgrade plan
                  </button>
                )}
              </div>
            </div>

            {/* Role & Custom Permissions */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-slate-700">Role & Access</label>
                <button
                  type="button"
                  onClick={() => setUseCustomPermissions(!useCustomPermissions)}
                  className="text-xs font-medium text-[#1e2a78] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  {useCustomPermissions ? 'Use standard roles' : 'Customize permissions'}
                </button>
              </div>

              {!useCustomPermissions ? (
                <div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {(['OWNER', 'ADMIN', 'AGENT', 'VIEWER'] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => {
                          if (r === 'OWNER' && !isActorOwner) {
                            gooeyToast.error('Unable to invite as Owner', {
                              description: 'Only a Workspace Owner can invite another Owner.',
                            });
                            return;
                          }
                          setInviteRole(r);
                        }}
                        className={`py-2 px-3 rounded-xl border text-xs font-semibold text-center cursor-pointer transition-colors ${
                          inviteRole === r
                            ? 'border-[#1e2a78] bg-[#eef0fb] text-[#1e2a78]'
                            : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {r.charAt(0) + r.slice(1).toLowerCase()}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    {inviteRole === 'OWNER'
                      ? 'Full workspace access including billing, deleting workspace, and managing all roles.'
                      : inviteRole === 'ADMIN'
                        ? 'Admins require 2-step verification. Can manage team, view all chats, and configure bots.'
                        : inviteRole === 'AGENT'
                          ? 'Can reply to chats assigned to them and send approved templates.'
                          : 'Read-only access to customer chats, reports, and analytics.'}
                  </p>
                </div>
              ) : (
                /* Granular Custom Permissions View */
                <div className="bg-slate-50 rounded-xl border border-slate-200 p-3 space-y-2 text-xs">
                  <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block mb-1">
                    Custom Permissions Matrix
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {PERMISSION_ROWS.map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer hover:bg-white/80 p-1 rounded-md">
                        <input
                          type="checkbox"
                          checked={Boolean(customPermissions[key])}
                          onChange={(e) =>
                            setCustomPermissions({ ...customPermissions, [key]: e.target.checked })
                          }
                          className="w-3.5 h-3.5 rounded text-[#1e2a78] border-slate-300 focus:ring-[#1e2a78] cursor-pointer"
                        />
                        <span className="text-slate-700 text-[11px] leading-tight">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Stores Selector */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Assigned Stores</label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setInviteStores(['All'])}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                    inviteStores.includes('All') ? 'bg-[#1e2a78] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  All Stores
                </button>
                {stores.map((s) => {
                  const selected = !inviteStores.includes('All') && inviteStores.includes(s.domain);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        const withoutAll = inviteStores.filter((x) => x !== 'All');
                        const next = selected
                          ? withoutAll.filter((d) => d !== s.domain)
                          : [...withoutAll, s.domain];
                        setInviteStores(next.length === 0 ? ['All'] : next);
                      }}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                        selected ? 'bg-[#1e2a78] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {s.name || s.domain}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Teams Selector */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Teams</label>
              <div className="flex flex-wrap gap-1.5">
                {AVAILABLE_TEAMS.map((team) => {
                  const selected = inviteTeams.includes(team);
                  return (
                    <button
                      key={team}
                      type="button"
                      onClick={() => {
                        if (team === 'All') {
                          setInviteTeams(['All']);
                        } else {
                          const next = selected
                            ? inviteTeams.filter((t) => t !== team)
                            : [...inviteTeams.filter((t) => t !== 'All'), team];
                          setInviteTeams(next.length === 0 ? ['Support'] : next);
                        }
                      }}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                        selected ? 'bg-[#1e2a78] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {team}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Languages Selector */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Languages</label>
              <div className="flex flex-wrap gap-1.5">
                {AVAILABLE_LANGUAGES.map((lang) => {
                  const selected = inviteLanguages.includes(lang);
                  return (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => {
                        const next = selected
                          ? inviteLanguages.filter((l) => l !== lang)
                          : [...inviteLanguages, lang];
                        setInviteLanguages(next.length === 0 ? ['EN'] : next);
                      }}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                        selected ? 'bg-[#1e2a78] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {lang}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setIsInviteOpen(false);
                  resetInviteForm();
                }}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmittingInvite || (emailChips.length === 0 && !emailInput.trim())}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#1e2a78] hover:bg-[#16205e] disabled:opacity-50 text-white text-xs font-semibold cursor-pointer shadow-sm transition-all"
              >
                {isSubmittingInvite ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                Send {emailChips.length > 1 ? `${emailChips.length} invitations` : 'invitation'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* ─── Modal: Upgrade Plan ────────────────────────────────────────────────── */}
      <Modal
        isOpen={isUpgradeOpen}
        onClose={() => setIsUpgradeOpen(false)}
        title="Upgrade Workspace Plan"
        maxWidth="lg"
      >
        <div className="space-y-4 pt-1">
          <p className="text-xs text-slate-600">
            Expand team capacity, unlock extra seats, and enable advanced automated workflows.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Growth (Current) */}
            <div className={`p-4 rounded-xl border text-xs flex flex-col justify-between ${
              seats.plan.toLowerCase() === 'growth'
                ? 'border-[#1e2a78] bg-[#eef0fb]/40 ring-1 ring-[#1e2a78]'
                : 'border-slate-200 bg-white'
            }`}>
              <div>
                <span className="font-bold text-slate-900 block text-sm">Growth</span>
                <span className="text-slate-500 font-medium">10 seats included</span>
                <div className="mt-3 text-lg font-extrabold text-slate-900">$59<span className="text-xs font-normal text-slate-500">/mo</span></div>
                <ul className="mt-3 space-y-1 text-slate-600 text-[11px]">
                  <li className="flex items-center gap-1"><Check className="w-3 h-3 text-emerald-600" /> WhatsApp & IG DMs</li>
                  <li className="flex items-center gap-1"><Check className="w-3 h-3 text-emerald-600" /> 10 Team Seats</li>
                  <li className="flex items-center gap-1"><Check className="w-3 h-3 text-emerald-600" /> Standard SLA (15 min)</li>
                </ul>
              </div>
              <div className="mt-4">
                {seats.plan.toLowerCase() === 'growth' ? (
                  <span className="block text-center py-1.5 bg-slate-100 text-slate-600 font-bold rounded-lg text-[11px]">
                    Current Plan
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleUpgradePlan('Growth')}
                    className="w-full py-1.5 border border-slate-300 rounded-lg font-semibold hover:bg-slate-50 cursor-pointer"
                  >
                    Select Growth
                  </button>
                )}
              </div>
            </div>

            {/* Pro (Recommended) */}
            <div className={`p-4 rounded-xl border text-xs flex flex-col justify-between relative ${
              seats.plan.toLowerCase() === 'pro'
                ? 'border-[#1e2a78] bg-[#eef0fb]/40 ring-1 ring-[#1e2a78]'
                : 'border-[#1e2a78] bg-white shadow-xs'
            }`}>
              <div className="absolute -top-2.5 right-3 bg-[#1e2a78] text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                Recommended
              </div>
              <div>
                <span className="font-bold text-slate-900 block text-sm">Pro</span>
                <span className="text-[#1e2a78] font-bold">25 seats included</span>
                <div className="mt-3 text-lg font-extrabold text-slate-900">$129<span className="text-xs font-normal text-slate-500">/mo</span></div>
                <ul className="mt-3 space-y-1 text-slate-600 text-[11px]">
                  <li className="flex items-center gap-1"><Check className="w-3 h-3 text-emerald-600" /> 25 Team Seats</li>
                  <li className="flex items-center gap-1"><Check className="w-3 h-3 text-emerald-600" /> Fast SLA (5 min)</li>
                  <li className="flex items-center gap-1"><Check className="w-3 h-3 text-emerald-600" /> Multi-store routing</li>
                  <li className="flex items-center gap-1"><Check className="w-3 h-3 text-emerald-600" /> Custom role matrices</li>
                </ul>
              </div>
              <div className="mt-4">
                {seats.plan.toLowerCase() === 'pro' ? (
                  <span className="block text-center py-1.5 bg-slate-100 text-slate-600 font-bold rounded-lg text-[11px]">
                    Current Plan
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={isUpgrading}
                    onClick={() => handleUpgradePlan('Pro')}
                    className="w-full py-1.5 bg-[#1e2a78] hover:bg-[#16205e] text-white rounded-lg font-semibold cursor-pointer shadow-xs flex items-center justify-center gap-1"
                  >
                    {isUpgrading && <Loader2 className="w-3 h-3 animate-spin" />}
                    Upgrade to Pro
                  </button>
                )}
              </div>
            </div>

            {/* Enterprise */}
            <div className={`p-4 rounded-xl border text-xs flex flex-col justify-between ${
              seats.plan.toLowerCase() === 'enterprise'
                ? 'border-[#1e2a78] bg-[#eef0fb]/40 ring-1 ring-[#1e2a78]'
                : 'border-slate-200 bg-white'
            }`}>
              <div>
                <span className="font-bold text-slate-900 block text-sm">Enterprise</span>
                <span className="text-slate-500 font-medium">Unlimited seats</span>
                <div className="mt-3 text-lg font-extrabold text-slate-900">$299<span className="text-xs font-normal text-slate-500">/mo</span></div>
                <ul className="mt-3 space-y-1 text-slate-600 text-[11px]">
                  <li className="flex items-center gap-1"><Check className="w-3 h-3 text-emerald-600" /> 100+ Team Seats</li>
                  <li className="flex items-center gap-1"><Check className="w-3 h-3 text-emerald-600" /> Dedicated Account Mgr</li>
                  <li className="flex items-center gap-1"><Check className="w-3 h-3 text-emerald-600" /> Custom 2FA & SSO</li>
                  <li className="flex items-center gap-1"><Check className="w-3 h-3 text-emerald-600" /> 99.9% Uptime SLA</li>
                </ul>
              </div>
              <div className="mt-4">
                {seats.plan.toLowerCase() === 'enterprise' ? (
                  <span className="block text-center py-1.5 bg-slate-100 text-slate-600 font-bold rounded-lg text-[11px]">
                    Current Plan
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={isUpgrading}
                    onClick={() => handleUpgradePlan('Enterprise')}
                    className="w-full py-1.5 border border-slate-300 rounded-lg font-semibold hover:bg-slate-50 cursor-pointer"
                  >
                    Select Enterprise
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {/* ─── Modal: Edit Member (Role & Access / Permissions) ───────────────────── */}
      <Modal
        isOpen={isEditOpen}
        onClose={() => {
          setIsEditOpen(false);
          setEditingMember(null);
        }}
        maxWidth="3xl"
        className="max-h-[92vh] flex flex-col p-5"
        bodyClassName="flex flex-col flex-1 min-h-0"
        header={
          <div className="shrink-0 border-b border-slate-200 pb-0">
            <div className="flex items-start justify-between gap-3 mb-3.5">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${getAvatarColor(
                    editingMember?.name || ''
                  )}`}
                >
                  {getInitials(editingMember?.name || 'Member')}
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-slate-900 text-base leading-tight truncate">
                    {isEditReadOnly ? editingMember?.name || 'Member' : `Edit ${editingMember?.name || 'Member'}`}
                  </h3>
                  <p className="text-xs text-slate-500 font-medium truncate mt-0.5">
                    {editingMember?.email || ''} · {formatJoinedDate(editingMember?.createdAt)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsEditOpen(false);
                  setEditingMember(null);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tab navigation */}
            <div className="flex items-center gap-6">
              <button
                type="button"
                onClick={() => setEditTab('role')}
                className={`pb-2.5 text-xs font-bold transition-colors cursor-pointer border-b-2 ${
                  editTab === 'role'
                    ? 'border-[#1e2a78] text-[#1e2a78]'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                Role & access
              </button>
              <button
                type="button"
                onClick={() => setEditTab('permissions')}
                className={`pb-2.5 text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer border-b-2 ${
                  editTab === 'permissions'
                    ? 'border-[#1e2a78] text-[#1e2a78]'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <span>Permissions</span>
                {editDiff.totalChanges > 0 && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                    {editDiff.totalChanges} {editDiff.totalChanges === 1 ? 'change' : 'changes'}
                  </span>
                )}
              </button>
            </div>
          </div>
        }
      >
        <form onSubmit={handleEditSubmit} className="flex flex-col flex-1 min-h-0 pt-2">
          {/* Scrollable content container */}
          <div className="overflow-y-auto flex-1 min-h-0 pr-1 space-y-4">
            {editTab === 'role' ? (
              <>
                {/* Name */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Name</label>
                  <input
                    type="text"
                    required
                    disabled={isEditReadOnly}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#1e2a78] focus:ring-1 focus:ring-[#1e2a78] disabled:bg-slate-50 disabled:text-slate-600 disabled:cursor-not-allowed"
                  />
                </div>

                {/* Role selection 2x2 grid */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-2">
                    Role · sets what {firstName} can do
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {ROLES_CONFIG.map((rc) => {
                      const isSelected = editRole.toUpperCase() === rc.role;
                      const isCardDisabled = isEditReadOnly || (isActorAdmin && rc.role === 'OWNER');
                      return (
                        <div
                          key={rc.role}
                          onClick={() => {
                            if (isEditReadOnly) return;
                            if (isActorAdmin && rc.role === 'OWNER') {
                              gooeyToast.error('Unable to change role to Owner', {
                                description: 'Administrators cannot assign or edit the Owner role.',
                              });
                              return;
                            }
                            setEditRole(rc.role);
                            setEditPermissions(getDefaultPagePermissions(rc.role));
                          }}
                          className={`relative p-3 rounded-xl border text-left transition-all ${
                            isCardDisabled
                              ? 'opacity-70 cursor-not-allowed border-slate-200 bg-slate-50/50'
                              : 'cursor-pointer'
                          } ${
                            isSelected
                              ? 'border-indigo-600 ring-1.5 ring-indigo-600 bg-indigo-50/10'
                              : 'border-slate-200 hover:border-slate-300 bg-white'
                          }`}
                        >
                          <div className="flex items-start gap-2.5">
                            <div className="mt-0.5">
                              <div
                                className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                                  isSelected
                                    ? 'border-indigo-600 bg-indigo-600'
                                    : 'border-slate-300 bg-white'
                                }`}
                              >
                                {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                              </div>
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-xs text-slate-900">{rc.label}</span>
                                {isCardDisabled && rc.role === 'OWNER' && (
                                  <span className="text-[10px] text-slate-400 font-medium">
                                    (Owner only)
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-500 leading-snug mt-0.5">
                                {rc.description}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Role Capabilities summary box */}
                <div className="bg-slate-50/80 rounded-xl p-3 border border-slate-200/80 space-y-2">
                  <div className="text-xs font-bold text-slate-800">
                    As {currentRoleConfig.label}, {firstName} can
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {currentRoleConfig.allowedPills.map((pill) => (
                      <span
                        key={pill}
                        className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200"
                      >
                        {pill}
                      </span>
                    ))}
                    {currentRoleConfig.deniedPills.map((pill) => (
                      <span
                        key={pill}
                        className="px-2.5 py-1 rounded-full text-xs font-medium border border-dashed border-slate-300 text-slate-400 bg-white/50"
                      >
                        {pill}
                      </span>
                    ))}
                  </div>

                  {/* Overrides notice */}
                  {editDiff.totalChanges > 0 && (
                    <div className="mt-2.5 p-2.5 rounded-lg bg-amber-50/80 border border-amber-200 text-xs text-amber-900 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="font-semibold">
                          Plus {editDiff.totalChanges} extra permission{editDiff.totalChanges === 1 ? '' : 's'} for {firstName}:
                        </span>{' '}
                        <span className="text-amber-800">{editDiff.summaryText}.</span>{' '}
                        <button
                          type="button"
                          onClick={() => setEditTab('permissions')}
                          className="font-bold underline text-indigo-700 hover:text-indigo-900 cursor-pointer ml-1 inline-block"
                        >
                          Review in Permissions
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Works on */}
                <div className="space-y-3 pt-1">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Works on</h4>
                    <p className="text-[11px] text-slate-500">
                      Limits which conversations, contacts and reports {firstName} sees. Applies on top of the role.
                    </p>
                  </div>

                  {/* Stores Row */}
                  <div className="flex items-center gap-3">
                    <span className="w-18 text-xs font-semibold text-slate-600 shrink-0">Stores</span>
                    <div className="flex items-center flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={isEditReadOnly}
                        onClick={() => setEditStores([])}
                        className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                          isEditReadOnly ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'
                        } ${
                          editStores.length === 0 || editStores.includes('All')
                            ? 'bg-[#1e2a78] text-white shadow-2xs'
                            : 'border border-slate-200 text-slate-700 bg-white hover:bg-slate-50'
                        }`}
                      >
                        All stores
                      </button>
                      {stores.map((s) => {
                        const selected = !editStores.includes('All') && editStores.includes(s.domain);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            disabled={isEditReadOnly}
                            onClick={() => {
                              const withoutAll = editStores.filter((x) => x !== 'All');
                              const next = selected
                                ? withoutAll.filter((d) => d !== s.domain)
                                : [...withoutAll, s.domain];
                              setEditStores(next);
                            }}
                            className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                              isEditReadOnly ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'
                            } ${
                              selected
                                ? 'bg-[#1e2a78] text-white shadow-2xs'
                                : 'border border-slate-200 text-slate-700 bg-white hover:bg-slate-50'
                            }`}
                          >
                            {s.name || s.domain}
                          </button>
                        );
                      })}
                      <span className="text-xs text-slate-400">New stores are included automatically</span>
                    </div>
                  </div>

                  {/* Teams Row */}
                  <div className="flex items-center gap-3">
                    <span className="w-18 text-xs font-semibold text-slate-600 shrink-0">Teams</span>
                    <div className="flex items-center flex-wrap gap-1.5">
                      {['Support', 'Sales', 'Wholesale', 'Marketing', 'Billing'].map((t) => {
                        const isSelected = editTeams.includes(t) || (t === 'Support' && editTeams.length === 0);
                        return (
                          <button
                            key={t}
                            type="button"
                            disabled={isEditReadOnly}
                            onClick={() => {
                              if (isSelected) {
                                const next = editTeams.filter((item) => item !== t);
                                setEditTeams(next.length === 0 ? ['Support'] : next);
                              } else {
                                setEditTeams([...editTeams.filter((item) => item !== 'All'), t]);
                              }
                            }}
                            className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                              isEditReadOnly ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'
                            } ${
                              isSelected
                                ? 'bg-[#1e2a78] text-white shadow-2xs'
                                : 'border border-slate-200 text-slate-700 bg-white hover:bg-slate-50'
                            }`}
                          >
                            {t}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Languages Row */}
                  <div className="flex items-center gap-3">
                    <span className="w-18 text-xs font-semibold text-slate-600 shrink-0">Languages</span>
                    <div className="flex items-center flex-wrap gap-1.5">
                      {AVAILABLE_LANGUAGES.map((lang) => {
                        const isSelected = editLanguages.includes(lang);
                        return (
                          <button
                            key={lang}
                            type="button"
                            disabled={isEditReadOnly}
                            onClick={() => {
                              if (isSelected) {
                                const next = editLanguages.filter((l) => l !== lang);
                                setEditLanguages(next.length === 0 ? ['EN'] : next);
                              } else {
                                setEditLanguages([...editLanguages, lang]);
                              }
                            }}
                            className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                              isEditReadOnly ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'
                            } ${
                              isSelected
                                ? 'bg-[#1e2a78] text-white shadow-2xs'
                                : 'border border-slate-200 text-slate-700 bg-white hover:bg-slate-50'
                            }`}
                          >
                            {LANGUAGE_LABELS[lang] || lang}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Status Row */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <span className="w-18 text-xs font-semibold text-slate-600 shrink-0">Status</span>
                      <div className="inline-flex rounded-full border border-slate-200 p-0.5 bg-slate-50">
                        <button
                          type="button"
                          disabled={isEditReadOnly}
                          onClick={() => setEditStatus('active')}
                          className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                            isEditReadOnly ? 'cursor-not-allowed' : 'cursor-pointer'
                          } ${
                            editStatus === 'active' || editStatus === 'online'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs'
                              : 'text-slate-600 hover:text-slate-900 border border-transparent'
                          }`}
                        >
                          Active
                        </button>
                        <button
                          type="button"
                          disabled={isEditReadOnly}
                          onClick={() => setEditStatus('away')}
                          className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                            isEditReadOnly ? 'cursor-not-allowed' : 'cursor-pointer'
                          } ${
                            editStatus === 'away' || editStatus === 'offline' || editStatus === 'deactivated'
                              ? 'bg-white text-slate-900 border border-slate-200 shadow-2xs'
                              : 'text-slate-600 hover:text-slate-900 border border-transparent'
                          }`}
                        >
                          Deactivated
                        </button>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-400 pl-21">
                      Deactivated members can&apos;t sign in and keep no seat.
                    </p>
                  </div>
                </div>
              </>
            ) : (
              /* ─── Permissions Tab ──────────────────────────────────────────────────── */
              <div className="space-y-4">
                {/* Notice banner */}
                <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h4 className="text-xs font-bold text-amber-950">
                      {isEditingMemberOwner
                        ? 'Owner has full access across the workspace'
                        : isEditReadOnly
                          ? `${editRole.charAt(0) + editRole.slice(1).toLowerCase()} permissions (read-only)`
                          : `${editRole.charAt(0) + editRole.slice(1).toLowerCase()} role, customized for ${firstName}`}
                    </h4>
                    <p className="text-[11px] text-amber-800 mt-0.5">
                      {isEditingMemberOwner ? (
                        <>Owner permissions cannot be limited and include all areas, billing, and workspace management.</>
                      ) : (
                        <>
                          Ticked boxes are what {firstName} can do. Boxes marked{' '}
                          <span className="font-semibold text-amber-900">Changed</span> differ from the{' '}
                          {editRole.charAt(0) + editRole.slice(1).toLowerCase()} defaults. Other{' '}
                          {editRole.charAt(0) + editRole.slice(1).toLowerCase()}s are not affected.
                        </>
                      )}
                    </p>
                  </div>
                  {!isEditReadOnly && !isEditingMemberOwner && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditPermissions(getDefaultPagePermissions(editRole));
                        gooeyToast.info(`Reset to standard ${editRole.charAt(0) + editRole.slice(1).toLowerCase()} defaults`);
                      }}
                      className="px-3 py-1.5 rounded-lg border border-amber-300 bg-white text-xs font-semibold text-amber-900 hover:bg-amber-50 shadow-2xs cursor-pointer shrink-0 transition-colors"
                    >
                      Reset to {editRole.charAt(0) + editRole.slice(1).toLowerCase()} defaults
                    </button>
                  )}
                </div>

                {/* Permissions Table */}
                <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50/80 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                          <th className="py-2.5 px-3 w-[30%]">Area</th>
                          <th className="py-2.5 px-2 text-center w-[11%]">View</th>
                          <th className="py-2.5 px-2 text-center w-[11%]">Create</th>
                          <th className="py-2.5 px-2 text-center w-[11%]">Edit</th>
                          <th className="py-2.5 px-2 text-center w-[11%]">Delete</th>
                          <th className="py-2.5 px-3 w-[26%]">{editRole.toUpperCase()} Default</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {PERMISSION_AREAS.map((area) => {
                          const defaults = getDefaultPagePermissions(editRole)[area.key] || {
                            create: false,
                            read: false,
                            update: false,
                            delete: false,
                          };
                          const current = editPermissions[area.key] || {
                            create: false,
                            read: false,
                            update: false,
                            delete: false,
                          };

                          const isAreaLocked =
                            isEditReadOnly ||
                            isEditingMemberOwner ||
                            (Boolean(area.adminOnly) &&
                              editRole.toUpperCase() !== 'OWNER' &&
                              editRole.toUpperCase() !== 'ADMIN');

                          const defaultLabel = getRoleDefaultLabel(editRole, area.key);

                          return (
                            <tr key={area.key} className="hover:bg-slate-50/60 transition-colors">
                              {/* Area name & description */}
                              <td className="py-2.5 px-3 align-middle">
                                <div className="font-semibold text-xs text-slate-900">{area.label}</div>
                                <div className="text-[11px] text-slate-500">{area.subtext(editRole)}</div>
                              </td>

                              {/* VIEW (read) */}
                              <td className="py-2.5 px-2 text-center align-middle">
                                <div className="flex flex-col items-center justify-center">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(current.read)}
                                    disabled={isAreaLocked}
                                    onChange={(e) => {
                                      const checked = e.target.checked;
                                      setEditPermissions((prev) => ({
                                        ...prev,
                                        [area.key]: {
                                          ...(prev[area.key] || {
                                            create: false,
                                            read: false,
                                            update: false,
                                            delete: false,
                                          }),
                                          read: checked,
                                        },
                                      }));
                                    }}
                                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                                  />
                                  {!isAreaLocked && current.read !== defaults.read && (
                                    <span className="block text-[9px] font-bold text-amber-700 mt-0.5 leading-none">
                                      Changed
                                    </span>
                                  )}
                                </div>
                              </td>

                              {/* CREATE (create) */}
                              <td className="py-2.5 px-2 text-center align-middle">
                                <div className="flex flex-col items-center justify-center">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(current.create)}
                                    disabled={isAreaLocked}
                                    onChange={(e) => {
                                      const checked = e.target.checked;
                                      setEditPermissions((prev) => ({
                                        ...prev,
                                        [area.key]: {
                                          ...(prev[area.key] || {
                                            create: false,
                                            read: false,
                                            update: false,
                                            delete: false,
                                          }),
                                          create: checked,
                                        },
                                      }));
                                    }}
                                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                                  />
                                  {!isAreaLocked && current.create !== defaults.create && (
                                    <span className="block text-[9px] font-bold text-amber-700 mt-0.5 leading-none">
                                      Changed
                                    </span>
                                  )}
                                </div>
                              </td>

                              {/* EDIT (update) */}
                              <td className="py-2.5 px-2 text-center align-middle">
                                <div className="flex flex-col items-center justify-center">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(current.update)}
                                    disabled={isAreaLocked}
                                    onChange={(e) => {
                                      const checked = e.target.checked;
                                      setEditPermissions((prev) => ({
                                        ...prev,
                                        [area.key]: {
                                          ...(prev[area.key] || {
                                            create: false,
                                            read: false,
                                            update: false,
                                            delete: false,
                                          }),
                                          update: checked,
                                        },
                                      }));
                                    }}
                                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                                  />
                                  {!isAreaLocked && current.update !== defaults.update && (
                                    <span className="block text-[9px] font-bold text-amber-700 mt-0.5 leading-none">
                                      Changed
                                    </span>
                                  )}
                                </div>
                              </td>

                              {/* DELETE (delete) */}
                              <td className="py-2.5 px-2 text-center align-middle">
                                <div className="flex flex-col items-center justify-center">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(current.delete)}
                                    disabled={isAreaLocked}
                                    onChange={(e) => {
                                      const checked = e.target.checked;
                                      setEditPermissions((prev) => ({
                                        ...prev,
                                        [area.key]: {
                                          ...(prev[area.key] || {
                                            create: false,
                                            read: false,
                                            update: false,
                                            delete: false,
                                          }),
                                          delete: checked,
                                        },
                                      }));
                                    }}
                                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                                  />
                                  {!isAreaLocked && current.delete !== defaults.delete && (
                                    <span className="block text-[9px] font-bold text-amber-700 mt-0.5 leading-none">
                                      Changed
                                    </span>
                                  )}
                                </div>
                              </td>

                              {/* DEFAULT Column */}
                              <td className="py-2.5 px-3 align-middle text-slate-600 font-medium">
                                {area.adminOnly &&
                                editRole.toUpperCase() !== 'OWNER' &&
                                editRole.toUpperCase() !== 'ADMIN' ? (
                                  <span className="inline-flex items-center gap-1 text-slate-400 text-xs font-medium">
                                    <Lock className="w-3 h-3 text-slate-400 stroke-[2]" />
                                    Admin or Owner only
                                  </span>
                                ) : (
                                  <span className="text-xs text-slate-600">{defaultLabel}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Bottom Note */}
                <div className="text-[11px] text-slate-500 leading-relaxed">
                  Permissions apply only inside {firstName}&apos;s stores, teams and languages from Role & access. To give someone settings or billing rights, change their role to Admin.
                </div>
              </div>
            )}
          </div>

          {/* Sticky Footer */}
          <div className="flex items-center justify-between pt-3 mt-2 border-t border-slate-200 shrink-0">
            {editTab === 'role' ? (
              <div>
                {(!isEditReadOnly || (isActorOwner && isEditingMemberOwner && ownerCount > 1)) &&
                  !isEditingSelf &&
                  canDeleteMember && (
                  <button
                    type="button"
                    onClick={() => {
                      if (editingMember) {
                        if (isEditingMemberOwner && ownerCount <= 1) {
                          gooeyToast.error('Cannot remove the only Owner', {
                            description: 'At least one Owner is required per workspace.',
                          });
                          return;
                        }
                        setIsEditOpen(false);
                        handleDeleteMember(editingMember);
                      }
                    }}
                    className="text-xs font-semibold text-red-600 hover:text-red-700 cursor-pointer transition-colors"
                  >
                    Remove from workspace
                  </button>
                )}
              </div>
            ) : (
              <div className="text-xs text-slate-600 min-w-0 pr-3">
                {isEditingMemberOwner ? (
                  <span className="text-slate-500">Full access across all workspace areas</span>
                ) : editDiff.totalChanges > 0 ? (
                  <span className="font-medium text-slate-700 truncate block">
                    <strong className="text-slate-900">
                      {editDiff.totalChanges} {editDiff.totalChanges === 1 ? 'change' : 'changes'}
                    </strong>{' '}
                    from {editRole.charAt(0) + editRole.slice(1).toLowerCase()}: {editDiff.summaryText}
                  </span>
                ) : (
                  <span className="text-slate-400">
                    Standard {editRole.charAt(0) + editRole.slice(1).toLowerCase()} permissions
                  </span>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 shrink-0 ml-auto">
              {isEditReadOnly ? (
                <button
                  type="button"
                  onClick={() => {
                    setIsEditOpen(false);
                    setEditingMember(null);
                  }}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 cursor-pointer transition-colors"
                >
                  Close
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditOpen(false);
                      setEditingMember(null);
                    }}
                    className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingEdit}
                    className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-[#1e2a78] hover:bg-[#16205e] disabled:opacity-50 text-white text-xs font-semibold cursor-pointer shadow-sm transition-all"
                  >
                    {isSubmittingEdit && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Save changes
                  </button>
                </>
              )}
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default TeamRolesSection;



