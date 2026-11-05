'use client';

import React, { memo } from 'react';
import { Handle, Position, NodeProps, useReactFlow } from '@xyflow/react';
import {
  MessageCircle, Hash, Bell, GitBranch, Search, UserCheck,
  Send, FileText, UserPlus, PenLine, Clock, Shuffle, StopCircle,
  Settings2, Trash2, MessageSquareText, Hourglass, AlertTriangle,
} from 'lucide-react';
import type { AutomationNodeData } from './flow-types';

// ─── Icon resolver ────────────────────────────────────────────────────────────

const TYPE_ICON: Record<string, React.FC<{ className?: string }>> = {
  trigger_incoming_message: MessageCircle,
  trigger_keyword: Hash,
  trigger_conversation_event: Bell,
  condition_if_else: GitBranch,
  condition_keyword_match: Search,
  condition_contact_attribute: UserCheck,
  action_send_message: Send,
  action_send_template: FileText,
  action_assign_conversation: UserPlus,
  action_update_contact: PenLine,
  flow_delay: Clock,
  flow_branch: Shuffle,
  flow_end: StopCircle,
  action_send_whatsapp_flow: MessageSquareText,
  flow_wait_flow_submission: Hourglass,
};

// ─── Node colour tokens ───────────────────────────────────────────────────────

interface NodeTheme {
  bg: string;
  border: string;
  icon: string;
  badge: string;
  badgeText: string;
  categoryLabel: string;
}

const NODE_THEMES: Record<string, NodeTheme> = {
  trigger_incoming_message:   { bg: '#eff6ff', border: '#bfdbfe', icon: '#1d4ed8', badge: '#dbeafe', badgeText: '#1e40af', categoryLabel: 'Trigger' },
  trigger_keyword:            { bg: '#eff6ff', border: '#bfdbfe', icon: '#1d4ed8', badge: '#dbeafe', badgeText: '#1e40af', categoryLabel: 'Trigger' },
  trigger_conversation_event: { bg: '#eff6ff', border: '#bfdbfe', icon: '#1d4ed8', badge: '#dbeafe', badgeText: '#1e40af', categoryLabel: 'Trigger' },
  condition_if_else:          { bg: '#fefce8', border: '#fde047', icon: '#a16207', badge: '#fef9c3', badgeText: '#92400e', categoryLabel: 'Condition' },
  condition_keyword_match:    { bg: '#fefce8', border: '#fde047', icon: '#a16207', badge: '#fef9c3', badgeText: '#92400e', categoryLabel: 'Condition' },
  condition_contact_attribute:{ bg: '#fefce8', border: '#fde047', icon: '#a16207', badge: '#fef9c3', badgeText: '#92400e', categoryLabel: 'Condition' },
  action_send_message:        { bg: '#f0fdf4', border: '#86efac', icon: '#15803d', badge: '#dcfce7', badgeText: '#166534', categoryLabel: 'Action' },
  action_send_template:       { bg: '#f0fdf4', border: '#86efac', icon: '#15803d', badge: '#dcfce7', badgeText: '#166534', categoryLabel: 'Action' },
  action_assign_conversation: { bg: '#f0fdf4', border: '#86efac', icon: '#15803d', badge: '#dcfce7', badgeText: '#166534', categoryLabel: 'Action' },
  action_update_contact:      { bg: '#f0fdf4', border: '#86efac', icon: '#15803d', badge: '#dcfce7', badgeText: '#166534', categoryLabel: 'Action' },
  flow_delay:                 { bg: '#faf5ff', border: '#d8b4fe', icon: '#7e22ce', badge: '#f3e8ff', badgeText: '#6b21a8', categoryLabel: 'Flow Control' },
  flow_branch:                { bg: '#faf5ff', border: '#d8b4fe', icon: '#7e22ce', badge: '#f3e8ff', badgeText: '#6b21a8', categoryLabel: 'Flow Control' },
  flow_end:                   { bg: '#fff1f2', border: '#fca5a5', icon: '#b91c1c', badge: '#fee2e2', badgeText: '#991b1b', categoryLabel: 'Flow Control' },
  action_send_whatsapp_flow:  { bg: '#f0fdf4', border: '#86efac', icon: '#15803d', badge: '#dcfce7', badgeText: '#166534', categoryLabel: 'Action' },
  flow_wait_flow_submission:  { bg: '#faf5ff', border: '#d8b4fe', icon: '#7e22ce', badge: '#f3e8ff', badgeText: '#6b21a8', categoryLabel: 'Flow Control' },
};

