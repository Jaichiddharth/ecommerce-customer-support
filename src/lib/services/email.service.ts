import nodemailer, { type Transporter } from "nodemailer";
import { createLogger } from "@/lib/logger";

const log = createLogger("email.service");

export interface SendInvitationParams {
  toEmail: string;
  recipientName?: string | null;
  inviterName: string;
  inviterEmail?: string | null;
  workspaceName: string;
  inviteUrl: string;
  role: string;
  expiresAt: Date;
}

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  inviteUrl: string;
}

class EmailService {
  private transporter: Transporter | null = null;
  private fromEmail: string;

  constructor() {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER || process.env.SMTP_EMAIL;
    const pass = process.env.SMTP_PASS || process.env.SMTP_PASSWORD;
    const service = process.env.SMTP_SERVICE; // e.g. 'gmail'
    const secure = process.env.SMTP_SECURE === "true" || port === 465;

    this.fromEmail =
      process.env.EMAIL_FROM ||
      process.env.SMTP_FROM ||
      (user ? `UnoCX Team <${user}>` : "UnoCX Team <invites@unocx.in>");

    if (service || (host && user && pass)) {
      this.transporter = nodemailer.createTransport(
        service
          ? {
              service,
              auth: { user, pass },
            }
          : {
              host,
              port,
              secure,
              auth: { user, pass },
            }
      );
      log.info(`Nodemailer initialized with ${service ? `service: ${service}` : `host: ${host}:${port}`}`);
    } else {
      log.warn("SMTP credentials not found in environment. Emails will be logged to console and links provided directly.");
    }
  }

