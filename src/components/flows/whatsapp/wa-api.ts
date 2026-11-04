import apiClient from '@/lib/api/client';
import type { WaFlow } from '@/lib/whatsapp-flows/wa-flow-types';

// ─── Response shapes (mirror lib/services/whatsapp-flows) ────────────────────

export type FlowStatus = 'draft' | 'publishing' | 'published' | 'failed' | 'deprecated' | 'archived';

export interface FlowListItem {
  id: number;
  name: string;
  categories: string[];
  jsonVersion: string;
  status: FlowStatus;
  channelId: number | null;
  screensCount: number;
  hasUnpublishedChanges: boolean;
  publishedVersionId: number | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  metaFlowId: string | null;
  publishedVersionNumber: number | null;
  latestVersionNumber: number | null;
  templatesCount: number;
  submissionsCount: number;
  automations: { id: number; name: string; isActive: boolean }[];
}

export interface FlowVersion {
  id: number;
  versionNumber: number;
  status: string;
  metaFlowId: string | null;
  metaFlowName: string;
  wabaId: string;
  jsonVersion: string;
  screensCount: number;
  validationErrors: { message?: string; error?: string; line_start?: number }[];
  lastError: string | null;
  publishedAt: string | null;
  deprecatedAt: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  healthStatus: { can_send_message?: string } | null;
}

export interface FlowDetails extends Omit<FlowListItem, 'metaFlowId' | 'publishedVersionNumber' | 'latestVersionNumber' | 'templatesCount' | 'automations'> {
  draft: WaFlow;
  versions: FlowVersion[];
  templates: { id: number; name: string; language: string; category: string; status: string; flowVersionId: number | null; versionNumber: number | null }[];
  automations: { id: number; name: string; isActive: boolean; nodeIds: string[] }[];
  submissionsCount: number;
}

export interface PublishedFlowOption {
  id: number;
  name: string;
  channelId: number | null;
  publishedVersion: {
    id: number;
    versionNumber: number;
    metaFlowId: string | null;
    wabaId: string;
    entryScreen: string | null;
    screens: { id: string; title: string }[];
  } | null;
}

export interface WaTemplate {
  id: number;
  name: string;
  language: string;
  category: string;
  status: string;
  rejectionReason: string | null;
  bodyText: string;
  headerText: string | null;
  footerText: string | null;
  flowId: number | null;
  flowVersionId: number | null;
  flowButton: { text: string; flowAction: string; navigateScreen: string } | null;
  metaTemplateId: string | null;
  lastError: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
  flowName?: string | null;
  versionNumber?: number | null;
  versionStatus?: string | null;
  metaFlowId?: string | null;
}

export interface FlowTestResult {
  execution: { id: number; status: string; metaMessageId: string | null; sentAt: string | null };
  to: string;
  from: { channelId: number; name: string | null; phoneNumber: string | null };
}

export interface FlowSubmission {
  id: number;
  executionId: number | null;
  flowId: number | null;
  flowVersionId: number | null;
  customerId: number;
  metaMessageId: string;
  response: Record<string, unknown>;
  processingStatus: string;
  automationRunId: number | null;
  lastError: string | null;
  submittedAt: string;
  customerName: string | null;
  customerPhone: string | null;
  flowName: string | null;
  versionNumber: number | null;
  templateId: number | null;
  templateName: string | null;
  automationNodeId: string | null;
}

export interface Recipient {
  id: number;
  name: string;
  phone: string | null;
  channelName: string | null;
}

export interface Paged<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
}

// ─── Calls ───────────────────────────────────────────────────────────────────

