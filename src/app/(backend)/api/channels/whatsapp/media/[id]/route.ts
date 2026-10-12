import { NextResponse } from "next/server";
import { metaApi } from "@/lib/meta";
import { channelRepository } from "@/lib/db/repositories";
import { decryptToken } from "@/lib/security/crypto";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { AppError, toAppError } from "@/lib/errors";

type MediaRouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/channels/whatsapp/media/[id]?token=<firebase id token>
 * Authenticated proxy to stream media directly from Meta Cloud API using the caller's organization channel.
 * The token query param is accepted because <img>/<video> tags cannot send an Authorization header.
 * No local disk or S3 storage required.
 */
export const GET = withAuth<MediaRouteContext>(async (req: AuthenticatedRequest, context) => {
  const resolvedParams = await context?.params;
  let mediaId = resolvedParams?.id;

  if (!mediaId) {
    throw AppError.validation("Media ID is required.", "id");
  }

  // Strip prefix if present
  mediaId = mediaId.replace(/^whatsapp-media:/, "");

  const { searchParams } = new URL(req.url);
  const channelIdParam = searchParams.get("channelId");

  // 1. Resolve WhatsApp Channel of the caller's organization to get Meta Access Token
  const channels = await channelRepository.listByOrgAndType(req.user.organizationId, "whatsapp");
  if (!channels || channels.length === 0) {
    throw new AppError("WHATSAPP_NOT_CONNECTED", { expected: true });
  }

  let targetChannel = null;
  if (channelIdParam) {
    targetChannel = channels.find((c) => c.id === Number(channelIdParam));
  }
  if (!targetChannel) {
    targetChannel = channels.find((c) => c.isActive) || channels[0];
  }

  const rawToken = targetChannel?.metaAccessToken ? decryptToken(targetChannel.metaAccessToken) : "";
  if (!rawToken) {
    throw new AppError("WHATSAPP_CHANNEL_MISCONFIGURED", {
      message: "This WhatsApp channel has no valid access token. Please reconnect it.",
      details: { channelId: targetChannel?.id },
    });
  }

  // 2. Query Meta Graph API for Media Download URL, then 3. stream the binary from Meta's CDN
  let metaMediaInfo;
  let mediaResponse;
  try {
    metaMediaInfo = await metaApi.getWhatsAppMediaUrl(mediaId, rawToken);
    if (!metaMediaInfo?.url) {
      throw new AppError("MEDIA_NOT_FOUND", { details: { mediaId }, expected: true });
    }
    mediaResponse = await metaApi.fetchWhatsAppMediaBinary(metaMediaInfo.url, rawToken);
  } catch (err) {
    const appErr = toAppError(err);
    // Unknown/expired media ids come back from Meta as a generic parameter error
    if (appErr.code === "META_INVALID_REQUEST") {
      throw new AppError("MEDIA_NOT_FOUND", { details: { mediaId }, provider: appErr.provider, cause: appErr, expected: true });
    }
    throw AppError.wrap(appErr, "META_API_ERROR", { details: { mediaId } });
  }

  const contentType = metaMediaInfo.mime_type || mediaResponse.headers.get("content-type") || "application/octet-stream";
  const contentLength = metaMediaInfo.file_size ? String(metaMediaInfo.file_size) : mediaResponse.headers.get("content-length");

  const responseHeaders = new Headers();
  responseHeaders.set("Content-Type", contentType);
  if (contentLength) {
    responseHeaders.set("Content-Length", contentLength);
  }
  // Private: customer media must never be stored by shared caches/CDNs
  responseHeaders.set("Cache-Control", "private, max-age=86400");
  responseHeaders.set("Content-Disposition", "inline");

  // Stream the binary back to the client
  return new NextResponse(mediaResponse.body, {
    status: 200,
    headers: responseHeaders,
  });
});