const DEFAULT_THEME: NodeTheme = {
  bg: '#f8fafc', border: '#e2e8f0', icon: '#475569', badge: '#f1f5f9', badgeText: '#334155', categoryLabel: 'Node',
};

// ─── Node action bar (delete + configure) ────────────────────────────────────

function NodeActions({ nodeId, onConfigure }: { nodeId: string; onConfigure: () => void }) {
  const { deleteElements } = useReactFlow();

  const deleteNode = (e: React.MouseEvent) => {
    e.stopPropagation();
    deleteElements({ nodes: [{ id: nodeId }] });
  };

  const configure = (e: React.MouseEvent) => {
    e.stopPropagation();
    onConfigure();
  };

  return (
    <div
      className="absolute -top-9 right-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-10"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={configure}
        className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:text-[#3440a8] hover:border-[#3440a8]/30 shadow-sm transition-colors"
        title="Configure node"
      >
        <Settings2 className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={deleteNode}
        className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-red-500 hover:border-red-200 shadow-sm transition-colors"
        title="Delete node"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── Generic node frame ───────────────────────────────────────────────────────

interface GenericNodeProps extends NodeProps {
  data: AutomationNodeData;
  onConfigure?: (id: string) => void;
}

function GenericNode({ id, data, selected, onConfigure }: GenericNodeProps) {
  const theme = NODE_THEMES[data.type] ?? DEFAULT_THEME;
  const Icon = TYPE_ICON[data.type] ?? MessageCircle;
  const issues = (data as { _issues?: string[] })._issues ?? [];
  const borderColor = issues.length ? '#f87171' : selected ? theme.icon : theme.border;

  return (
    <div
      className="relative group"
      style={{ minWidth: 220 }}
    >
      <NodeActions nodeId={id} onConfigure={() => onConfigure?.(id)} />

      {/* Input handle – all nodes except triggers accept inputs */}
      {!data.type.startsWith('trigger_') && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-3 !h-3 !rounded-full !border-2 !border-white"
          style={{ backgroundColor: theme.icon, top: -6 }}
        />
      )}

      {/* Node card */}
      <div
        className="rounded-2xl border-2 shadow-sm transition-all duration-150"
        style={{
          backgroundColor: theme.bg,
          borderColor,
          boxShadow: selected
            ? `0 0 0 3px ${theme.icon}25, 0 4px 12px ${theme.icon}20`
            : '0 2px 8px rgba(0,0,0,0.07)',
        }}
      >
        {/* Top bar */}
        <div
          className="px-3 py-2.5 flex items-center gap-2.5 border-b"
          style={{ borderColor: theme.border }}
        >
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: theme.badge, color: theme.icon }}
          >
            <Icon className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-bold text-slate-800 truncate leading-tight">{data.label}</p>
            <span
              className="inline-block text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full mt-0.5"
              style={{ backgroundColor: theme.badge, color: theme.badgeText }}
            >
              {theme.categoryLabel}
            </span>
          </div>
          {issues.length > 0 ? (
            <span
              className="flex items-center gap-0.5 text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 rounded-full px-1.5 py-0.5 shrink-0"
              title={issues.join('\n')}
            >
              <AlertTriangle className="w-3 h-3" />
              {issues.length}
            </span>
          ) : data.configured ? (
            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" title="Configured" />
          ) : null}
        </div>

        {/* Body preview */}
        <NodeBody data={data} theme={theme} />
      </div>

      {/* Output handle(s) */}
      {data.type === 'condition_if_else' ? (
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            id="true"
            style={{ left: '30%', backgroundColor: '#16a34a', bottom: -6 }}
            className="!w-3 !h-3 !rounded-full !border-2 !border-white"
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="false"
            style={{ left: '70%', backgroundColor: '#dc2626', bottom: -6 }}
            className="!w-3 !h-3 !rounded-full !border-2 !border-white"
          />
          {/* Labels */}
          <div className="absolute -bottom-6 left-0 right-0 flex justify-around pointer-events-none select-none">
            <span className="text-[9px] font-bold text-emerald-600">TRUE</span>
            <span className="text-[9px] font-bold text-red-500">FALSE</span>
          </div>
        </>
      ) : data.type !== 'flow_end' ? (
        <Handle
          type="source"
          position={Position.Bottom}
          style={{ backgroundColor: theme.icon, bottom: -6 }}
          className="!w-3 !h-3 !rounded-full !border-2 !border-white"
        />
      ) : null}
    </div>
  );
}

