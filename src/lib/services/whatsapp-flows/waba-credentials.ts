import { channelRepository } from "../../db/repositories";
import { ChannelStatus, type Channel } from "../../db/schema";
import { decryptToken } from "../../security/crypto";
import { AppError } from "@/lib/errors";

export interface WabaCredentials {
  channel: Channel;
  wabaId: string;
  phoneNumberId: string;
  /** Decrypted Meta token — server-side only, never returned to the client. */
  token: string;
}

/**
 * The connected WhatsApp number (and so the WABA + access token) Flow/template calls run under.
 * Picks `channelId` when given, else the organization's first active number.
 */
export async function resolveWabaCredentials(organizationId: number, channelId?: number | null): Promise<WabaCredentials> {
  const live = (await channelRepository.listByOrgAndType(organizationId, "whatsapp")).filter(
    (c) => c.status !== ChannelStatus.DISCONNECTED
  );
  if (!live.length) throw new AppError("WHATSAPP_NOT_CONNECTED", { expected: true });

  const channel = channelId ? live.find((c) => c.id === channelId) : live.find((c) => c.isActive) ?? live[0];
  if (!channel) {
    throw new AppError("WHATSAPP_CHANNEL_NOT_FOUND", { details: { channelId }, expected: true });
  }
  return credentialsFor(channel);
}

/** Credentials for a known channel row (e.g. found by WABA id). */
export function credentialsFor(channel: Channel): WabaCredentials {
  const token = channel.metaAccessToken ? decryptToken(channel.metaAccessToken) : "";
  if (!channel.wabaId || !channel.metaPhoneNumberId || !token) {
    throw new AppError("WHATSAPP_CHANNEL_MISCONFIGURED", {
      message: "This WhatsApp number has no WhatsApp Business Account or valid token. Please reconnect it.",
      details: { channelId: channel.id },
    });
  }
  return { channel, wabaId: channel.wabaId, phoneNumberId: channel.metaPhoneNumberId, token };
}

/** Credentials for an organization's live channel on a given WABA (Flows and templates belong to a WABA). */
export async function credentialsForWaba(organizationId: number, wabaId: string): Promise<WabaCredentials> {
  const live = (await channelRepository.findByWabaIdLive(wabaId)).filter((c) => c.organizationId === organizationId);
  const channel = live.find((c) => c.isActive) ?? live[0];
  if (!channel) {
    throw new AppError("WHATSAPP_CHANNEL_NOT_FOUND", {
      message: "The WhatsApp Business Account this item belongs to is no longer connected.",
      details: { wabaId },
      expected: true,
    });
  }
  return credentialsFor(channel);
}
