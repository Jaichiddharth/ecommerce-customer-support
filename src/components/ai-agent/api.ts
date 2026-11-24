import apiClient from '@/lib/api/client';
import type { AgentPolicy, ModelTier } from '@/lib/ai-agent/policy';
import type { WidgetSettings } from '@/lib/ai-agent/widget';

export type ByoProviderKey = 'openai' | 'anthropic' | 'gemini' | 'groq';

export interface ByoConfig {
  configured: boolean;
  provider: ByoProviderKey | null;
  model: string | null;
  keyHint: string | null;
  monthlyLimitUsd: number | null;
  verifiedAt: string | null;
}

export interface ByoTest {
  ok: boolean;
  model?: string;
  latency_ms?: number;
  error?: string;
}

export type SampleKind = 'orders' | 'products';

export interface SampleData {
  orders: {
    count: number;
    customers: { ref: string; name: string | null; email: string | null; phone: string | null; orders: number; latest: string | null }[];
    preview: { order: string; customer: string; status: string; items: string; date: string; tracking: string | null }[];
    fileName: string | null;
    updatedAt: string;
  } | null;
  products: {
    count: number;
    preview: { title: string; price: string | null; compareAtPrice: string | null; available: boolean; imageUrl: string | null }[];
    fileName: string | null;
    updatedAt: string;
  } | null;
}

export interface SampleUpload {
  view: SampleData;
  kind: SampleKind;
  count: number;
  skipped: number;
  checksCreated: number;
  checksError: string | null;
  /** CSV orders: which of the file's columns were read */
  columns: { used: string[]; ignored: string[]; addresses: string[] } | null;
}

export interface WidgetConfig {
  enabled: boolean;
  publicKey: string | null;
  /** The Website chat channel (null until it's added under Settings › Channels) */
  channelId: number | null;
  settings: WidgetSettings;
  stores: { id: number; name: string; needsReauth: boolean }[];
  whatsappNumbers: { number: string; label: string }[];
}

export interface AgentConfig {
  enabled: boolean;
  policy: AgentPolicy;
  liveVersion: { id: number; version: number; note: string | null; createdAt: string } | null;
  plan: { name: string; includedResolutions: number | null; creditsPerResolution: number };
}

export interface Overview {
  window_days: number;
  kpis: {
    resolution_rate: number | null;
    previous_resolution_rate: number | null;
    conversations: number;
    resolved: number;
    handed_over: number;
    handover_rate: number | null;
    median_first_reply_ms: number | null;
    p90_first_reply_ms: number | null;
    channels: string[];
  };
  by_day: { day: string; resolved: number; handed_over: number }[];
  topics: { topic: string; conversations: number; resolved: number; resolution_rate: number | null }[];
  recent_handovers: {
    run_id: string;
    conversation_id: string;
    user_id: string | null;
    handover_reason: string | null;
    reason_label: string | null;
    topic: string | null;
    question: string | null;
    channel: string | null;
    created_at: string;
  }[];
  low_confidence_7d: number;
}

export interface Usage {
  resolutions: number;
  conversations: number;
  avg_latency_ms: number | null;
  tokens_per_reply: number | null;
  llm_replies: number;
  cost_usd: number;
  creditsUsed: number;
  plan: AgentConfig['plan'];
}

export interface KnowledgeSource {
  id: string;
  type: 'text' | 'markdown' | 'faq' | 'pdf' | 'url';
  title: string;
  uri: string | null;
  status: 'queued' | 'syncing' | 'live' | 'error';
  enabled: boolean;
  item_count: number;
  /** Passages left out of the index because they contained instructions aimed at the AI */
  flagged_count?: number;
  error: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at?: string;
}

export interface KnowledgeStats {
  sources: number;
  live_sources: number;
  items: number;
  processing: number;
  errors: number;
  last_synced_at: string | null;
}

export interface Version {
  id: number;
  version: number;
  note: string | null;
  modelTier: ModelTier;
  createdAt: string;
  createdByName: string | null;
  testScore: number | null;
  live: boolean;
}

