'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import apiClient from '@/lib/api/client';
import { useAuth } from '@/context/AuthContext';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { Modal } from '@/components/ui/Modal';
import {
  Plus,
  Users,
  MoreHorizontal,
  Lock,
  Check,
  Shield,
  Mail,
  UserCheck,
  Trash2,
  Edit3,
  Loader2,
  Sparkles,
  ChevronRight,
  UserX,
  AlertCircle,
  RefreshCw,
  Copy,
  Clock,
  ArrowUpRight,
  Store,
  Globe,
  Sliders,
  Send,
  Zap,
  CheckCircle2,
  X,
  ChevronDown,
  LayoutGrid,
  Inbox,
  Bot,
  Megaphone,
  FileText,
  BarChart3,
  Plug,
  Settings,
  RotateCcw,
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

export function getDefaultPagePermissions(role: string): Record<string, PageCrudPermissions> {
  const norm = (role || 'AGENT').toUpperCase();
  const result: Record<string, PageCrudPermissions> = {};

  WORKSPACE_PAGES.forEach((page) => {
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

export function getMemberPagePermissions(member: TeamMember): Record<string, PageCrudPermissions> {
  const defaults = getDefaultPagePermissions(member.role);
  const stored = (member.customPermissions as any)?.pagePermissions;
  if (!stored || typeof stored !== 'object') {
    return defaults;
  }
  const merged: Record<string, PageCrudPermissions> = { ...defaults };
  WORKSPACE_PAGES.forEach((page) => {
    if (stored[page.key]) {
      merged[page.key] = {
        create: Boolean(stored[page.key].create),
        read: Boolean(stored[page.key].read),
        update: Boolean(stored[page.key].update),
        delete: Boolean(stored[page.key].delete),
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

function getInitials(name: string) {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getAvatarColor(name: string) {
  const colors = [
    'bg-indigo-50 text-indigo-700 border-indigo-200',
    'bg-emerald-50 text-emerald-700 border-emerald-200',
    'bg-amber-50 text-amber-800 border-amber-200',
    'bg-rose-50 text-rose-700 border-rose-200',
    'bg-sky-50 text-sky-700 border-sky-200',
    'bg-purple-50 text-purple-700 border-purple-200',
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
  const roleUpper = (member.role || 'AGENT').toUpperCase();
  const isOwner = roleUpper === 'OWNER';

  const toggleCell = (pageKey: string, action: keyof PageCrudPermissions) => {
    if (!canManage || isSaving) return;
    const current = permissions[pageKey] || { create: false, read: false, update: false, delete: false };
    onChange({
      ...permissions,
      [pageKey]: {
        ...current,
        [action]: !current[action],
      },
    });
  };

  const toggleAllForPage = (pageKey: string) => {
    if (!canManage || isSaving) return;
    const current = permissions[pageKey] || { create: false, read: false, update: false, delete: false };
    const allChecked = current.create && current.read && current.update && current.delete;
    const nextVal = !allChecked;
    onChange({
      ...permissions,
      [pageKey]: { create: nextVal, read: nextVal, update: nextVal, delete: nextVal },
    });
  };

  const toggleAllForAction = (action: keyof PageCrudPermissions) => {
    if (!canManage || isSaving) return;
    const allChecked = WORKSPACE_PAGES.every((p) => permissions[p.key]?.[action]);
    const nextVal = !allChecked;
    const updated = { ...permissions };
    WORKSPACE_PAGES.forEach((p) => {
      updated[p.key] = {
        ...(updated[p.key] || { create: false, read: false, update: false, delete: false }),
        [action]: nextVal,
      };
    });
    onChange(updated);
  };

  const applyPreset = (preset: 'all' | 'readOnly' | 'defaults' | 'clear') => {
    if (!canManage || isSaving) return;
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
      const perm = permissions[p.key];
      if (perm?.create) count++;
      if (perm?.read) count++;
      if (perm?.update) count++;
      if (perm?.delete) count++;
    });
    return count;
  }, [permissions]);

  const totalPossible = WORKSPACE_PAGES.length * 4;

  const isAllCreate = WORKSPACE_PAGES.every((p) => permissions[p.key]?.create);
  const isAllRead = WORKSPACE_PAGES.every((p) => permissions[p.key]?.read);
  const isAllUpdate = WORKSPACE_PAGES.every((p) => permissions[p.key]?.update);
  const isAllDelete = WORKSPACE_PAGES.every((p) => permissions[p.key]?.delete);

  return (
    <div className="space-y-4">
      {/* Top Banner & Presets */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-900 text-sm">
              Page Permissions: <span className="text-[#1e2a78]">{member.name}</span>
            </span>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#eef0fb] text-[#1e2a78] uppercase">
              {roleUpper}
            </span>
            {hasCustomPagePermissions(member) && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 text-purple-700">
                Custom Overrides Active
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Configure individual Create, Read, Update, and Delete permissions across all pages for this user.
          </p>
        </div>

        {/* Preset Toolbar */}
        {canManage && (
          <div className="flex items-center flex-wrap gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => applyPreset('all')}
              className="px-2.5 py-1 text-xs font-semibold bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg cursor-pointer transition-colors shadow-2xs"
            >
              Grant All
            </button>
            <button
              type="button"
              onClick={() => applyPreset('readOnly')}
              className="px-2.5 py-1 text-xs font-semibold bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg cursor-pointer transition-colors shadow-2xs"
            >
              Read Only
            </button>
            <button
              type="button"
              onClick={() => applyPreset('defaults')}
              className="px-2.5 py-1 text-xs font-semibold bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg cursor-pointer transition-colors shadow-2xs flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3 text-slate-500" />
              Role Defaults
            </button>
            <button
              type="button"
              onClick={() => applyPreset('clear')}
              className="px-2.5 py-1 text-xs font-semibold bg-white border border-slate-200 hover:border-red-200 hover:bg-red-50 text-slate-600 hover:text-red-600 rounded-lg cursor-pointer transition-colors shadow-2xs"
            >
              Clear All
            </button>
          </div>
        )}
      </div>

      {isOwner && (
        <div className="p-3 bg-amber-50/80 border border-amber-200/80 rounded-xl flex items-center gap-2 text-xs text-amber-900">
          <Shield className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            <strong>Workspace Owner:</strong> Owners inherently have unrestricted access across all pages. You may configure custom page flags or keep standard ownership.
          </span>
        </div>
      )}

      {/* Pages CRUD Matrix Table */}
      <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white shadow-2xs">
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
              <th className="py-2.5 px-4 font-semibold w-2/5">Page / Module</th>
              
              {/* CREATE Column */}
              <th className="py-2.5 px-3 text-center font-semibold">
                <div className="flex flex-col items-center gap-1">
                  <span className="text-slate-700 font-bold">CREATE</span>
                  {canManage && (
                    <label className="cursor-pointer inline-flex items-center" title="Toggle all Create permissions">
                      <input
                        type="checkbox"
                        checked={isAllCreate}
                        disabled={!canManage || isSaving}
                        onChange={() => toggleAllForAction('create')}
                        className="w-3.5 h-3.5 rounded text-[#1e2a78] border-slate-300 focus:ring-[#1e2a78] cursor-pointer"
                      />
                    </label>
                  )}
                </div>
              </th>

              {/* READ Column */}
              <th className="py-2.5 px-3 text-center font-semibold">
                <div className="flex flex-col items-center gap-1">
                  <span className="text-slate-700 font-bold">READ</span>
                  {canManage && (
                    <label className="cursor-pointer inline-flex items-center" title="Toggle all Read permissions">
                      <input
                        type="checkbox"
                        checked={isAllRead}
                        disabled={!canManage || isSaving}
                        onChange={() => toggleAllForAction('read')}
                        className="w-3.5 h-3.5 rounded text-[#1e2a78] border-slate-300 focus:ring-[#1e2a78] cursor-pointer"
                      />
                    </label>
                  )}
                </div>
              </th>

              {/* UPDATE Column */}
              <th className="py-2.5 px-3 text-center font-semibold">
                <div className="flex flex-col items-center gap-1">
                  <span className="text-slate-700 font-bold">UPDATE</span>
                  {canManage && (
                    <label className="cursor-pointer inline-flex items-center" title="Toggle all Update permissions">
                      <input
                        type="checkbox"
                        checked={isAllUpdate}
                        disabled={!canManage || isSaving}
                        onChange={() => toggleAllForAction('update')}
                        className="w-3.5 h-3.5 rounded text-[#1e2a78] border-slate-300 focus:ring-[#1e2a78] cursor-pointer"
                      />
                    </label>
                  )}
                </div>
              </th>

              {/* DELETE Column */}
              <th className="py-2.5 px-3 text-center font-semibold">
                <div className="flex flex-col items-center gap-1">
                  <span className="text-slate-700 font-bold">DELETE</span>
                  {canManage && (
                    <label className="cursor-pointer inline-flex items-center" title="Toggle all Delete permissions">
                      <input
                        type="checkbox"
                        checked={isAllDelete}
                        disabled={!canManage || isSaving}
                        onChange={() => toggleAllForAction('delete')}
                        className="w-3.5 h-3.5 rounded text-[#1e2a78] border-slate-300 focus:ring-[#1e2a78] cursor-pointer"
                      />
                    </label>
                  )}
                </div>
              </th>

              {/* Row Toggle */}
              <th className="py-2.5 px-4 text-center font-semibold text-slate-500">Row</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {WORKSPACE_PAGES.map((page) => {
              const Icon = page.icon;
              const perm = permissions[page.key] || { create: false, read: false, update: false, delete: false };
              const isRowAll = perm.create && perm.read && perm.update && perm.delete;
              const isRowNone = !perm.create && !perm.read && !perm.update && !perm.delete;

              return (
                <tr key={page.key} className="hover:bg-slate-50/80 transition-colors">
                  {/* Page / Module info */}
                  <td className="py-3 px-4">
                    <div className="flex items-start gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-indigo-50/80 border border-indigo-100 flex items-center justify-center shrink-0 mt-0.5 text-[#1e2a78]">
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900 text-xs">{page.label}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-medium">
                            {page.category}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 truncate max-w-sm">{page.description}</p>
                      </div>
                    </div>
                  </td>

                  {/* Create Checkbox */}
                  <td className="py-3 px-3 text-center">
                    <label className="inline-flex items-center justify-center cursor-pointer p-1">
                      <input
                        type="checkbox"
                        checked={Boolean(perm.create)}
                        disabled={!canManage || isSaving}
                        onChange={() => toggleCell(page.key, 'create')}
                        className="w-4 h-4 rounded text-[#1e2a78] border-slate-300 focus:ring-[#1e2a78] cursor-pointer disabled:cursor-not-allowed"
                      />
                    </label>
                  </td>

                  {/* Read Checkbox */}
                  <td className="py-3 px-3 text-center">
                    <label className="inline-flex items-center justify-center cursor-pointer p-1">
                      <input
                        type="checkbox"
                        checked={Boolean(perm.read)}
                        disabled={!canManage || isSaving}
                        onChange={() => toggleCell(page.key, 'read')}
                        className="w-4 h-4 rounded text-[#1e2a78] border-slate-300 focus:ring-[#1e2a78] cursor-pointer disabled:cursor-not-allowed"
                      />
                    </label>
                  </td>

                  {/* Update Checkbox */}
                  <td className="py-3 px-3 text-center">
                    <label className="inline-flex items-center justify-center cursor-pointer p-1">
                      <input
                        type="checkbox"
                        checked={Boolean(perm.update)}
                        disabled={!canManage || isSaving}
                        onChange={() => toggleCell(page.key, 'update')}
                        className="w-4 h-4 rounded text-[#1e2a78] border-slate-300 focus:ring-[#1e2a78] cursor-pointer disabled:cursor-not-allowed"
                      />
                    </label>
                  </td>

                  {/* Delete Checkbox */}
                  <td className="py-3 px-3 text-center">
                    <label className="inline-flex items-center justify-center cursor-pointer p-1">
                      <input
                        type="checkbox"
                        checked={Boolean(perm.delete)}
                        disabled={!canManage || isSaving}
                        onChange={() => toggleCell(page.key, 'delete')}
                        className="w-4 h-4 rounded text-[#1e2a78] border-slate-300 focus:ring-[#1e2a78] cursor-pointer disabled:cursor-not-allowed"
                      />
                    </label>
                  </td>

                  {/* Row toggle button */}
                  <td className="py-3 px-4 text-center">
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => toggleAllForPage(page.key)}
                        disabled={isSaving}
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded transition-colors cursor-pointer ${
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
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Action Footer Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500 font-medium">
            <strong>{countGranted}</strong> of <strong>{totalPossible}</strong> permissions granted
          </span>
          <div className="w-24 bg-slate-200 h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-[#1e2a78] h-full rounded-full transition-all duration-300"
              style={{ width: `${Math.round((countGranted / totalPossible) * 100)}%` }}
            />
          </div>
        </div>

        <div className="flex items-center gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg cursor-pointer transition-colors"
          >
            {isModal ? 'Close' : 'Collapse'}
          </button>

          {canManage && (
            <button
              type="button"
              onClick={onSave}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1e2a78] hover:bg-[#16205e] disabled:opacity-50 text-white text-xs font-semibold cursor-pointer shadow-sm transition-all"
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
  const [permissions, setPermissions] = useState<RolePermissionsMatrix | null>(null);
  const [currentRole, setCurrentRole] = useState<string>('ADMIN');
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingPermissions, setIsSavingPermissions] = useState(false);

  // Tabs state: 'members' | 'invitations'
  const [activeTab, setActiveTab] = useState<'members' | 'invitations'>('members');

  // Modals state
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isUpgradeOpen, setIsUpgradeOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [activeMenuMemberId, setActiveMenuMemberId] = useState<number | null>(null);
  const [activeInviteMenuId, setActiveInviteMenuId] = useState<number | null>(null);

  // Page CRUD permissions state
  const [expandedMemberId, setExpandedMemberId] = useState<number | null>(null);
  const [memberPermissionsDraft, setMemberPermissionsDraft] = useState<Record<string, PageCrudPermissions>>({});
  const [isSavingMemberPermissions, setIsSavingMemberPermissions] = useState(false);
  const [permissionsModalMember, setPermissionsModalMember] = useState<TeamMember | null>(null);

  // Multi-email invite form state
  const [emailInput, setEmailInput] = useState('');
  const [emailChips, setEmailChips] = useState<string[]>([]);
  const [inviteRole, setInviteRole] = useState<'ADMIN' | 'AGENT' | 'VIEWER'>('AGENT');
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
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);

  // Upgrading state
  const [isUpgrading, setIsUpgrading] = useState(false);

  const fetchTeamData = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await apiClient.get('/api/team');
      if (res.data?.success) {
        setMembers(res.data.members || []);
        if (res.data.pendingInvitations) setPendingInvitations(res.data.pendingInvitations);
        if (res.data.stores) setStores(res.data.stores);
        if (res.data.seats) setSeats(res.data.seats);
        if (res.data.permissions) setPermissions(res.data.permissions);
        if (res.data.currentRole) setCurrentRole(res.data.currentRole);
      }
    } catch (err: any) {
      gooeyToast.error('Failed to load team and roles', { description: err.message });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTeamData();
  }, [fetchTeamData]);

  // Close menus on outside click
  useEffect(() => {
    const handleClickOutside = () => {
      setActiveMenuMemberId(null);
      setActiveInviteMenuId(null);
    };
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  const { hasPermission, dbUser, refreshDbUser, can } = useAuth();
  const canManageBilling = hasPermission('manage_billing_and_integrations');

  const canManage = useMemo(() => {
    const norm = currentRole.toUpperCase();
    return norm === 'OWNER' || norm === 'ADMIN';
  }, [currentRole]);

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

  // Open edit modal for member
  const handleOpenEdit = (member: TeamMember) => {
    setEditingMember(member);
    setEditName(member.name);
    setEditRole(member.role);
    setEditTeams(member.teams || []);
    setEditLanguages(member.languages || ['EN']);
    setEditStores(member.stores || []);
    setEditStatus(member.status || 'active');
    setIsEditOpen(true);
  };

  // Handle saving edited member
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMember) return;

    try {
      setIsSubmittingEdit(true);
      const res = await apiClient.patch(`/api/team/${editingMember.id}`, {
        name: editName.trim(),
        role: editRole,
        teams: editTeams,
        languages: editLanguages,
        stores: editStores,
        status: editStatus,
      });

      if (res.data?.success) {
        gooeyToast.success(`Updated ${editingMember.name}`);
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

  // Handle removing a member
  const handleDeleteMember = async (member: TeamMember) => {
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

  // Handle toggling expandable member permissions row
  const handleToggleMemberPermissions = (member: TeamMember) => {
    if (expandedMemberId === member.id) {
      setExpandedMemberId(null);
    } else {
      setExpandedMemberId(member.id);
      setMemberPermissionsDraft(getMemberPagePermissions(member));
    }
  };

  // Handle opening dedicated permissions modal
  const handleOpenPermissionsModal = (member: TeamMember) => {
    setPermissionsModalMember(member);
    setMemberPermissionsDraft(getMemberPagePermissions(member));
  };

  // Handle saving member's page CRUD permissions
  const handleSaveMemberPermissions = async (
    member: TeamMember,
    permissionsToSave: Record<string, PageCrudPermissions>
  ) => {
    try {
      setIsSavingMemberPermissions(true);
      const existingCustom = (member.customPermissions as Record<string, any>) || {};
      const updatedCustom = {
        ...existingCustom,
        pagePermissions: permissionsToSave,
      };

      const res = await apiClient.patch(`/api/team/${member.id}`, {
        customPermissions: updatedCustom,
      });

      if (res.data?.success) {
        gooeyToast.success(`Page permissions saved for ${member.name}`);
        if (dbUser && (member.id === dbUser.id || member.email === dbUser.email)) {
          refreshDbUser();
        }
        setMembers((prev) =>
          prev.map((m) =>
            m.id === member.id
              ? { ...m, customPermissions: updatedCustom }
              : m
          )
        );
      }
    } catch (err: any) {
      gooeyToast.error('Failed to save permissions', {
        description: err.response?.data?.message || err.message,
      });
    } finally {
      setIsSavingMemberPermissions(false);
    }
  };

  // Handle toggling permission matrix checkboxes
  const handleTogglePermission = async (role: 'ADMIN' | 'AGENT' | 'VIEWER', permissionKey: string) => {
    if (!canManage || !permissions) return;

    const currentVal = Boolean(permissions[role]?.[permissionKey]);
    const updatedPermissions: RolePermissionsMatrix = {
      ...permissions,
      [role]: {
        ...permissions[role],
        [permissionKey]: !currentVal,
      },
    };

    setPermissions(updatedPermissions);

    try {
      setIsSavingPermissions(true);
      await apiClient.patch('/api/team/permissions', { permissions: updatedPermissions });
      gooeyToast.success('Permissions updated');
    } catch (err: any) {
      gooeyToast.error('Failed to update permissions', { description: err.message });
      setPermissions(permissions);
    } finally {
      setIsSavingPermissions(false);
    }
  };

  // Handle resetting permissions to defaults
  const handleResetPermissions = async () => {
    if (!canManage) return;
    if (!confirm('Reset all role permissions to standard defaults?')) return;
    try {
      setIsSavingPermissions(true);
      const res = await apiClient.patch('/api/team/permissions', { reset: true });
      if (res.data?.success && res.data.permissions) {
        setPermissions(res.data.permissions);
        gooeyToast.success('Role permissions reset to defaults');
      }
    } catch (err: any) {
      gooeyToast.error('Failed to reset permissions', { description: err.message });
    } finally {
      setIsSavingPermissions(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-8 py-4 space-y-8 pb-16 font-sans">
      {/* Top Header & Breadcrumb */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium mb-1">
            <span>Settings</span>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-slate-700">Team & roles</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Team & roles</h1>
        </div>

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
              title={!canCreateMember ? "You do not have permission to invite team members" : undefined}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold shadow-sm transition-all shrink-0 ${canCreateMember ? 'bg-[#1e2a78] hover:bg-[#16205e] text-white cursor-pointer' : 'bg-slate-100 text-slate-400 cursor-not-allowed opacity-60'}`}
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              Invite member
              {!canCreateMember && <Lock className="w-3.5 h-3.5 ml-1 text-slate-400" />}
            </button>
          </div>
        )}
      </div>

      {/* ─── Plan & Seats Overview Banner ────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900">Workspace plan & seats</h2>
              <span className="px-2.5 py-0.5 rounded-full bg-[#eef0fb] text-[#1e2a78] font-bold text-xs uppercase tracking-wider">
                {seats.plan} Plan
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium">
              <strong>{seats.used} of {seats.total} seats used</strong> on the {seats.plan} plan
              {isSeatLimitReached ? (
                <span className="text-amber-700 font-semibold ml-1.5">· Limit reached</span>
              ) : (
                <span className="text-slate-400 ml-1.5">· {availableSeats} seat(s) available</span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="w-36 bg-slate-100 h-2.5 rounded-full overflow-hidden border border-slate-200">
              <div
                className={`h-full transition-all duration-500 rounded-full ${
                  isSeatLimitReached
                    ? 'bg-amber-500'
                    : seatsPercentage > 75
                      ? 'bg-indigo-600'
                      : 'bg-[#1e2a78]'
                }`}
                style={{ width: `${seatsPercentage}%` }}
              />
            </div>

            {canManageBilling && (
              <button
                type="button"
                onClick={() => setIsUpgradeOpen(true)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold cursor-pointer transition-colors flex items-center gap-1 shrink-0"
              >
                <ArrowUpRight className="w-3.5 h-3.5 text-slate-500" />
                Upgrade path
              </button>
            )}
          </div>
        </div>

        {/* Limit Warning Notice if full */}
        {isSeatLimitReached && (
          <div className="mt-4 p-3 bg-amber-50/70 border border-amber-200/80 rounded-xl flex items-center justify-between gap-3 text-xs text-amber-900">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                All <strong>{seats.total} seats</strong> on your current plan have been allocated. {canManageBilling ? 'Upgrade to Pro (25 seats) or Enterprise to invite more teammates.' : 'Contact an administrator with billing permissions to upgrade.'}
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

      {/* ─── Members Card & Tabs ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        {/* Table Tabs Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => setActiveTab('members')}
              className={`text-sm font-bold pb-1 border-b-2 transition-colors cursor-pointer flex items-center gap-2 ${
                activeTab === 'members'
                  ? 'border-[#1e2a78] text-[#1e2a78]'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Users className="w-4 h-4" />
              Team members
              <span className="ml-1 px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600 font-semibold">
                {members.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('invitations')}
              className={`text-sm font-bold pb-1 border-b-2 transition-colors cursor-pointer flex items-center gap-2 ${
                activeTab === 'invitations'
                  ? 'border-[#1e2a78] text-[#1e2a78]'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Mail className="w-4 h-4" />
              Pending invitations
              {pendingInvitations.length > 0 && (
                <span className="ml-1 px-2 py-0.5 rounded-full text-xs bg-indigo-100 text-indigo-700 font-bold">
                  {pendingInvitations.length}
                </span>
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={fetchTeamData}
            title="Refresh team data"
            className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50 cursor-pointer transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* ── Tab 1: Active Team Members Table ── */}
        {activeTab === 'members' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50/50">
                  <th className="py-3 px-6 font-semibold">Member</th>
                  <th className="py-3 px-6 font-semibold">Role</th>
                  <th className="py-3 px-6 font-semibold">Permissions</th>
                  <th className="py-3 px-6 font-semibold">Stores</th>
                  <th className="py-3 px-6 font-semibold">Teams</th>
                  <th className="py-3 px-6 font-semibold">Languages</th>
                  <th className="py-3 px-6 font-semibold">Status</th>
                  <th className="py-3 px-6 text-right font-semibold"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-xs text-slate-400">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto text-[#1e2a78] mb-2" />
                      Loading team members…
                    </td>
                  </tr>
                ) : members.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-xs text-slate-400">
                      No team members found.
                    </td>
                  </tr>
                ) : (
                  members.map((member) => {
                    const roleNormalized = member.role.toUpperCase();
                    const statusLower = (member.status || '').toLowerCase();
                    const isOnline = member.isOnline || statusLower === 'online' || statusLower === 'active';
                    const isAway = statusLower === 'away';
                    const isInvited = statusLower === 'invited';
                    const isExpanded = expandedMemberId === member.id;
                    const hasCustom = hasCustomPagePermissions(member);

                    return (
                      <React.Fragment key={member.id}>
                        <tr className={`transition-colors ${isExpanded ? 'bg-indigo-50/40' : 'hover:bg-slate-50/70'}`}>
                          {/* Member */}
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-3">
                              <div
                                className={`w-9 h-9 rounded-full border flex items-center justify-center font-bold text-xs shrink-0 ${getAvatarColor(
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
                                <p className="font-semibold text-slate-900 text-[13.5px] truncate">{member.name}</p>
                                <p className="text-xs text-slate-500 truncate">{member.email}</p>
                              </div>
                            </div>
                          </td>

                          {/* Role */}
                          <td className="py-4 px-6">
                            <button
                              type="button"
                              onClick={() => handleToggleMemberPermissions(member)}
                              className="flex items-center gap-1.5 text-left group cursor-pointer"
                              title="Click to view & configure permissions for this role"
                            >
                              <span className="text-[13px] font-semibold text-slate-800 group-hover:text-[#1e2a78] transition-colors">
                                {roleNormalized.charAt(0) + roleNormalized.slice(1).toLowerCase()}
                              </span>
                              {member.twoFactorEnabled && (
                                <span title="2-Step Verification Enabled">
                                  <Shield className="w-3.5 h-3.5 text-emerald-600" />
                                </span>
                              )}
                            </button>
                          </td>

                          {/* Permissions */}
                          <td className="py-4 px-6">
                            <button
                              type="button"
                              onClick={() => handleToggleMemberPermissions(member)}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer shadow-2xs ${
                                isExpanded
                                  ? 'bg-[#1e2a78] text-white ring-2 ring-[#1e2a78]/30'
                                  : hasCustom
                                    ? 'bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200'
                                    : 'bg-indigo-50/80 hover:bg-indigo-100 text-[#1e2a78] border border-indigo-200/70'
                              }`}
                              title="Click to view & configure page-by-page Create, Read, Update, and Delete permissions"
                            >
                              <Sliders className="w-3.5 h-3.5" />
                              <span>{hasCustom ? 'Custom CRUD' : 'Permissions'}</span>
                              <ChevronDown
                                className={`w-3.5 h-3.5 transition-transform duration-200 ${
                                  isExpanded ? 'rotate-180' : ''
                                }`}
                              />
                            </button>
                          </td>

                          {/* Stores */}
                          <td className="py-4 px-6 text-xs text-slate-600">
                            {member.stores && member.stores.length > 0 ? (
                              <span className="truncate max-w-[140px] block" title={member.stores.join(', ')}>
                                {member.stores.join(' · ')}
                              </span>
                            ) : (
                              <span className="text-slate-400">All</span>
                            )}
                          </td>

                          {/* Teams */}
                          <td className="py-4 px-6 text-xs text-slate-600">
                            {member.teams && member.teams.length > 0 ? (
                              <span>{member.teams.join(' · ')}</span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>

                          {/* Languages */}
                          <td className="py-4 px-6 text-xs text-slate-600 font-medium">
                            {member.languages && member.languages.length > 0 ? (
                              <span>{member.languages.join(' · ')}</span>
                            ) : (
                              <span className="text-slate-400">EN</span>
                            )}
                          </td>

                          {/* Status */}
                          <td className="py-4 px-6">
                            <div className="inline-flex items-center gap-1.5 text-xs font-medium">
                              {isInvited ? (
                                <>
                                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                                  <span className="text-blue-700">Invited</span>
                                </>
                              ) : isAway ? (
                                <>
                                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                                  <span className="text-amber-800">Away</span>
                                </>
                              ) : isOnline ? (
                                <>
                                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                                  <span className="text-emerald-700">{statusLower === 'online' ? 'Online' : 'Active'}</span>
                                </>
                              ) : (
                                <>
                                  <span className="w-2 h-2 rounded-full bg-slate-300" />
                                  <span className="text-slate-500">Offline</span>
                                </>
                              )}
                            </div>
                          </td>

                          {/* Action Menu */}
                          <td className="py-4 px-6 text-right relative">
                            {canManage && (
                              <div className="inline-block text-left" onClick={(e) => e.stopPropagation()}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setActiveMenuMemberId(activeMenuMemberId === member.id ? null : member.id)
                                  }
                                  className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                                >
                                  <MoreHorizontal className="w-4 h-4" />
                                </button>

                                {activeMenuMemberId === member.id && (
                                  <div className="absolute right-6 top-10 w-48 bg-white border border-slate-200 rounded-xl shadow-xl p-1 z-30 text-xs">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setActiveMenuMemberId(null);
                                        handleOpenPermissionsModal(member);
                                      }}
                                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-indigo-50 text-[#1e2a78] font-medium text-left cursor-pointer"
                                    >
                                      <Sliders className="w-3.5 h-3.5 text-[#1e2a78]" />
                                      Page permissions (CRUD)
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => {
                                        setActiveMenuMemberId(null);
                                        handleOpenEdit(member);
                                      }}
                                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-50 text-slate-700 text-left cursor-pointer"
                                    >
                                      <Edit3 className="w-3.5 h-3.5 text-slate-500" />
                                      Edit details & role
                                    </button>

                                    {isInvited && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setActiveMenuMemberId(null);
                                          handleResendInvite(0, member.email);
                                        }}
                                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-50 text-slate-700 text-left cursor-pointer"
                                      >
                                        <Send className="w-3.5 h-3.5 text-indigo-600" />
                                        Resend invitation
                                      </button>
                                    )}

                                    {member.role !== 'OWNER' && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setActiveMenuMemberId(null);
                                          handleDeleteMember(member);
                                        }}
                                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-red-50 text-red-600 text-left cursor-pointer"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        Remove member
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>

                        {/* Inline Page CRUD Permissions Expansion Row */}
                        {isExpanded && (
                          <tr className="bg-slate-50/95 border-b-2 border-indigo-200">
                            <td colSpan={8} className="p-0">
                              <div className="p-5 border-l-4 border-[#1e2a78] bg-slate-50/95 shadow-inner">
                                <PagePermissionsMatrix
                                  member={member}
                                  permissions={memberPermissionsDraft}
                                  onChange={setMemberPermissionsDraft}
                                  onSave={() => handleSaveMemberPermissions(member, memberPermissionsDraft)}
                                  onClose={() => setExpandedMemberId(null)}
                                  isSaving={isSavingMemberPermissions}
                                  canManage={canUpdateMember}
                                  isModal={false}
                                />
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
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
                <tr className="border-b border-slate-100 text-[11px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50/50">
                  <th className="py-3 px-6 font-semibold">Invited Email</th>
                  <th className="py-3 px-6 font-semibold">Role</th>
                  <th className="py-3 px-6 font-semibold">Stores</th>
                  <th className="py-3 px-6 font-semibold">Teams</th>
                  <th className="py-3 px-6 font-semibold">Expires In</th>
                  <th className="py-3 px-6 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pendingInvitations.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-xs text-slate-400">
                      No pending invitations. All invited members have joined!
                    </td>
                  </tr>
                ) : (
                  pendingInvitations.map((inv) => {
                    const daysLeft = Math.max(
                      0,
                      Math.ceil((new Date(inv.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                    );

                    return (
                      <tr key={inv.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-4 px-6">
                          <div>
                            <span className="font-semibold text-slate-900 text-[13px]">{inv.email}</span>
                            <p className="text-[11px] text-slate-400">
                              Invited by {inv.inviterName || 'Admin'}
                            </p>
                          </div>
                        </td>

                        <td className="py-4 px-6">
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 font-semibold text-xs text-slate-700 uppercase">
                            {inv.role}
                          </span>
                        </td>

                        <td className="py-4 px-6 text-xs text-slate-600">
                          {inv.stores && inv.stores.length > 0 ? inv.stores.join(' · ') : 'All'}
                        </td>

                        <td className="py-4 px-6 text-xs text-slate-600">
                          {inv.teams && inv.teams.length > 0 ? inv.teams.join(' · ') : 'Support'}
                        </td>

                        <td className="py-4 px-6 text-xs text-slate-600">
                          <span className="inline-flex items-center gap-1 text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full font-medium text-[11px]">
                            <Clock className="w-3 h-3" />
                            {daysLeft > 0 ? `${daysLeft} days` : 'Expiring soon'}
                          </span>
                        </td>

                        <td className="py-4 px-6 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => handleCopyInviteLink(inv.token, inv.email)}
                              title="Copy secure single-use invitation link"
                              className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                            >
                              <Copy className="w-3.5 h-3.5 text-slate-500" />
                              Copy link
                            </button>

                            <button
                              type="button"
                              onClick={() => handleResendInvite(inv.id, inv.email)}
                              title="Resend email with new 7-day token"
                              className="px-2.5 py-1 rounded-lg bg-[#1e2a78] hover:bg-[#16205e] text-white text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                            >
                              <Send className="w-3.5 h-3.5" />
                              Resend
                            </button>

                            <button
                              type="button"
                              onClick={() => handleRevokeInvite(inv.id, inv.email)}
                              title="Revoke invitation"
                              className="p-1 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 cursor-pointer transition-colors"
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

      {/* ─── Role Permissions Matrix Card ──────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
          <div>
            <h2 className="text-[16px] font-bold text-slate-900">Role permissions</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Owner always has every permission. Admin and Owner require 2-step verification before entering.
            </p>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={handleResetPermissions}
              disabled={isSavingPermissions}
              className="text-xs font-semibold text-[#1e2a78] hover:text-[#16205e] hover:bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
            >
              Reset to defaults
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-4 font-semibold w-1/2"></th>
                <th className="py-3 px-6 text-center font-semibold">OWNER</th>
                <th className="py-3 px-6 text-center font-semibold">ADMIN</th>
                <th className="py-3 px-6 text-center font-semibold">AGENT</th>
                <th className="py-3 px-6 text-center font-semibold">VIEWER</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {PERMISSION_ROWS.map(({ key, label }) => {
                const adminChecked = Boolean(permissions?.ADMIN?.[key]);
                const agentChecked = Boolean(permissions?.AGENT?.[key]);
                const viewerChecked = Boolean(permissions?.VIEWER?.[key]);

                return (
                  <tr key={key} className="hover:bg-slate-50/50 transition-colors">
                    <td className="py-3.5 px-4 text-[13px] text-slate-700 font-medium">{label}</td>

                    {/* OWNER (Always Locked 🔒) */}
                    <td className="py-3.5 px-6 text-center">
                      <div className="flex items-center justify-center">
                        <Lock className="w-4 h-4 text-slate-400 stroke-[2.2]" />
                      </div>
                    </td>

                    {/* ADMIN */}
                    <td className="py-3.5 px-6 text-center">
                      <label className="inline-flex items-center justify-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={adminChecked}
                          disabled={!canUpdateMember || isSavingPermissions}
                          onChange={() => handleTogglePermission('ADMIN', key)}
                          className="w-4 h-4 rounded text-[#1e2a78] border-slate-300 focus:ring-[#1e2a78] cursor-pointer disabled:cursor-not-allowed"
                        />
                      </label>
                    </td>

                    {/* AGENT */}
                    <td className="py-3.5 px-6 text-center">
                      <label className="inline-flex items-center justify-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={agentChecked}
                          disabled={!canUpdateMember || isSavingPermissions}
                          onChange={() => handleTogglePermission('AGENT', key)}
                          className="w-4 h-4 rounded text-[#1e2a78] border-slate-300 focus:ring-[#1e2a78] cursor-pointer disabled:cursor-not-allowed"
                        />
                      </label>
                    </td>

                    {/* VIEWER */}
                    <td className="py-3.5 px-6 text-center">
                      <label className="inline-flex items-center justify-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={viewerChecked}
                          disabled={!canUpdateMember || isSavingPermissions}
                          onChange={() => handleTogglePermission('VIEWER', key)}
                          className="w-4 h-4 rounded text-[#1e2a78] border-slate-300 focus:ring-[#1e2a78] cursor-pointer disabled:cursor-not-allowed"
                        />
                      </label>
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
                  <div className="grid grid-cols-3 gap-2">
                    {(['ADMIN', 'AGENT', 'VIEWER'] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setInviteRole(r)}
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
                    {inviteRole === 'ADMIN'
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

      {/* ─── Modal: Edit Member ────────────────────────────────────────────────── */}
      <Modal
        isOpen={isEditOpen}
        onClose={() => {
          setIsEditOpen(false);
          setEditingMember(null);
        }}
        title={`Edit ${editingMember?.name || 'Member'}`}
      >
        <form onSubmit={handleEditSubmit} className="space-y-4 pt-1">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Name</label>
            <input
              type="text"
              required
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:border-[#1e2a78] focus:ring-1 focus:ring-[#1e2a78]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Role</label>
            <div className="grid grid-cols-4 gap-1.5">
              {(['OWNER', 'ADMIN', 'AGENT', 'VIEWER'] as const).map((r) => {
                const isSelected = editRole.toUpperCase() === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setEditRole(r)}
                    className={`py-2 px-2 rounded-xl border text-xs font-semibold text-center cursor-pointer transition-colors ${
                      isSelected
                        ? 'border-[#1e2a78] bg-[#eef0fb] text-[#1e2a78]'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {r.charAt(0) + r.slice(1).toLowerCase()}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Stores</label>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setEditStores([])}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                  editStores.length === 0 ? 'bg-[#1e2a78] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                All Stores
              </button>
              {stores.map((s) => {
                const selected = editStores.includes(s.domain);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      const next = selected
                        ? editStores.filter((d) => d !== s.domain)
                        : [...editStores, s.domain];
                      setEditStores(next);
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

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Teams</label>
            <div className="flex flex-wrap gap-1.5">
              {AVAILABLE_TEAMS.map((team) => {
                const selected = editTeams.includes(team);
                return (
                  <button
                    key={team}
                    type="button"
                    onClick={() => {
                      if (team === 'All') {
                        setEditTeams(['All']);
                      } else {
                        const next = selected
                          ? editTeams.filter((t) => t !== team)
                          : [...editTeams.filter((t) => t !== 'All'), team];
                        setEditTeams(next.length === 0 ? ['Support'] : next);
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

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Languages</label>
            <div className="flex flex-wrap gap-1.5">
              {AVAILABLE_LANGUAGES.map((lang) => {
                const selected = editLanguages.includes(lang);
                return (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => {
                      const next = selected
                        ? editLanguages.filter((l) => l !== lang)
                        : [...editLanguages, lang];
                      setEditLanguages(next.length === 0 ? ['EN'] : next);
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

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Status</label>
            <select
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:border-[#1e2a78] focus:ring-1 focus:ring-[#1e2a78]"
            >
              <option value="active">Active</option>
              <option value="online">Online</option>
              <option value="away">Away</option>
              <option value="invited">Invited</option>
            </select>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
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
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1e2a78] hover:bg-[#16205e] disabled:opacity-50 text-white text-xs font-semibold cursor-pointer shadow-sm"
            >
              {isSubmittingEdit && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save changes
            </button>
          </div>
        </form>
      </Modal>

      {/* ─── Modal: Page Permissions (CRUD) ─────────────────────────────────────── */}
      <Modal
        isOpen={Boolean(permissionsModalMember)}
        onClose={() => setPermissionsModalMember(null)}
        title={`Page Permissions · ${permissionsModalMember?.name || 'Member'}`}
        maxWidth="2xl"
      >
        {permissionsModalMember && (
          <div className="pt-2">
            <PagePermissionsMatrix
              member={permissionsModalMember}
              permissions={memberPermissionsDraft}
              onChange={setMemberPermissionsDraft}
              onSave={async () => {
                await handleSaveMemberPermissions(permissionsModalMember, memberPermissionsDraft);
                setPermissionsModalMember(null);
              }}
              onClose={() => setPermissionsModalMember(null)}
              isSaving={isSavingMemberPermissions}
              canManage={canUpdateMember}
              isModal={true}
            />
          </div>
        )}
      </Modal>
    </div>
  );
};

export default TeamRolesSection;



