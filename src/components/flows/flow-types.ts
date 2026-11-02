// ─── Node palette type definitions ──────────────────────────────────────────

export type NodeCategory = 'triggers' | 'conditions' | 'actions' | 'flow-controls';

export interface PaletteItem {
  type: string;
  label: string;
  category: NodeCategory;
  description: string;
  icon: string; // lucide icon name
  color: string; // tailwind bg class
  textColor: string;
  borderColor: string;
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
  templateId?: string;
  assignTo?: string;
  updateField?: string;
  updateValue?: string;
}

export interface FlowControlNodeData extends BaseNodeData {
  controlType?: 'delay' | 'branch' | 'end';
  delayAmount?: number;
  delayUnit?: 'seconds' | 'minutes' | 'hours' | 'days';
  branches?: string[];
}

export type AutomationNodeData =
  | TriggerNodeData
  | ConditionNodeData
  | ActionNodeData
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
