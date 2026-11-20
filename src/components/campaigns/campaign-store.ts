import { apiClient } from '@/lib/api/client';
import { toApiError } from '@/lib/api/api-error';
import { readListResult, type ListResult } from '@/lib/listing';
import type { CampaignRecipientDto } from '@/lib/services/campaign.service';
import type { Campaign, CampaignStatus } from './types';

/** Client for /api/campaigns. Errors are re-thrown as plain Errors carrying the API's user-facing message. */

async function call<T>(request: () => Promise<{ data: T }>): Promise<T> {
  try {
    return (await request()).data;
  } catch (err) {
    throw new Error(toApiError(err).message);
  }
}

export async function listCampaigns(): Promise<Campaign[]> {
  return (await call(() => apiClient.get<{ campaigns: Campaign[] }>('/api/campaigns'))).campaigns;
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  try {
    return (await apiClient.get<{ campaign: Campaign }>(`/api/campaigns/${encodeURIComponent(id)}`)).data.campaign;
  } catch (err) {
    if (toApiError(err).status === 404) return null;
    throw new Error(toApiError(err).message);
  }
}

/** The editable fields sent on create/update (the audience is uploaded separately) */
const draftBody = (c: Campaign) => ({
  name: c.name,
  message: { phoneNumberId: c.message.phoneNumberId || null, template: c.message.template, variables: c.message.variables },
  schedule: c.schedule,
});

/** Creates the campaign when it has no id yet, otherwise updates it */
export async function saveCampaign(campaign: Campaign): Promise<Campaign> {
  const res = campaign.id
    ? await call(() => apiClient.patch<{ campaign: Campaign }>(`/api/campaigns/${campaign.id}`, draftBody(campaign)))
    : await call(() => apiClient.post<{ campaign: Campaign }>('/api/campaigns', draftBody(campaign)));
  return res.campaign;
}

/** Uploads the contact file; the server parses it with the same rules as the preview and stores the recipients */
export async function uploadAudience(id: string, file: File, phoneColumn: string, defaultCountry: string): Promise<Campaign> {
  const form = new FormData();
  form.append('file', file);
  form.append('phoneColumn', phoneColumn);
  form.append('defaultCountry', defaultCountry);
  return (await call(() => apiClient.put<{ campaign: Campaign }>(`/api/campaigns/${id}/audience`, form))).campaign;
}

type Action = 'schedule' | 'pause' | 'resume' | 'cancel' | 'duplicate';

export async function campaignAction(id: string, action: Action): Promise<Campaign> {
  return (await call(() => apiClient.post<{ campaign: Campaign }>(`/api/campaigns/${id}/actions`, { action }))).campaign;
}

/** Which actions the UI offers for each status (the server enforces the same rules) */
const TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ['scheduled'],
  scheduled: ['cancelled'],
  running: ['paused', 'cancelled'],
  paused: ['running', 'cancelled'],
  completed: [],
  cancelled: [],
  failed: [],
};

export const canTransition = (from: CampaignStatus, to: CampaignStatus) => TRANSITIONS[from].includes(to);

export async function setCampaignStatus(id: string, status: CampaignStatus): Promise<Campaign> {
  const action: Record<string, Action> = { paused: 'pause', running: 'resume', cancelled: 'cancel', scheduled: 'schedule' };
  if (!action[status]) throw new Error(`Can't move a campaign to ${status}`);
  return campaignAction(id, action[status]);
}

export const duplicateCampaign = (id: string) => campaignAction(id, 'duplicate');

/** Downloads the campaign's CSV log (every contact, its file columns and its result) */
export async function downloadCampaignLogs(id: string): Promise<void> {
  const res = await call(() => apiClient.get<Blob>(`/api/campaigns/${id}/export`, { responseType: 'blob' }).then((r) => ({ data: r })));
  const disposition = String(res.headers['content-disposition'] ?? '');
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `campaign-${id}-logs.csv`;
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** One page of a campaign's contacts with their status and pricing (q, status, page, limit) */
export async function listCampaignRecipients(id: string, params: Record<string, string | number>): Promise<ListResult<CampaignRecipientDto>> {
  const data = await call(() => apiClient.get<Record<string, unknown>>(`/api/campaigns/${id}/recipients`, { params }));
  return readListResult<CampaignRecipientDto>(data, 'recipients');
}

export async function deleteCampaign(id: string): Promise<void> {
  await call(() => apiClient.delete(`/api/campaigns/${id}`));
}
