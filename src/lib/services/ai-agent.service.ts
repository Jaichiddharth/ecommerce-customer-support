/**
 * AI agent (dashboard side). Owns the agent's configuration (versioned policy, live/paused) and
 * proxies everything else to the Python AI service, always scoped to the caller's organisation:
 * the workspace id is derived from the session here and never taken from the request.
 */
import type { AuthUser } from "@/lib/security/auth";
import { AppError } from "@/lib/errors";
import { aiAgentRepository, organizationRepository } from "@/lib/db/repositories";
import { aiRequest, workspaceIdFor } from "@/lib/ai-agent/service-client";
import { buildCommerceContext } from "@/lib/ai-agent/commerce";
import { decryptToken, encryptToken } from "@/lib/security/crypto";
import { sampleCommerce, searchSampleProducts, type SampleCustomer, type SampleProduct } from "@/lib/ai-agent/sample-data";
import {
  CREDITS_PER_RESOLUTION,
  DEFAULT_POLICY,
  PLAN_AI_RESOLUTIONS,
  normalizePolicy,
  toServiceSettings,
  type AgentPolicy,
} from "@/lib/ai-agent/policy";

export interface AgentConfigView {
  enabled: boolean;
  policy: AgentPolicy;
  liveVersion: { id: number; version: number; note: string | null; createdAt: Date } | null;
  plan: { name: string; includedResolutions: number | null; creditsPerResolution: number };
}

/** Providers for "Bring your own model"; all are called through their OpenAI-compatible APIs */
export const BYO_PROVIDERS = ["openai", "anthropic", "gemini", "groq"] as const;
export type ByoProvider = (typeof BYO_PROVIDERS)[number];

export interface ByoView {
  configured: boolean;
  provider: ByoProvider | null;
  model: string | null;
  /** "••••abcd" of the saved key; the key itself never leaves the server */
  keyHint: string | null;
  monthlyLimitUsd: number | null;
  verifiedAt: Date | null;
}

export interface ByoTestResult {
  ok: boolean;
  model?: string;
  latency_ms?: number;
  error?: string;
}

/** The `llm` part of the AI service's settings: the business's own model for this request */
export interface LlmOverride {
  provider: ByoProvider;
  model: string;
  api_key: string;
  monthly_limit_usd: number | null;
}

/** The AI service's answer to one customer message (subset of its ChatResponse). */
export interface AgentReply {
  run_id: string;
  outcome: "answered" | "clarify" | "handover" | "blocked";
  reply: string;
  route: string;
  handover_reason: string | null;
  handover_summary: string | null;
  confidence: number | null;
  flags: string[];
  usage?: { model?: string | null };
  /** Quick replies for the customer; sent as WhatsApp reply buttons (or a list when they don't fit) */
  suggestions?: string[];
  /** The customer finished the chat ("No, that's all", "bye"): nothing is left open */
  ended?: boolean;
}

const TEST_CATEGORIES = ["Policy & FAQ", "Order status", "Shopping", "Safety", "Handover", "Languages"] as const;
const EXPECT_OUTCOMES = ["answered", "handover", "refuse", "any"] as const;

export class AiAgentService {
  // ------------------------------------------------------------ configuration

  async getConfig(user: AuthUser): Promise<AgentConfigView> {
    const config = await aiAgentRepository.findConfig(user.organizationId);
    const live = config?.liveVersionId ? await aiAgentRepository.findVersion(user.organizationId, config.liveVersionId) : null;
    const policy = live ? normalizePolicy(live.policy) : DEFAULT_POLICY;
    const planName = (user.organizationPlan || "growth").toLowerCase();
    return {
      enabled: config?.enabled ?? false,
      policy,
      liveVersion: live ? { id: live.id, version: live.version, note: live.note, createdAt: live.createdAt } : null,
      plan: {
        name: planName,
        includedResolutions: planName in PLAN_AI_RESOLUTIONS ? PLAN_AI_RESOLUTIONS[planName] : PLAN_AI_RESOLUTIONS.growth,
        creditsPerResolution: CREDITS_PER_RESOLUTION[policy.modelTier],
      },
    };
  }

