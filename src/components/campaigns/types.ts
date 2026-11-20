import type { CampaignDto } from '@/lib/services/campaign.service';
import type { CampaignVariableSource } from '@/lib/db/schema/campaigns';

export type { CampaignRecipient, RejectedRow } from '@/lib/campaigns/contact-file';

/** A campaign as the API returns it (GET /api/campaigns/:id); `id` is '' until the first save */
export type Campaign = CampaignDto;
export type CampaignStatus = Campaign['status'];
export type CampaignAudience = NonNullable<Campaign['audience']>;
export type CampaignMessage = Campaign['message'];
export type CampaignSchedule = Campaign['schedule'];
export type VariableSource = CampaignVariableSource;

export const localTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

export const emptyCampaign = (): Campaign => {
  const now = new Date().toISOString();
  return {
    id: '',
    name: '',
    status: 'draft',
    pauseReason: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    createdBy: null,
    recipientCount: 0,
    audience: null,
    message: { phoneNumberId: '', senderLabel: '', template: null, variables: {} },
    // A delay is required: 1 minute by default
    schedule: { sendAt: null, timezone: localTimezone(), intervalSeconds: 60 },
    stats: { pending: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0, cancelled: 0, unknown: 0 },
  };
};

/** Only drafts open in the editor; from scheduled on, a campaign and its contact list are view-only */
export const isEditable = (status: CampaignStatus) => status === 'draft';

export const PAUSE_REASON_LABEL: Record<NonNullable<Campaign['pauseReason']>, string> = {
  manual: 'Paused by a team member',
  error_threshold: 'Stopped: 20 messages in a row failed. Check the error, then resume.',
  // Older campaigns only (these errors now count toward the 20-in-a-row stop)
  template_unavailable: 'Paused: the template couldn’t be sent',
  account_blocked: 'Paused: WhatsApp blocked sending from this account',
  channel_unavailable: 'Paused: the WhatsApp number is disconnected',
};
