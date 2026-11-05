'use client';

import React from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, X } from 'lucide-react';
import type { AutomationIssue } from '@/lib/automation/validate';

export type IssuesIntent = 'save' | 'activate' | null;

interface Props {
  issues: AutomationIssue[];
  /** What the user tried to do when the list opened (null = opened from the issues button). */
  intent: IssuesIntent;
  onSelectNode: (nodeId: string) => void;
  onClose: () => void;
  /** Retries the blocked action once everything is fixed. */
  onProceed: () => void;
  busy?: boolean;
}

/** Floating list of what has to be fixed before the automation can be saved or activated. */
export function AutomationIssuesPanel({ issues, intent, onSelectNode, onClose, onProceed, busy }: Props) {
  const count = issues.length;
  const action = intent === 'activate' ? 'activating' : 'saving';

  return (
    <div
      role="dialog"
      aria-label="Automation issues"
      className="absolute top-3 left-3 z-20 w-[340px] max-w-[calc(100%-24px)] max-h-[calc(100%-24px)] flex flex-col bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-slate-100 flex items-start gap-2.5 shrink-0">
        {count ? (
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
        ) : (
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <h3 className="text-[13px] font-bold text-slate-800">
            {count
              ? `${count} ${count === 1 ? 'issue' : 'issues'} to fix${intent ? ` before ${action}` : ''}`
              : 'Everything is configured'}
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {count ? 'Click an issue to open that step.' : intent ? `You can continue ${action} now.` : 'This automation is ready to save and activate.'}
          </p>
        </div>
        <button
          onClick={onClose}
          className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          title="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {count > 0 && (
        <ul className="flex-1 overflow-y-auto py-1.5">
          {issues.map((issue, i) => {
            const body = (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0 mt-[7px]" />
                <span className="flex-1 min-w-0">
                  {issue.nodeLabel && (
                    <span className="block text-[11px] font-semibold text-slate-800 truncate">{issue.nodeLabel}</span>
                  )}
                  <span className="block text-[11px] text-slate-600 leading-snug">{issue.message}</span>
                </span>
              </>
            );
            return (
              <li key={`${issue.nodeId ?? 'automation'}-${i}`}>
                {issue.nodeId ? (
                  <button
                    onClick={() => onSelectNode(issue.nodeId!)}
                    className="group w-full text-left flex items-start gap-2.5 px-4 py-2 hover:bg-slate-50 transition-colors"
                  >
                    {body}
                    <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 shrink-0 mt-0.5" />
                  </button>
                ) : (
                  <div className="flex items-start gap-2.5 px-4 py-2">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {count === 0 && intent && (
        <div className="px-4 py-3 shrink-0">
          <button
            onClick={onProceed}
            disabled={busy}
            className="w-full text-[12px] font-semibold text-white bg-[#3440a8] hover:bg-[#2a3490] disabled:opacity-60 px-3 py-2 rounded-lg transition-colors"
          >
            {intent === 'activate' ? 'Save & activate' : 'Save automation'}
          </button>
        </div>
      )}
    </div>
  );
}
