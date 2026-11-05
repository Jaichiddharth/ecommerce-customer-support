import apiClient from '@/lib/api/client';
import { readListResult, type ListResult } from '@/lib/listing';

export type AutomationStatus = 'draft' | 'active' | 'paused' | 'failed' | 'archived';
export type TriggerType = 'incoming_message' | 'keyword' | 'conversation_event' | 'none';
export type RunStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'timed_out' | 'cancelled';

export interface AutomationListItem {
  id: number;
  name: string;
  description: string | null;
  status: AutomationStatus;
  isActive: boolean;
  triggerType: TriggerType;
  nodeCount: number;
  totalRuns: number;
  lastRunStatus: RunStatus | null;
  lastRunAt: string | null;
  activatedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRun {
  id: number;
  automationId: number;
  customerId: number;
  customerName: string | null;
  customerPhone: string | null;
  triggerKey: string;
  status: RunStatus;
  currentNodeId: string | null;
  waitingFor: { kind: 'flow_submission' | 'delay'; nodeId: string; executionId?: number } | null;
  wakeAt: string | null;
  context: {
    trigger: { type: string; text?: string | null; wamid?: string | null };
    flow?: Record<string, unknown>;
    lastFlowExecutionId?: number;
    log: { at: string; nodeId: string; type: string; outcome: string }[];
  };
  stepCount: number;
  lastError: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Listing query: page, limit, sortBy, sortOrder, q, status, trigger, execution, fromDate, toDate (last modified). */
export type AutomationListQuery = Record<string, string | number>;

export const automationsApi = {
  async list(params: AutomationListQuery): Promise<ListResult<AutomationListItem>> {
    const { data } = await apiClient.get('/api/automations', { params });
    return readListResult<AutomationListItem>(data, 'automations');
  },
  async create(body: { name: string; description?: string | null; graph: { nodes: unknown[]; edges: unknown[] } }) {
    return (await apiClient.post('/api/automations', body)).data.automation as { id: number };
  },
  async setActive(id: number, isActive: boolean) {
    return (await apiClient.put(`/api/automations/${id}`, { isActive })).data.automation;
  },
  async duplicate(id: number) {
    return (await apiClient.post(`/api/automations/${id}/duplicate`)).data.automation as { id: number };
  },
  async restore(id: number) {
    return (await apiClient.post(`/api/automations/${id}/restore`)).data.automation;
  },
  async remove(id: number): Promise<{ deleted: boolean; archived: boolean }> {
    return (await apiClient.delete(`/api/automations/${id}`)).data;
  },
  /** Execution history listing: status, fromDate / toDate (started at), sortBy createdAt | status | customer. */
  async runs(id: number, params: AutomationListQuery): Promise<ListResult<AutomationRun>> {
    const { data } = await apiClient.get(`/api/automations/${id}/runs`, { params });
    return readListResult<AutomationRun>(data, 'runs');
  },
  async run(id: number, runId: number): Promise<AutomationRun> {
    return (await apiClient.get(`/api/automations/${id}/runs/${runId}`)).data.run;
  },
};

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  incoming_message: 'Incoming message',
  keyword: 'Keyword',
  conversation_event: 'Conversation event',
  none: 'No trigger',
};

export const NODE_TYPE_LABELS: Record<string, string> = {
  trigger_incoming_message: 'Incoming Message',
  trigger_keyword: 'Keyword Trigger',
  trigger_conversation_event: 'Conversation Event',
  condition_if_else: 'If / Else',
  condition_keyword_match: 'Keyword Match',
  condition_contact_attribute: 'Contact Attribute',
  action_send_message: 'Send Message',
  action_send_template: 'Send Template',
  action_assign_conversation: 'Assign Conversation',
  action_update_contact: 'Update Contact',
  action_send_whatsapp_flow: 'Send WhatsApp Flow',
  flow_wait_flow_submission: 'Wait for Flow Submission',
  flow_delay: 'Delay',
  flow_branch: 'Branch',
  flow_end: 'End Workflow',
};