  /** Every save is a new version that goes live immediately (older ones can be restored). */
  async savePolicy(user: AuthUser, input: unknown, note?: string): Promise<AgentConfigView> {
    const policy = normalizePolicy(input);
    if (policy.modelTier === "byo" && !(await aiAgentRepository.findConfig(user.organizationId))?.byoApiKey) {
      throw AppError.validation("Connect your own model under Bring your own model first.", "modelTier");
    }
    await aiAgentRepository.createLiveVersion(user.organizationId, {
      policy,
      note: note?.trim().slice(0, 200) || null,
      createdById: user.id,
    });
    return this.getConfig(user);
  }

  async setEnabled(user: AuthUser, enabled: boolean): Promise<AgentConfigView> {
    const existing = await aiAgentRepository.findConfig(user.organizationId);
    if (!existing) {
      // First switch-on: start from the defaults so there is a version to run.
      await aiAgentRepository.createLiveVersion(user.organizationId, {
        policy: DEFAULT_POLICY,
        note: "Initial setup",
        createdById: user.id,
        enabled,
      });
    } else {
      await aiAgentRepository.setEnabled(user.organizationId, enabled);
    }
    return this.getConfig(user);
  }

  async listVersions(user: AuthUser) {
    const [config, versions] = await Promise.all([
      aiAgentRepository.findConfig(user.organizationId),
      aiAgentRepository.listVersions(user.organizationId),
    ]);
    return versions.map((v) => {
      const policy = normalizePolicy(v.policy);
      return {
        id: v.id,
        version: v.version,
        note: v.note,
        modelTier: policy.modelTier,
        createdAt: v.createdAt,
        createdByName: v.createdByName,
        testScore: v.testScore,
        live: v.id === config?.liveVersionId,
      };
    });
  }

  async restoreVersion(user: AuthUser, versionId: number): Promise<AgentConfigView> {
    const version = await aiAgentRepository.findVersion(user.organizationId, versionId);
    if (!version) throw AppError.notFound("This version doesn't exist.");
    await aiAgentRepository.createLiveVersion(user.organizationId, {
      policy: normalizePolicy(version.policy),
      note: `Restored v${version.version}`,
      createdById: user.id,
    });
    return this.getConfig(user);
  }

  /** `settings` for the AI service: the live policy, or a draft from the dashboard (test chats). */
  async serviceSettings(user: AuthUser, draftPolicy?: unknown) {
    const policy = draftPolicy !== undefined ? normalizePolicy(draftPolicy) : (await this.getConfig(user)).policy;
    const org = user.organizationName ?? (await organizationRepository.findById(user.organizationId))?.name ?? "our store";
    return { ...toServiceSettings(policy, org, user.organizationPlan), llm: await this.llmFor(user.organizationId, policy) };
  }

  /** The business's own model when the policy uses it and a key is saved; otherwise UnoCX's model */
  async llmFor(organizationId: number, policy: AgentPolicy): Promise<LlmOverride | undefined> {
    if (policy.modelTier !== "byo") return undefined;
    const config = await aiAgentRepository.findConfig(organizationId);
    const apiKey = config?.byoApiKey ? decryptToken(config.byoApiKey) : "";
    if (!config?.byoProvider || !config.byoModel || !apiKey) return undefined;
    return {
      provider: config.byoProvider as ByoProvider,
      model: config.byoModel,
      api_key: apiKey,
      monthly_limit_usd: config.byoMonthlyLimitUsd ?? null,
    };
  }

  // ------------------------------------------------------------ bring your own model

  async getByo(user: AuthUser): Promise<ByoView> {
    const c = await aiAgentRepository.findConfig(user.organizationId);
    return {
      configured: Boolean(c?.byoApiKey && c.byoProvider && c.byoModel),
      provider: (c?.byoProvider as ByoProvider) ?? null,
      model: c?.byoModel ?? null,
      keyHint: c?.byoKeyHint ? `••••${c.byoKeyHint}` : null,
      monthlyLimitUsd: c?.byoMonthlyLimitUsd ?? null,
      verifiedAt: c?.byoVerifiedAt ?? null,
    };
  }