export const flowsApi = {
  async list(params: { q?: string; status?: string; page?: number; pageSize?: number }): Promise<Paged<FlowListItem>> {
    const { data } = await apiClient.get('/api/whatsapp-flows', { params });
    return { total: data.total, page: data.page, pageSize: data.pageSize, items: data.flows };
  },
  async published(): Promise<PublishedFlowOption[]> {
    const { data } = await apiClient.get('/api/whatsapp-flows', { params: { published: 1 } });
    return data.flows;
  },
  async get(id: number): Promise<FlowDetails> {
    return (await apiClient.get(`/api/whatsapp-flows/${id}`)).data.flow;
  },
  async create(body: { name: string; categories?: string[]; draft: WaFlow }): Promise<FlowDetails> {
    return (await apiClient.post('/api/whatsapp-flows', body)).data.flow;
  },
  async update(id: number, body: { name?: string; categories?: string[]; draft?: WaFlow }): Promise<FlowDetails> {
    return (await apiClient.patch(`/api/whatsapp-flows/${id}`, body)).data.flow;
  },
  async remove(id: number): Promise<{ deleted: boolean; archived: boolean }> {
    return (await apiClient.delete(`/api/whatsapp-flows/${id}`)).data;
  },
  async action(id: number, action: 'duplicate' | 'publish' | 'sync' | 'restore'): Promise<FlowDetails> {
    return (await apiClient.post(`/api/whatsapp-flows/${id}/${action}`)).data.flow;
  },
  async deprecate(id: number, versionId: number): Promise<FlowDetails> {
    return (await apiClient.post(`/api/whatsapp-flows/${id}/versions/${versionId}/deprecate`)).data.flow;
  },
  async preview(id: number, versionId: number): Promise<{ preview_url: string; expires_at: string } | null> {
    return (await apiClient.get(`/api/whatsapp-flows/${id}/versions/${versionId}/preview`)).data.preview;
  },
  async send(id: number, body: { customerId: number; method: 'template' | 'interactive'; templateId?: number; cta?: string; bodyText?: string }) {
    return (await apiClient.post(`/api/whatsapp-flows/${id}/send`, body)).data.execution;
  },
  /** Real send of an approved template of this Flow to any WhatsApp number (Test Flow). */
  async test(id: number, body: { phone: string; templateId: number }): Promise<FlowTestResult> {
    const { data } = await apiClient.post(`/api/whatsapp-flows/${id}/test`, body);
    return { execution: data.execution, to: data.to, from: data.from };
  },
  async recipients(q: string): Promise<Recipient[]> {
    return (await apiClient.get('/api/whatsapp-flows/recipients', { params: { q } })).data.recipients;
  },
  async submissions(params: { flowId?: number; status?: string; page?: number; pageSize?: number }): Promise<Paged<FlowSubmission>> {
    const { data } = await apiClient.get('/api/whatsapp-flows/submissions', { params });
    return { total: data.total, page: data.page, pageSize: data.pageSize, items: data.submissions };
  },
};

export const templatesApi = {
  async list(params: { flowId?: number; status?: string } = {}): Promise<WaTemplate[]> {
    return (await apiClient.get('/api/whatsapp-templates', { params })).data.templates;
  },
  async create(body: {
    name: string;
    language: string;
    category: string;
    bodyText: string;
    headerText?: string;
    footerText?: string;
    flowId: number;
    buttonText: string;
  }): Promise<WaTemplate> {
    return (await apiClient.post('/api/whatsapp-templates', body)).data.template;
  },
  async sync(id: number): Promise<WaTemplate> {
    return (await apiClient.post(`/api/whatsapp-templates/${id}/sync`)).data.template;
  },
  async retry(id: number): Promise<WaTemplate> {
    return (await apiClient.post(`/api/whatsapp-templates/${id}/retry`)).data.template;
  },
  async remove(id: number): Promise<void> {
    await apiClient.delete(`/api/whatsapp-templates/${id}`);
  },
};

export const META_FLOW_CATEGORIES = [
  ['SIGN_UP', 'Sign up'],
  ['SIGN_IN', 'Sign in'],
  ['APPOINTMENT_BOOKING', 'Appointment booking'],
  ['LEAD_GENERATION', 'Lead generation'],
  ['CONTACT_US', 'Contact us'],
  ['CUSTOMER_SUPPORT', 'Customer support'],
  ['SURVEY', 'Survey'],
  ['OTHER', 'Other'],
] as const;

export const categoryLabel = (c: string) => META_FLOW_CATEGORIES.find(([v]) => v === c)?.[1] ?? c;
