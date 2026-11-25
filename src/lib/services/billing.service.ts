import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "../db";
import { campaignRecipients, channels, tickets } from "../db/schema";
import type { AuthUser } from "../security/auth";
import { aiRequest, workspaceIdFor } from "@/lib/ai-agent/service-client";
import { aiAgentService } from "./ai-agent.service";
import { createLogger } from "../logger";

const log = createLogger("BillingService");

/** USD per 1M tokens */
export interface ModelPrice {
  input: number;
  output: number;
}

/** What the workspace actually used in the last `days` days: the cost calculator starts from it */
export interface UsageForEstimate {
  days: number;
  /** New tickets (conversations) per channel type: whatsapp, webchat, … */
  conversations: Record<string, number>;
  /** Connected WhatsApp numbers (Meta's free service-message allowance is per number) */
  whatsappNumbers: number;
  /** Template messages Meta charged for (campaigns), by category: marketing, utility, authentication */
  templates: Record<string, number>;
  ai: {
    /** null when the AI service couldn't be reached */
    available: boolean;
    modelTier: "standard" | "advanced" | "byo";
    model: string | null;
    conversations: number;
    replies: number;
    llmReplies: number;
    inputTokensPerReply: number | null;
    outputTokensPerReply: number | null;
    costUsd: number;
  };
  /** Model prices the AI service bills with (USD per 1M tokens) */
  prices: Record<string, ModelPrice>;
}

interface AiUsage {
  conversations?: number;
  replies?: number;
  llm_replies?: number;
  input_tokens_per_reply?: number | null;
  output_tokens_per_reply?: number | null;
  cost_usd?: number;
  prices?: Record<string, ModelPrice>;
  models?: { standard?: string; advanced?: string };
}

export const billingService = {
  async usageForEstimate(user: AuthUser, days = 30): Promise<UsageForEstimate> {
    const orgId = user.organizationId;
    const since = new Date(Date.now() - days * 86_400_000);

    const [byChannel, numbers, templates, config, ai] = await Promise.all([
      db
        .select({ type: channels.type, n: sql<number>`count(*)::int` })
        .from(tickets)
        .innerJoin(channels, eq(channels.id, tickets.channelId))
        .where(and(eq(tickets.organizationId, orgId), gt(tickets.createdAt, since)))
        .groupBy(channels.type),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(channels)
        .where(and(eq(channels.organizationId, orgId), eq(channels.type, "whatsapp"), eq(channels.status, "connected"))),
      db
        .select({ category: campaignRecipients.pricingCategory, n: sql<number>`count(*)::int` })
        .from(campaignRecipients)
        .where(and(eq(campaignRecipients.organizationId, orgId), eq(campaignRecipients.billable, true), gt(campaignRecipients.sentAt, since)))
        .groupBy(campaignRecipients.pricingCategory),
      aiAgentService.getConfig(user),
      aiRequest<AiUsage>("/v1/insights/usage", { query: { workspace_id: workspaceIdFor(orgId), days } }).catch((err) => {
        log.warn("AI usage unavailable for the cost calculator", { err, organizationId: orgId });
        return null;
      }),
    ]);

    const tier = config.policy.modelTier;
    return {
      days,
      conversations: Object.fromEntries(byChannel.map((r) => [String(r.type), r.n])),
      whatsappNumbers: numbers[0]?.n ?? 0,
      templates: Object.fromEntries(templates.filter((r) => r.category).map((r) => [String(r.category).toLowerCase(), r.n])),
      ai: {
        available: ai !== null,
        modelTier: tier,
        model: tier === "byo" ? null : (ai?.models?.[tier] ?? null),
        conversations: ai?.conversations ?? 0,
        replies: ai?.replies ?? 0,
        llmReplies: ai?.llm_replies ?? 0,
        inputTokensPerReply: ai?.input_tokens_per_reply ?? null,
        outputTokensPerReply: ai?.output_tokens_per_reply ?? null,
        costUsd: Number(ai?.cost_usd ?? 0),
      },
      prices: ai?.prices ?? {},
    };
  },
};