  /** Validates the form; the key may be left out to keep the saved one (same provider only) */
  private async byoInput(user: AuthUser, body: any): Promise<LlmOverride> {
    const provider = BYO_PROVIDERS.find((p) => p === body?.provider);
    if (!provider) throw AppError.validation("Choose a provider.", "provider");
    const model = typeof body?.model === "string" ? body.model.trim() : "";
    if (!/^[\w.:/@-]{1,100}$/.test(model)) throw AppError.validation("Enter the model name, e.g. gpt-4o-mini.", "model");
    let apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
    if (!apiKey) {
      const saved = await aiAgentRepository.findConfig(user.organizationId);
      if (saved?.byoApiKey && saved.byoProvider === provider) apiKey = decryptToken(saved.byoApiKey);
    }
    if (apiKey.length < 8 || apiKey.length > 500 || /\s/.test(apiKey)) throw AppError.validation("Paste your provider API key.", "apiKey");
    const limit = body?.monthlyLimitUsd === null || body?.monthlyLimitUsd === "" || body?.monthlyLimitUsd === undefined ? null : Number(body.monthlyLimitUsd);
    if (limit !== null && (!Number.isFinite(limit) || limit < 0 || limit > 1_000_000)) {
      throw AppError.validation("The monthly limit must be a number of dollars.", "monthlyLimitUsd");
    }
    return { provider, model, api_key: apiKey, monthly_limit_usd: limit };
  }

  async testByo(user: AuthUser, body: any): Promise<ByoTestResult> {
    const llm = await this.byoInput(user, body);
    return aiRequest<ByoTestResult>("/v1/llm/test", { body: { llm }, timeoutMs: 40_000 });
  }

  /** Tests the connection, then saves (the key encrypted). A key that doesn't work is never saved. */
  async saveByo(user: AuthUser, body: any): Promise<{ byo: ByoView; test: ByoTestResult }> {
    const llm = await this.byoInput(user, body);
    const test = await aiRequest<ByoTestResult>("/v1/llm/test", { body: { llm }, timeoutMs: 40_000 });
    if (!test.ok) throw AppError.validation(test.error || "The provider didn't accept this key and model.", "apiKey");
    const newKey = typeof body?.apiKey === "string" && body.apiKey.trim() ? llm.api_key : undefined;
    await aiAgentRepository.setByo(user.organizationId, {
      provider: llm.provider,
      model: llm.model,
      ...(newKey ? { apiKey: encryptToken(newKey), keyHint: newKey.slice(-4) } : {}),
      monthlyLimitUsd: llm.monthly_limit_usd,
      verifiedAt: new Date(),
    });
    return { byo: await this.getByo(user), test };
  }

  /** Removes the key; a live version that used it is replaced by one on UnoCX Standard */
  async removeByo(user: AuthUser): Promise<AgentConfigView> {
    const config = await this.getConfig(user);
    if (config.policy.modelTier === "byo") {
      await aiAgentRepository.createLiveVersion(user.organizationId, {
        policy: { ...config.policy, modelTier: "standard" },
        note: "Own model removed",
        createdById: user.id,
      });
    }
    await aiAgentRepository.setByo(user.organizationId, null);
    return this.getConfig(user);
  }

  // ------------------------------------------------------------ customer conversations (automations)

  /**
   * Answers a customer's conversation with the organisation's live agent (Flows › AI Agent Reply).
   * Returns null when the agent is paused or was never switched on. Throws when the AI service fails.
   */
  async replyToCustomer(input: {
    organizationId: number;
    conversationId: string;
    channel: "whatsapp" | "instagram";
    user: { id?: string | null; name?: string | null; email?: string | null; phone?: string | null };
    messages: { role: "user" | "assistant"; content: string }[];
    /**
     * Who to look up in the connected stores for order questions: the contact's profile and the channel the
     * conversation is on (its store). Without it the AI service only has its demo order data.
     */
    orders?: { profileId: number; channelId: number | null };
  }): Promise<AgentReply | null> {
    const config = await aiAgentRepository.findConfig(input.organizationId);
    if (!config?.enabled) return null;
    const [live, org, commerce] = await Promise.all([
      config.liveVersionId ? aiAgentRepository.findVersion(input.organizationId, config.liveVersionId) : null,
      organizationRepository.findById(input.organizationId),
      input.orders
        ? buildCommerceContext({
            organizationId: input.organizationId,
            channelId: input.orders.channelId,
            subject: { kind: "contact", profileId: input.orders.profileId },
          })
        : undefined,
    ]);
    const policy = live ? normalizePolicy(live.policy) : DEFAULT_POLICY;
    const llm = await this.llmFor(input.organizationId, policy);
    const str = (v: string | null | undefined, n: number) => (v && v.trim() ? v.trim().slice(0, n) : undefined);
    return aiRequest<AgentReply>("/v1/chat", {
      timeoutMs: 45_000,
      body: {
        workspace_id: workspaceIdFor(input.organizationId),
        conversation_id: input.conversationId,
        // WhatsApp verifies the number, so it identifies the customer for order questions
        user: {
          id: str(input.user.id, 64),
          name: str(input.user.name, 100),
          email: str(input.user.email, 200),
          phone: str(input.user.phone, 20),
        },
        messages: input.messages.map((m) => ({ role: m.role, content: m.content.slice(0, 2000) })),
        settings: { ...toServiceSettings(policy, org?.name ?? "our store", org?.plan), llm },
        channel: input.channel,
        commerce,
      },
    });
  }