  /**
   * Generates the accessible HTML email template with SPF/DKIM aligned styling
   */
  private generateInvitationHtml(params: SendInvitationParams): string {
    const formattedExpires = params.expiresAt.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });

    const roleName = params.role.charAt(0) + params.role.slice(1).toLowerCase();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You're invited to join ${params.workspaceName} on UnoCX</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td {font-family: Arial, Helvetica, sans-serif !important;}
  </style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; -webkit-font-smoothing: antialiased;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 40px 16px;">
    <tr>
      <td align="center">
        <!-- Main Card -->
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 560px; background-color: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05); overflow: hidden;">
          
          <!-- Header Banner -->
          <tr>
            <td style="background-color: #1e2a78; padding: 32px 36px; text-align: left;">
              <table role="presentation" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="width: 36px; height: 36px; background-color: #ffffff; border-radius: 8px; text-align: center; vertical-align: middle;">
                    <span style="color: #1e2a78; font-size: 20px; font-weight: 800; line-height: 36px;">U</span>
                  </td>
                  <td style="padding-left: 12px; color: #ffffff; font-size: 20px; font-weight: 700; letter-spacing: -0.5px;">
                    UnoCX
                  </td>
                </tr>
              </table>
              <h1 style="color: #ffffff; font-size: 22px; font-weight: 700; margin: 24px 0 0 0; line-height: 1.3;">
                Join ${params.workspaceName}
              </h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 36px 36px 28px 36px;">
              <p style="font-size: 15px; line-height: 1.6; color: #334155; margin: 0 0 18px 0;">
                Hello${params.recipientName ? ` <strong>${params.recipientName}</strong>` : ""},
              </p>
              
              <p style="font-size: 15px; line-height: 1.6; color: #334155; margin: 0 0 24px 0;">
                <strong>${params.inviterName}</strong> has invited you to join the <strong>${params.workspaceName}</strong> workspace on UnoCX as a <strong>${roleName}</strong>.
              </p>

              <!-- CTA Button Box -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
                <tr>
                  <td align="center">
                    <a href="${params.inviteUrl}" target="_blank" style="display: inline-block; background-color: #1e2a78; color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 10px; box-shadow: 0 2px 4px rgba(30, 42, 120, 0.25);">
                      Accept Invitation &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Notice Box -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; border-radius: 10px; margin: 24px 0;">
                <tr>
                  <td style="padding: 16px 20px;">
                    <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #475569;">
                      <strong>Security Notice:</strong> This single-use link is valid for 7 days (expires <strong>${formattedExpires}</strong>). It can only be accepted by <strong>${params.toEmail}</strong>.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Fallback Link -->
              <p style="font-size: 12px; line-height: 1.6; color: #64748b; margin: 24px 0 0 0; word-break: break-all;">
                If the button above does not work, copy and paste this link into your browser:<br>
                <a href="${params.inviteUrl}" style="color: #1e2a78; text-decoration: underline;">${params.inviteUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 24px 36px; text-align: center;">
              <p style="margin: 0 0 6px 0; font-size: 12px; color: #94a3b8;">
                This invitation was sent to ${params.toEmail}. If you were not expecting this, you can safely ignore this email.
              </p>
              <p style="margin: 0; font-size: 11px; color: #cbd5e1;">
                &copy; ${new Date().getFullYear()} UnoCX. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  /**
   * Generates plaintext version for multipart MIME compliance
   */
  private generateInvitationText(params: SendInvitationParams): string {
    const roleName = params.role.charAt(0) + params.role.slice(1).toLowerCase();
    return `You're invited to join ${params.workspaceName} on UnoCX

${params.inviterName} has invited you to join their workspace as a ${roleName}.

To accept this invitation and access the workspace, open this link:
${params.inviteUrl}

This secure, single-use link expires on ${params.expiresAt.toISOString()} (7 days).
Only ${params.toEmail} can accept this invitation.

If you weren't expecting this invitation, you can ignore this email.
--
UnoCX Team
`;
  }

  /**
   * Send an invitation email using Nodemailer (SMTP / Gmail / Custom SMTP)
   */
  async sendInvitationEmail(params: SendInvitationParams): Promise<EmailSendResult> {
    const publicOrigin =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.APP_URL ||
      "https://cure-thriving-bobbing.ngrok-free.dev";
    const cleanInviteUrl = params.inviteUrl
      .replace(/^https?:\/\/localhost(:\d+)?/i, publicOrigin.replace(/\/+$/, ""))
      .replace(/^https?:\/\/127\.0\.0\.1(:\d+)?/i, publicOrigin.replace(/\/+$/, ""));
    const safeParams: SendInvitationParams = { ...params, inviteUrl: cleanInviteUrl };

    const subject = `${safeParams.inviterName} invited you to join ${safeParams.workspaceName} on UnoCX`;
    const htmlBody = this.generateInvitationHtml(safeParams);
    const textBody = this.generateInvitationText(safeParams);

    log.info("Sending invitation email", {
      to: safeParams.toEmail,
      workspace: safeParams.workspaceName,
      inviter: safeParams.inviterName,
      inviteUrl: safeParams.inviteUrl,
    });

    if (!this.transporter) {
      log.info(`[SMTP NOT CONFIGURED] Email simulated for ${safeParams.toEmail}. Invite link: ${safeParams.inviteUrl}`);
      return {
        success: true,
        messageId: `simulated_${Date.now()}`,
        inviteUrl: safeParams.inviteUrl,
      };
    }

    try {
      const info = await this.transporter.sendMail({
        from: this.fromEmail,
        to: safeParams.toEmail,
        replyTo: safeParams.inviterEmail || undefined,
        subject,
        text: textBody,
        html: htmlBody,
        headers: {
          "Auto-Submitted": "auto-generated",
          "X-Mailer": "UnoCX-Mailer/2.0 (Nodemailer)",
        },
      });

      log.info("Invitation email sent successfully via SMTP", {
        messageId: info.messageId,
        to: safeParams.toEmail,
      });

      return {
        success: true,
        messageId: info.messageId,
        inviteUrl: safeParams.inviteUrl,
      };
    } catch (err: any) {
      log.warn("Failed to send invitation email via SMTP. Returning link for manual sharing.", {
        error: err.message,
        to: safeParams.toEmail,
      });

      return {
        success: false,
        error: err.message || "Failed to dispatch email via SMTP",
        inviteUrl: safeParams.inviteUrl,
      };
    }
  }
}

export const emailService = new EmailService();
