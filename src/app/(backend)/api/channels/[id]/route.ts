import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { channels } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";

// DELETE /api/channels/:id — disconnect (soft delete) a channel
export const DELETE = withAuth(async (req: AuthenticatedRequest, context?: { params: Promise<{ id: string }> }) => {
  const { id } = await context!.params;
  const channelId = parseInt(id, 10);

  if (isNaN(channelId)) {
    return NextResponse.json({ success: false, error: "Invalid channel ID" }, { status: 400 });
  }

  // Verify the channel belongs to the user's org
  const [existing] = await db
    .select({ id: channels.id, organizationId: channels.organizationId })
    .from(channels)
    .where(and(eq(channels.id, channelId), eq(channels.organizationId, req.user.organizationId)))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ success: false, error: "Channel not found" }, { status: 404 });
  }

  // Soft-disconnect: mark as disconnected and inactive
  await db
    .update(channels)
    .set({
      status: "disconnected",
      isActive: false,
      updatedAt: new Date(),
    })
    .where(eq(channels.id, channelId));

  return NextResponse.json({ success: true, message: "Channel disconnected successfully" });
});