export interface ChatReply {
  run_id: string;
  outcome: 'answered' | 'clarify' | 'handover' | 'blocked';
  handover_reason: string | null;
  handover_summary: string | null;
  reply: string;
  route: 'flow' | 'cache' | 'rag' | 'guardrail' | 'fallback' | 'tool' | 'sales';
  citations: { source_id: string; title: string | null; url: string | null }[];
  suggestions: string[];
  /** Shopping assistant: the recommended products */
  products?: { ref: string; title: string; price: string | null; compare_at_price: string | null; image_url: string | null; available: boolean }[];
  action: Record<string, any> | null;
  flags: string[];
  usage: { model: string | null; input_tokens: number; output_tokens: number; cost_usd: number };
  latency_ms: number;
  confidence: number | null;
  trace: Record<string, any>;
}

export type TestCategory = 'Policy & FAQ' | 'Order status' | 'Shopping' | 'Safety' | 'Handover' | 'Languages';

export interface TestCase {
  id: string;
  question: string;
  expected: string;
  category: TestCategory;
  expect_outcome: 'answered' | 'handover' | 'refuse' | 'any';
  must_include: string[];
  must_not_include: string[];
  language: string | null;
  as_user: Record<string, string> | null;
  /** Orders the case brings along (uploaded Shopify export) */
  commerce?: unknown | null;
  /** manual, or generated from the sample orders / products (replaced when those are uploaded again) */
  source?: 'manual' | 'sample_orders' | 'sample_products' | 'knowledge_gap';
  created_at: string;
}

export interface TestResult {
  case_id: string;
  question: string;
  passed: boolean;
  outcome: string;
  handover_reason?: string | null;
  reply: string;
  reasons: string[];
  confidence?: number | null;
}

