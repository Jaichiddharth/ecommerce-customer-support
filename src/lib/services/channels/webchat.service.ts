/**
 * Website chat channel: a teammate's reply from the inbox. Nothing is pushed to a provider: the message is stored
 * on the visitor's ticket and the widget picks it up on its next poll (/api/widget/<key>/messages).
 */
import type { AuthUser } from "@/lib/security/auth";
import { AppError } from "@/lib/errors";
import { publish } from "@/lib/realtime";
import { MessageStatus } from "@/lib/db/schema";
import { messageRepository } from "@/lib/db/repositories/message.repository";
import { channelRepository } from "@/lib/db/repositories/channel.repository";
import { customerService } from "../customer.service";

const MAX_CHARS = 4000;

export class WebchatService {
  async sendAgentMessage(user: AuthUser, body: any) {
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) throw AppError.validation("Type a message.", "text");
    if (text.length > MAX_CHARS) throw AppError.validation(`Keep the message under ${MAX_CHARS} characters.`, "text");
    const customerId = Number(body?.customerId);
    if (!Number.isInteger(customerId) || customerId <= 0) throw AppError.validation("customerId is required.", "customerId");

    // Visible to this teammate (assignment rules), on a website chat channel of this organisation
    const customer = await customerService.requireVisible(customerId, user.organizationId);
    const channelId = Number(body?.channelId ?? customer.channelId);
    const channel = Number.isInteger(channelId) ? await channelRepository.findById(channelId, user.organizationId) : null;
    if (!channel || channel.type !== "webchat" || customer.channelId !== channel.id) {
      throw AppError.validation("This contact isn't a website chat visitor.", "channelId");
    }

    const repliedTo = body?.repliedToId ? await messageRepository.findById(Number(body.repliedToId), user.organizationId) : null;
    const created = await messageRepository.createMessage({
      organizationId: user.organizationId,
      customerId: customer.id,
      channelId: channel.id,
      senderType: "agent",
      senderId: user.id,
      receiverId: customer.id,
      textContent: text,
      status: MessageStatus.SENT,
      repliedToId: repliedTo?.customerId === customer.id ? repliedTo.id : null,
    });
    if (!created) throw new AppError("INTERNAL_ERROR", { message: "The reply couldn't be saved. Please try again." });
    const message = { ...created, senderName: user.name };
    publish(user.organizationId, { type: "message.new", customerId: customer.id, message });
    return message;
  }
}

export const webchatService = new WebchatService();