// ─── Node body content ────────────────────────────────────────────────────────

function NodeBody({ data, theme }: { data: AutomationNodeData; theme: NodeTheme }) {
  const previewText = getPreviewText(data);

  return (
    <div className="px-3 py-2.5">
      {previewText ? (
        <p
          className="text-[11px] leading-relaxed line-clamp-2"
          style={{ color: theme.badgeText }}
        >
          {previewText}
        </p>
      ) : (
        <p className="text-[11px] text-slate-400 italic">Click configure to set up this node…</p>
      )}
    </div>
  );
}

function getPreviewText(data: AutomationNodeData): string {
  const d = data as Record<string, unknown>;
  switch (data.type) {
    case 'trigger_keyword':
      return d.keywords ? `Keywords: ${(d.keywords as string[]).join(', ')}` : '';
    case 'trigger_conversation_event':
      return d.event ? `Event: ${d.event}` : '';
    case 'condition_if_else':
      return d.attribute && d.operator && d.value
        ? `${d.attribute} ${d.operator} "${d.value}"`
        : '';
    case 'condition_keyword_match':
      return d.keywords ? `Match: ${(d.keywords as string[]).join(', ')}` : '';
    case 'condition_contact_attribute':
      return d.attribute ? `Check: ${d.attribute}` : '';
    case 'action_send_message':
      return d.messageContent ? String(d.messageContent).slice(0, 60) : '';
    case 'action_send_template':
      return d.templateId ? `Template: ${d.templateId}` : '';
    case 'action_assign_conversation':
      return d.assignTo ? `Assign to: ${d.assignTo}` : '';
    case 'action_update_contact':
      return d.updateField ? `Set ${d.updateField} = ${d.updateValue || '…'}` : '';
    case 'flow_delay':
      return d.delayAmount ? `Wait ${d.delayAmount} ${d.delayUnit || 'minutes'}` : '';
    case 'flow_branch':
      return d.branches ? `${(d.branches as string[]).length} branches` : '';
    case 'flow_end':
      return 'End of workflow';
    case 'action_send_whatsapp_flow':
      return d.flowName
        ? `${d.flowName}${d.sendMethod === 'interactive' ? ' · interactive' : d.templateName ? ` · ${d.templateName}` : ''}`
        : '';
    case 'flow_wait_flow_submission':
      return `Wait up to ${d.timeoutHours ?? 24}h for the response`;
    default:
      return '';
  }
}

// ─── Memoised exports keyed by node type ─────────────────────────────────────

// We export a nodeTypes map for React Flow.
// All node types share GenericNode; we pass the onConfigure callback via data.

type NodePropsWithConfigure = NodeProps & { data: AutomationNodeData & { _onConfigure?: (id: string) => void } };

const MemoNode = memo((props: NodePropsWithConfigure) => (
  <GenericNode {...props} onConfigure={props.data._onConfigure} />
));
MemoNode.displayName = 'AutomationNode';

export const NODE_TYPES = {
  trigger_incoming_message:    MemoNode,
  trigger_keyword:             MemoNode,
  trigger_conversation_event:  MemoNode,
  condition_if_else:           MemoNode,
  condition_keyword_match:     MemoNode,
  condition_contact_attribute: MemoNode,
  action_send_message:         MemoNode,
  action_send_template:        MemoNode,
  action_assign_conversation:  MemoNode,
  action_update_contact:       MemoNode,
  flow_delay:                  MemoNode,
  flow_branch:                 MemoNode,
  flow_end:                    MemoNode,
  action_send_whatsapp_flow:   MemoNode,
  flow_wait_flow_submission:   MemoNode,
} as const;