export interface TestRun {
  id: string;
  status: 'running' | 'done' | 'error';
  label: string | null;
  total: number;
  passed: number;
  failed: number;
  handover_total: number;
  handover_correct: number;
  results: TestResult[];
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export type GapReason = 'unanswered' | 'low_confidence' | 'thumbs_down';
export type GapStatus = 'open' | 'resolved' | 'ignored';

export interface KnowledgeGap {
  id: string;
  question: string;
  /** Other ways customers asked it (up to 5) */
  examples: string[];
  reasons: GapReason[];
  times: number;
  /** 0-1, latest time it was asked; 0 when it got no answer */
  confidence: number | null;
  min_confidence: number | null;
  last_reply: string | null;
  last_channel: string | null;
  status: GapStatus;
  answer: string | null;
  test_case_id: string | null;
  in_checks: boolean;
  knowledge_source_id: string | null;
  resolved_at: string | null;
  retest_status: 'pending' | 'done' | 'error' | null;
  retest_confidence: number | null;
  retest_outcome: string | null;
  retest_reply: string | null;
  retest_passed: boolean | null;
  retested_at: string | null;
  /** Fixed before, but customers still didn't get a good answer */
  reopened: boolean;
  first_asked: string;
  last_asked: string;
}

export interface KnowledgeGaps {
  threshold: number;
  summary: {
    open: number;
    resolved: number;
    ignored: number;
    open_asks: number;
    verified: number;
    avg_gain: number | null;
    help: { asked: number; confident: number; avg_confidence: number | null };
  };
  gaps: KnowledgeGap[];
}

const base = '/api/ai-agent';

export const aiAgentApi = {
  getConfig: async () => (await apiClient.get(`${base}/config`)).data.config as AgentConfig,
  savePolicy: async (policy: AgentPolicy, note?: string) =>
    (await apiClient.put(`${base}/config`, { policy, note })).data.config as AgentConfig,
  setEnabled: async (enabled: boolean) => (await apiClient.post(`${base}/status`, { enabled })).data.config as AgentConfig,
  versions: async () => (await apiClient.get(`${base}/versions`)).data.versions as Version[],
  restore: async (id: number) => (await apiClient.post(`${base}/versions/${id}/restore`)).data.config as AgentConfig,

  overview: async (days = 30) => (await apiClient.get(`${base}/overview`, { params: { days } })).data.overview as Overview,
  usage: async () => (await apiClient.get(`${base}/usage`)).data.usage as Usage,

  knowledge: async () =>
    (await apiClient.get(`${base}/knowledge`)).data as { sources: KnowledgeSource[]; stats: KnowledgeStats },
  addKnowledge: async (body: { type: string; title: string; content?: string; uri?: string }) =>
    (await apiClient.post(`${base}/knowledge`, body)).data.source,
  uploadPdf: async (file: File, title: string) => {
    const form = new FormData();
    form.set('file', file);
    form.set('title', title);
    return (await apiClient.post(`${base}/knowledge/upload`, form)).data.source;
  },
  knowledgeContent: async (id: string) =>
    (await apiClient.get(`${base}/knowledge/${id}`)).data.source as { content: string | null; uri: string | null; title: string; type: string },
  updateKnowledge: async (id: string, patch: { title?: string; content?: string; uri?: string; enabled?: boolean }) =>
    (await apiClient.patch(`${base}/knowledge/${id}`, patch)).data.source as KnowledgeSource,
  deleteKnowledge: async (id: string) => apiClient.delete(`${base}/knowledge/${id}`),
  syncKnowledge: async (id: string) => apiClient.post(`${base}/knowledge/${id}/sync`),
  rebuildIndex: async () => (await apiClient.post(`${base}/knowledge/rebuild`)).data as { queued: number },

  testChat: async (body: {
    conversationId: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    testAs?: { id?: string; name?: string; email?: string; phone?: string };
    /** Answer from sample data: this sample customer's orders */
    sample?: { customerRef: string };
    channel?: 'whatsapp' | 'instagram' | 'web';
    policy?: AgentPolicy;
  }) => (await apiClient.post(`${base}/test-chat`, body)).data.reply as ChatReply,

  testCases: async () => (await apiClient.get(`${base}/test-cases`)).data.cases as TestCase[],
  addTestCases: async (body: { cases?: unknown[]; csv?: string; json?: string }) =>
    (await apiClient.post(`${base}/test-cases`, body)).data as { created: string[]; skipped: number; kind: 'cases' | 'orders' },

  byo: async () => (await apiClient.get(`${base}/byo`)).data.byo as ByoConfig,
  saveByo: async (body: { provider: ByoProviderKey; model: string; apiKey?: string; monthlyLimitUsd: number | null }) =>
    (await apiClient.put(`${base}/byo`, body)).data as { byo: ByoConfig; test: ByoTest },
  testByo: async (body: { provider: ByoProviderKey; model: string; apiKey?: string }) =>
    (await apiClient.post(`${base}/byo/test`, body)).data.test as ByoTest,
  removeByo: async () => (await apiClient.delete(`${base}/byo`)).data.config as AgentConfig,

  sampleData: async () => (await apiClient.get(`${base}/sample-data`)).data.sample as SampleData,
  uploadSampleData: async (kind: SampleKind, body: { format: 'csv' | 'json'; text: string; fileName: string }) =>
    (await apiClient.put(`${base}/sample-data/${kind}`, body)).data as SampleUpload,
  removeSampleData: async (kind: SampleKind) => (await apiClient.delete(`${base}/sample-data/${kind}`)).data.sample as SampleData,

  /** The Website chat channel's widget (Settings › Channels) */
  widget: async () => (await apiClient.get('/api/channels/webchat')).data.widget as WidgetConfig,
  saveWidget: async (body: { enabled: boolean; settings: WidgetSettings }) =>
    (await apiClient.put('/api/channels/webchat', body)).data.widget as WidgetConfig,
  connectWebchat: async () => (await apiClient.post('/api/channels/webchat')).data.widget as WidgetConfig,
  gaps: async (status: GapStatus | 'all') => (await apiClient.get(`${base}/gaps`, { params: { status } })).data as KnowledgeGaps,
  setGapStatus: async (id: string, status: 'open' | 'ignored') => (await apiClient.patch(`${base}/gaps/${id}`, { status })).data.gap as KnowledgeGap,
  resolveGap: async (id: string, body: { answer: string; question?: string; addToKnowledge: boolean; addCheck: boolean }) =>
    (await apiClient.post(`${base}/gaps/${id}/resolve`, body)).data.gap as KnowledgeGap,
  retestGap: async (id: string) => (await apiClient.post(`${base}/gaps/${id}/retest`)).data.gap as KnowledgeGap,
  gapToCheck: async (id: string) => (await apiClient.post(`${base}/gaps/${id}/check`)).data.gap as KnowledgeGap,
  deleteTestCase: async (id: string) => apiClient.delete(`${base}/test-cases/${id}`),
  latestRun: async () => (await apiClient.get(`${base}/test-runs`)).data.run as TestRun | null,
  startRun: async () => (await apiClient.post(`${base}/test-runs`)).data.run as { id: string; total: number },
};