  // ------------------------------------------------------------ insights

  async overview(user: AuthUser, days = 30) {
    return aiRequest("/v1/insights/overview", { query: { workspace_id: this.ws(user), days } });
  }

  async usage(user: AuthUser) {
    const [usage, config] = await Promise.all([
      aiRequest("/v1/insights/usage", { query: { workspace_id: this.ws(user) } }),
      this.getConfig(user),
    ]);
    return { ...usage, plan: config.plan, creditsUsed: (usage.resolutions ?? 0) * config.plan.creditsPerResolution };
  }

  // ------------------------------------------------------------ knowledge

  async listKnowledge(user: AuthUser) {
    const ws = this.ws(user);
    const [sources, stats] = await Promise.all([
      aiRequest("/v1/knowledge/sources", { query: { workspace_id: ws } }),
      aiRequest("/v1/knowledge/stats", { query: { workspace_id: ws } }),
    ]);
    return { sources, stats };
  }

  async addKnowledge(user: AuthUser, body: any) {
    const type = body?.type;
    if (!["text", "markdown", "faq", "url"].includes(type)) throw AppError.validation("Choose a source type.", "type");
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    if (!title) throw AppError.validation("Give the source a title.", "title");
    return aiRequest("/v1/knowledge/sources", {
      body: {
        workspace_id: this.ws(user),
        type,
        title: title.slice(0, 300),
        content: typeof body.content === "string" ? body.content : null,
        uri: typeof body.uri === "string" && body.uri.trim() ? body.uri.trim() : null,
      },
    });
  }

  async uploadPdf(user: AuthUser, form: FormData) {
    const file = form.get("file");
    const title = String(form.get("title") || "").trim();
    if (!(file instanceof Blob)) throw AppError.validation("Choose a PDF file.", "file");
    if (file.size > 20 * 1024 * 1024) throw new AppError("FILE_TOO_LARGE", { message: "PDFs can be up to 20 MB.", expected: true });
    const out = new FormData();
    out.set("workspace_id", this.ws(user));
    out.set("title", (title || (file as File).name || "Document").slice(0, 300));
    out.set("file", file, (file as File).name || "document.pdf");
    return aiRequest("/v1/knowledge/upload", { form: out, timeoutMs: 60_000 });
  }

  async updateKnowledge(user: AuthUser, id: string, body: any) {
    const patch: Record<string, unknown> = { workspace_id: this.ws(user) };
    if (typeof body?.title === "string") patch.title = body.title.trim().slice(0, 300);
    if (typeof body?.content === "string") patch.content = body.content;
    if (typeof body?.uri === "string") patch.uri = body.uri.trim();
    if (typeof body?.enabled === "boolean") patch.enabled = body.enabled;
    return aiRequest(`/v1/knowledge/sources/${encodeURIComponent(id)}`, { method: "PATCH", body: patch });
  }

  async knowledgeContent(user: AuthUser, id: string) {
    return aiRequest(`/v1/knowledge/sources/${encodeURIComponent(id)}/content`, { query: { workspace_id: this.ws(user) } });
  }

  async deleteKnowledge(user: AuthUser, id: string) {
    return aiRequest(`/v1/knowledge/sources/${encodeURIComponent(id)}`, { method: "DELETE", query: { workspace_id: this.ws(user) } });
  }

  async syncKnowledge(user: AuthUser, id: string) {
    return aiRequest(`/v1/knowledge/sources/${encodeURIComponent(id)}/sync`, { method: "POST", query: { workspace_id: this.ws(user) } });
  }

  async rebuildIndex(user: AuthUser) {
    return aiRequest("/v1/knowledge/rebuild", { method: "POST", query: { workspace_id: this.ws(user) } });
  }

  // ------------------------------------------------------------ test the agent

