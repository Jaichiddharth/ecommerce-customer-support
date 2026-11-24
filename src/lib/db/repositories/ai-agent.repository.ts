import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "..";
import {
  aiAgentConfigs,
  aiAgentVersions,
  aiSampleData,
  aiWidgets,
  users,
  type AiAgentConfig,
  type AiAgentVersion,
  type AiSampleData,
  type AiWidget,
} from "../schema";

export type AiAgentVersionRow = AiAgentVersion & { createdByName: string | null };

export class AiAgentRepository {
  async findConfig(organizationId: number): Promise<AiAgentConfig | null> {
    const [row] = await db.select().from(aiAgentConfigs).where(eq(aiAgentConfigs.organizationId, organizationId)).limit(1);
    return row ?? null;
  }

  async findVersion(organizationId: number, versionId: number): Promise<AiAgentVersion | null> {
    const [row] = await db
      .select()
      .from(aiAgentVersions)
      .where(and(eq(aiAgentVersions.organizationId, organizationId), eq(aiAgentVersions.id, versionId)))
      .limit(1);
    return row ?? null;
  }

  async listVersions(organizationId: number, limit = 20): Promise<AiAgentVersionRow[]> {
    return db
      .select({
        id: aiAgentVersions.id,
        organizationId: aiAgentVersions.organizationId,
        version: aiAgentVersions.version,
        policy: aiAgentVersions.policy,
        note: aiAgentVersions.note,
        createdById: aiAgentVersions.createdById,
        testScore: aiAgentVersions.testScore,
        testRunId: aiAgentVersions.testRunId,
        createdAt: aiAgentVersions.createdAt,
        createdByName: users.name,
      })
      .from(aiAgentVersions)
      .leftJoin(users, eq(users.id, aiAgentVersions.createdById))
      .where(eq(aiAgentVersions.organizationId, organizationId))
      .orderBy(desc(aiAgentVersions.version))
      .limit(limit);
  }

