'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Building2, CalendarDays, Check, Copy, Hash, Loader2, Lock, Pencil } from 'lucide-react';

import apiClient from '@/lib/api/client';
import { notifyError } from '@/lib/api/notify';
import { useAuth } from '@/context/AuthContext';
import { gooeyToast } from '@/components/ui/goey-toaster';

/** Keep in sync with WORKSPACE_NAME_MIN / WORKSPACE_NAME_MAX in organization.service.ts */
const NAME_MIN = 2;
const NAME_MAX = 100;

interface WorkspaceDetails {
  id: number;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
      {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px] text-slate-600 mb-2">{children}</p>;
}

function ReadOnlyBox({ icon, children, copyValue }: { icon?: React.ReactNode; children: React.ReactNode; copyValue?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!copyValue) return;
    try {
      await navigator.clipboard.writeText(copyValue);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable; nothing to do */
    }
  };

  return (
    <div className="flex items-center gap-2 h-10 px-3 rounded-lg border border-slate-200 bg-slate-50 text-[13px] text-slate-800">
      {icon && <span className="text-slate-400 shrink-0">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {copyValue ? (
        <button
          type="button"
          onClick={copy}
          title="Copy"
          className="text-slate-400 hover:text-slate-700 shrink-0 cursor-pointer"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      ) : (
        <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      )}
    </div>
  );
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** Settings → General: workspace details, with the name editable by owners and admins. */
export function GeneralSection() {
  const { refreshDbUser } = useAuth();
  const [workspace, setWorkspace] = useState<WorkspaceDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const res = await apiClient.get<{ workspace: WorkspaceDetails }>('/api/settings/workspace');
      setWorkspace(res.data.workspace);
    } catch (err) {
      setLoadFailed(true);
      notifyError(err, { where: 'GeneralSection.load', title: "Couldn't load workspace details" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const trimmedName = draftName.trim().replace(/\s+/g, ' ');
  const nameError =
    trimmedName.length < NAME_MIN
      ? `Name must be at least ${NAME_MIN} characters.`
      : trimmedName.length > NAME_MAX
        ? `Name must be at most ${NAME_MAX} characters.`
        : null;
  const nameChanged = !!workspace && trimmedName !== workspace.name;

  const startEdit = () => {
    if (!workspace) return;
    setDraftName(workspace.name);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraftName('');
  };

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!workspace || nameError || !nameChanged || saving) return;
    setSaving(true);
    try {
      const res = await apiClient.patch<{ workspace: WorkspaceDetails }>('/api/settings/workspace', { name: trimmedName });
      setWorkspace(res.data.workspace);
      setEditing(false);
      gooeyToast.success('Workspace details updated');
      // The sidebar shows the workspace name from the signed-in user's record
      refreshDbUser().catch(() => {});
    } catch (err) {
      notifyError(err, { where: 'GeneralSection.save', title: "Couldn't update workspace" });
    } finally {
      setSaving(false);
    }
  };

  if (loading && !workspace) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center px-4">
        <p className="text-sm font-semibold text-slate-700">Workspace details are unavailable</p>
        {loadFailed && (
          <button
            type="button"
            onClick={load}
            className="h-9 px-4 rounded-lg border border-slate-200 bg-white text-[13px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            Try again
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="px-8 pb-10 space-y-5 max-w-5xl">
      <p className="pt-2 text-xs text-slate-500">Your workspace&apos;s name and the details your team shares.</p>

      <Card
        title="Workspace details"
        subtitle={
          workspace.canEdit
            ? 'The name appears in the sidebar and in invitations sent to teammates.'
            : 'Only workspace owners and admins can change these details.'
        }
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="lg:col-span-2">
            <FieldLabel>Workspace name</FieldLabel>
            {editing ? (
              <form onSubmit={save} className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    autoFocus
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Escape' && cancelEdit()}
                    maxLength={NAME_MAX + 20}
                    disabled={saving}
                    aria-invalid={!!nameError}
                    className={`h-10 flex-1 min-w-[220px] px-3 rounded-lg border bg-white text-[13px] text-slate-900 outline-none focus:ring-2 ${nameError
                      ? 'border-rose-300 focus:ring-rose-100'
                      : 'border-slate-300 focus:border-[#3440a8] focus:ring-[#eef0fb]'
                      }`}
                  />
                  <button
                    type="submit"
                    disabled={!!nameError || !nameChanged || saving}
                    className="h-10 px-4 rounded-lg bg-[#3440a8] text-white text-[13px] font-semibold hover:bg-[#2b3590] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer inline-flex items-center gap-1.5"
                  >
                    {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    disabled={saving}
                    className="h-10 px-4 rounded-lg border border-slate-200 bg-white text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
                <p className={`text-[11.5px] ${nameError ? 'text-rose-600' : 'text-slate-400'}`}>
                  {nameError ?? `${trimmedName.length}/${NAME_MAX} characters`}
                </p>
              </form>
            ) : (
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <ReadOnlyBox icon={<Building2 className="w-3.5 h-3.5" />}>
                    <span className="font-semibold">{workspace.name}</span>
                  </ReadOnlyBox>
                </div>
                {workspace.canEdit && (
                  <button
                    type="button"
                    onClick={startEdit}
                    className="h-10 px-4 rounded-lg border border-slate-200 bg-white text-[13px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer inline-flex items-center gap-1.5 shrink-0"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit
                  </button>
                )}
              </div>
            )}
          </div>

          <div>
            <FieldLabel>Workspace slug</FieldLabel>
            <ReadOnlyBox icon={<Hash className="w-3.5 h-3.5" />} copyValue={workspace.slug}>
              {workspace.slug}
            </ReadOnlyBox>
            <p className="mt-1.5 text-[11.5px] text-slate-400">Used to identify your workspace at sign-in. It can&apos;t be changed.</p>
          </div>

          <div>
            <FieldLabel>Workspace ID</FieldLabel>
            <ReadOnlyBox icon={<Hash className="w-3.5 h-3.5" />} copyValue={String(workspace.id)}>
              {workspace.id}
            </ReadOnlyBox>
            <p className="mt-1.5 text-[11.5px] text-slate-400">Share this with support when you need help.</p>
          </div>

          <div>
            <FieldLabel>Created</FieldLabel>
            <ReadOnlyBox icon={<CalendarDays className="w-3.5 h-3.5" />}>{fmtDate(workspace.createdAt)}</ReadOnlyBox>
            <p className="mt-1.5 text-[11.5px] text-slate-400">Last updated {fmtDate(workspace.updatedAt)}.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