  async testChat(user: AuthUser, body: any) {
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const clean = messages
      .filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string")
      .slice(-12)
      .map((m: any) => ({ role: m.role, content: m.content.slice(0, 2000) }));
    if (!clean.length || clean[clean.length - 1].role !== "user") throw AppError.validation("Type a customer message.", "messages");
    const conversationId = typeof body?.conversationId === "string" ? body.conversationId.replace(/[^\w-]/g, "").slice(0, 60) : "";
    if (!conversationId) throw AppError.validation("Missing conversation id.", "conversationId");
    let as = body?.testAs ?? {};
    const str = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined);
    const channel = body?.channel === "instagram" ? "instagram" : body?.channel === "web" ? "web" : "whatsapp";
    let commerce;
    const sampleRef = str(body?.sample?.customerRef, 200);
    if (sampleRef) {
      // "Use sample data": a sample customer and their sample orders, instead of the live store
      const row = await aiAgentRepository.findSampleData(user.organizationId, "orders");
      const customer = ((row?.data as SampleCustomer[] | undefined) ?? []).find((c) => c.ref === sampleRef);
      if (!customer) throw AppError.validation("This sample customer no longer exists. Upload sample orders again or pick another.", "sample");
      as = { id: customer.ref, name: customer.name ?? undefined, email: customer.email ?? undefined, phone: customer.phone ?? undefined };
      commerce = sampleCommerce(customer);
    } else if (str(as.phone, 20) || str(as.email, 200)) {
      // Real orders from the connected stores, looked up read-only by the "test as" phone / email
      commerce = await buildCommerceContext({
        organizationId: user.organizationId,
        subject: { kind: "test", phone: str(as.phone, 20), email: str(as.email, 200) },
      });
    }
    // Website preview: the shopping assistant recommends from the sample products
    let catalog: ReturnType<typeof searchSampleProducts> = [];
    if (channel === "web") {
      const row = await aiAgentRepository.findSampleData(user.organizationId, "products");
      const products = (row?.data as SampleProduct[] | undefined) ?? [];
      if (products.length) catalog = searchSampleProducts(products, clean[clean.length - 1].content);
    }
    return aiRequest("/v1/chat", {
      timeoutMs: 30_000,
      body: {
        workspace_id: this.ws(user),
        // Test chats get their own id space so they never collide with real conversations
        conversation_id: `test_${user.id}_${conversationId}`,
        user: { id: str(as.id, 64), name: str(as.name, 100), email: str(as.email, 200), phone: str(as.phone, 20) },
        messages: clean,
        settings: await this.serviceSettings(user, body?.policy),
        channel,
        test: true,
        commerce,
        catalog,
        sales: catalog.length ? { enabled: true } : null,
      },
    });
  }

  // ------------------------------------------------------------ knowledge gaps

  async knowledgeGaps(user: AuthUser, status: string) {
    const st = ["open", "resolved", "ignored", "all"].includes(status) ? status : "open";
    return aiRequest("/v1/gaps", { query: { workspace_id: this.ws(user), status: st } });
  }

  async setGapStatus(user: AuthUser, id: string, status: unknown) {
    if (status !== "open" && status !== "ignored") throw AppError.validation("Choose open or ignored.", "status");
    return aiRequest(`/v1/gaps/${encodeURIComponent(id)}`, { method: "PATCH", body: { workspace_id: this.ws(user), status } });
  }

  /** The business's answer: added to the Knowledge FAQ and the checks, then the question is asked again */
  async resolveGap(user: AuthUser, id: string, body: any) {
    const answer = typeof body?.answer === "string" ? body.answer.trim() : "";
    if (!answer) throw AppError.validation("Write the answer the agent should give.", "answer");
    if (answer.length > 4000) throw AppError.validation("Keep the answer under 4,000 characters.", "answer");
    const question = typeof body?.question === "string" && body.question.trim() ? body.question.trim().slice(0, 500) : undefined;
    const addToKnowledge = body?.addToKnowledge !== false;
    const addCheck = body?.addCheck !== false;
    if (!addToKnowledge && !addCheck) throw AppError.validation("Add the answer to Knowledge, the checks, or both.", "addToKnowledge");
    return aiRequest(`/v1/gaps/${encodeURIComponent(id)}/resolve`, {
      body: { workspace_id: this.ws(user), answer, question, add_to_knowledge: addToKnowledge, add_check: addCheck, settings: await this.serviceSettings(user) },
    });
  }

  async retestGap(user: AuthUser, id: string) {
    return aiRequest(`/v1/gaps/${encodeURIComponent(id)}/retest`, {
      timeoutMs: 45_000,
      body: { workspace_id: this.ws(user), settings: await this.serviceSettings(user) },
    });
  }

  async gapToCheck(user: AuthUser, id: string) {
    return aiRequest(`/v1/gaps/${encodeURIComponent(id)}/check`, { body: { workspace_id: this.ws(user) } });
  }

  // ------------------------------------------------------------ test set

  async listTestCases(user: AuthUser) {
    return aiRequest("/v1/tests/cases", { query: { workspace_id: this.ws(user) } });
  }

  async createTestCases(user: AuthUser, rawCases: unknown[]) {
    const cases = rawCases.map((c, i) => this.testCase(c, i));
    if (!cases.length) throw AppError.validation("Add at least one test case.");
    return aiRequest("/v1/tests/cases", { body: { workspace_id: this.ws(user), cases } });
  }

  async deleteTestCase(user: AuthUser, id: string) {
    return aiRequest(`/v1/tests/cases/${encodeURIComponent(id)}`, { method: "DELETE", query: { workspace_id: this.ws(user) } });
  }

  async startTestRun(user: AuthUser) {
    const config = await this.getConfig(user);
    return aiRequest("/v1/tests/runs", {
      body: {
        workspace_id: this.ws(user),
        settings: await this.serviceSettings(user),
        label: config.liveVersion ? `v${config.liveVersion.version}:${config.liveVersion.id}` : "defaults",
      },
    });
  }

  /** Latest run; when it has finished, its score is attached to the version it tested. */
  async latestTestRun(user: AuthUser) {
    const run = await aiRequest<any>("/v1/tests/runs/latest", { query: { workspace_id: this.ws(user) } });
    const match = typeof run?.label === "string" ? /^v\d+:(\d+)$/.exec(run.label) : null;
    if (run?.status === "done" && match && run.total) {
      await aiAgentRepository.setTestScore(user.organizationId, Number(match[1]), run.passed / run.total, run.id).catch(() => undefined);
    }
    return run;
  }

  // ------------------------------------------------------------ helpers

  private ws(user: AuthUser) {
    return workspaceIdFor(user.organizationId);
  }

  private testCase(c: any, i: number) {
    const where = `Case ${i + 1}`;
    const question = typeof c?.question === "string" ? c.question.trim() : "";
    if (!question) throw AppError.validation(`${where}: the question is empty.`, "question");
    const split = (v: unknown) =>
      (Array.isArray(v) ? v : typeof v === "string" ? v.split(";") : [])
        .map((x) => String(x).trim())
        .filter(Boolean)
        .slice(0, 10);
    const category = TEST_CATEGORIES.find((k) => k.toLowerCase() === String(c?.category ?? "").trim().toLowerCase()) ?? "Policy & FAQ";
    const expectOutcome =
      EXPECT_OUTCOMES.find((k) => k === String(c?.expectOutcome ?? c?.expect_outcome ?? "").trim().toLowerCase()) ??
      (category === "Handover" ? "handover" : category === "Safety" ? "refuse" : "answered");
    const as = c?.asUser ?? c?.as_user;
    const asUser =
      as && typeof as === "object"
        ? Object.fromEntries(
            ["id", "name", "email", "phone"].filter((k) => typeof as[k] === "string" && as[k].trim()).map((k) => [k, String(as[k]).trim().slice(0, 200)]),
          )
        : null;
    return {
      question: question.slice(0, 2000),
      expected: typeof c?.expected === "string" ? c.expected.trim().slice(0, 1000) : "",
      category,
      expect_outcome: expectOutcome,
      must_include: split(c?.mustInclude ?? c?.must_include),
      must_not_include: split(c?.mustNotInclude ?? c?.must_not_include),
      language: typeof c?.language === "string" && c.language.trim() ? c.language.trim().slice(0, 30) : null,
      as_user: asUser && Object.keys(asUser).length ? asUser : null,
      // Orders the case brings along (an uploaded Shopify export); the AI service validates the shape
      commerce: c?.commerce && typeof c.commerce === "object" && JSON.stringify(c.commerce).length <= 200_000 ? c.commerce : null,
      catalog: Array.isArray(c?.catalog) ? c.catalog.slice(0, 8) : [],
      source: c?.source === "sample_orders" || c?.source === "sample_products" ? c.source : "manual",
    };
  }
}

export const aiAgentService = new AiAgentService();