  /**
   * Append a new version and make it live, atomically. The config row is created on first save.
   * Version numbers are per organisation; the config row is locked so two saves can't collide.
   */
  async createLiveVersion(
    organizationId: number,
    data: { policy: unknown; note?: string | null; createdById?: number | null; enabled?: boolean },
  ): Promise<{ config: AiAgentConfig; version: AiAgentVersion }> {
    return db.transaction(async (tx) => {
      await tx
        .insert(aiAgentConfigs)
        .values({ organizationId, enabled: data.enabled ?? false })
        .onConflictDoNothing({ target: aiAgentConfigs.organizationId });
      await tx.execute(sql`SELECT id FROM ai_agent_configs WHERE organization_id = ${organizationId} FOR UPDATE`);
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${aiAgentVersions.version}), 0) + 1` })
        .from(aiAgentVersions)
        .where(eq(aiAgentVersions.organizationId, organizationId));
      const [version] = await tx
        .insert(aiAgentVersions)
        .values({
          organizationId,
          version: Number(next),
          policy: data.policy,
          note: data.note ?? null,
          createdById: data.createdById ?? null,
        })
        .returning();
      const [config] = await tx
        .update(aiAgentConfigs)
        .set({ liveVersionId: version.id, updatedAt: new Date(), ...(data.enabled !== undefined ? { enabled: data.enabled } : {}) })
        .where(eq(aiAgentConfigs.organizationId, organizationId))
        .returning();
      return { config, version };
    });
  }

  async setEnabled(organizationId: number, enabled: boolean): Promise<AiAgentConfig | null> {
    const [row] = await db
      .update(aiAgentConfigs)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(aiAgentConfigs.organizationId, organizationId))
      .returning();
    return row ?? null;
  }

  /** Bring your own model. `apiKey` undefined keeps the stored key; null removes the whole setup. */
  async setByo(
    organizationId: number,
    data: { provider: string; model: string; apiKey?: string; keyHint?: string; monthlyLimitUsd: number | null; verifiedAt?: Date | null } | null,
  ): Promise<AiAgentConfig> {
    await db.insert(aiAgentConfigs).values({ organizationId }).onConflictDoNothing({ target: aiAgentConfigs.organizationId });
    const set =
      data === null
        ? { byoProvider: null, byoModel: null, byoApiKey: null, byoKeyHint: null, byoMonthlyLimitUsd: null, byoVerifiedAt: null }
        : {
            byoProvider: data.provider,
            byoModel: data.model,
            byoMonthlyLimitUsd: data.monthlyLimitUsd,
            ...(data.apiKey !== undefined ? { byoApiKey: data.apiKey, byoKeyHint: data.keyHint ?? null } : {}),
            ...(data.verifiedAt !== undefined ? { byoVerifiedAt: data.verifiedAt } : {}),
          };
    const [row] = await db
      .update(aiAgentConfigs)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(aiAgentConfigs.organizationId, organizationId))
      .returning();
    return row;
  }

  async findWidget(organizationId: number): Promise<AiWidget | null> {
    const [row] = await db.select().from(aiWidgets).where(eq(aiWidgets.organizationId, organizationId)).limit(1);
    return row ?? null;
  }

  async findWidgetByKey(publicKey: string): Promise<AiWidget | null> {
    const [row] = await db.select().from(aiWidgets).where(eq(aiWidgets.publicKey, publicKey)).limit(1);
    return row ?? null;
  }

  /** Creates the organisation's widget on first save (with the given public key), or updates it */
  async upsertWidget(
    organizationId: number,
    publicKey: string,
    data: { enabled: boolean; settings: unknown; channelId?: number | null },
  ): Promise<AiWidget> {
    const set = { enabled: data.enabled, settings: data.settings, updatedAt: new Date(), ...(data.channelId !== undefined ? { channelId: data.channelId } : {}) };
    const [row] = await db
      .insert(aiWidgets)
      .values({ organizationId, publicKey, enabled: data.enabled, settings: data.settings, channelId: data.channelId ?? null })
      .onConflictDoUpdate({ target: aiWidgets.organizationId, set })
      .returning();
    return row;
  }

  async findWidgetByChannel(organizationId: number, channelId: number): Promise<AiWidget | null> {
    const [row] = await db
      .select()
      .from(aiWidgets)
      .where(and(eq(aiWidgets.organizationId, organizationId), eq(aiWidgets.channelId, channelId)))
      .limit(1);
    return row ?? null;
  }

  async listSampleData(organizationId: number): Promise<AiSampleData[]> {
    return db.select().from(aiSampleData).where(eq(aiSampleData.organizationId, organizationId));
  }

  async findSampleData(organizationId: number, kind: string): Promise<AiSampleData | null> {
    const [row] = await db
      .select()
      .from(aiSampleData)
      .where(and(eq(aiSampleData.organizationId, organizationId), eq(aiSampleData.kind, kind)))
      .limit(1);
    return row ?? null;
  }

  async saveSampleData(
    organizationId: number,
    kind: string,
    data: { items: unknown; itemCount: number; fileName: string | null; updatedById: number | null },
  ): Promise<AiSampleData> {
    const values = { data: data.items, itemCount: data.itemCount, fileName: data.fileName, updatedById: data.updatedById, updatedAt: new Date() };
    const [row] = await db
      .insert(aiSampleData)
      .values({ organizationId, kind, ...values })
      .onConflictDoUpdate({ target: [aiSampleData.organizationId, aiSampleData.kind], set: values })
      .returning();
    return row;
  }

  async deleteSampleData(organizationId: number, kind: string): Promise<void> {
    await db.delete(aiSampleData).where(and(eq(aiSampleData.organizationId, organizationId), eq(aiSampleData.kind, kind)));
  }

  async setTestScore(organizationId: number, versionId: number, score: number, runId: string): Promise<void> {
    await db
      .update(aiAgentVersions)
      .set({ testScore: score, testRunId: runId })
      .where(and(eq(aiAgentVersions.organizationId, organizationId), eq(aiAgentVersions.id, versionId)));
  }
}

export const aiAgentRepository = new AiAgentRepository();
