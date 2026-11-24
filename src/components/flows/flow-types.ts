import type { AutomationMedia } from '@/lib/automation/media';

// ─── Node palette type definitions ──────────────────────────────────────────

export type NodeCategory = 'triggers' | 'conditions' | 'actions' | 'flow-controls';

export interface PaletteItem {
  type: string;
  label: string;
  category: NodeCategory;
  description: string;
  icon: string; // lucide icon name (see node-icons.tsx)
  /** Extra words the node search matches on. */
  keywords?: string[];
  /** Retired step: still renders and runs in existing automations, but can't be added. */
  hidden?: boolean;
}

/** Visual tokens for a node category (subtle, on the Unocx slate + #3440a8 theme). */
export interface CategoryTheme {
  label: string;
  /** Singular, shown on node cards ("Trigger"). */
  singular: string;
  /** Solid colour: icon tile, accents. */
  accent: string;
  /** Soft tint behind icons / chips. */
  soft: string;
  /** Text colour on the soft tint. */
  text: string;
}

// ─── Node data payloads ──────────────────────────────────────────────────────

export interface BaseNodeData {
  label: string;
  type: string;
  configured?: boolean;
  [key: string]: unknown;
}

export interface TriggerNodeData extends BaseNodeData {
  triggerType?: 'incoming_message' | 'keyword' | 'conversation_event';
  keywords?: string[];
  event?: string;
}

export interface ConditionNodeData extends BaseNodeData {
  conditionType?: 'if_else' | 'keyword_match' | 'contact_attribute';
  attribute?: string;
  operator?: string;
  value?: string;
}

export interface ActionNodeData extends BaseNodeData {
  actionType?: 'send_message' | 'send_template' | 'assign_conversation' | 'update_contact';
  messageContent?: string;
  /** Send Message attachment stored in S3 (see lib/automation/media.ts) */
  media?: AutomationMedia | null;
  templateId?: string;
  assignTo?: string;
  updateField?: string;
  updateValue?: string;
}

export interface AiAgentNodeData extends BaseNodeData {
  /** What the customer gets when the agent hands over: its own message (default), yours, or nothing. */
  handoverReply?: 'agent' | 'custom' | 'none';
  handoverMessage?: string;
  /** Send the agent's suggested next steps as WhatsApp reply buttons (default on) */
  quickReplies?: boolean;
  /** Resolve the ticket when the customer ends the chat ("No, that's all", "bye") (default on) */
  resolveOnEnd?: boolean;
}

export interface FlowControlNodeData extends BaseNodeData {
  controlType?: 'end';
}

export type AutomationNodeData =
  | TriggerNodeData
  | ConditionNodeData
  | ActionNodeData
  | AiAgentNodeData
  | FlowControlNodeData;

// ─── Workflow graph persistence type ─────────────────────────────────────────

export interface WorkflowGraph {
  id: string;
  name: string;
  nodes: SerializedNode[];
  edges: SerializedEdge[];
  viewport?: { x: number; y: number; zoom: number };
  updatedAt: string;
}

export interface SerializedNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: AutomationNodeData;
}

export interface SerializedEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: string;
}
