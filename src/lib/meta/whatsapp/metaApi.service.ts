import { AppError } from '../../errors';
import { createLogger } from '../../logger';
import { graphHttp, graphUpload, graphDownload } from '../graph-client';
import type { WhatsAppBusinessProfile } from '@/types/whatsapp';
import * as templateService from './template.service';

const log = createLogger('MetaApi');

/**
 * Helper to retrieve Meta App credentials from environment variables
 */
const getAppCredentials = () => {
  const appId = process.env.META_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;

  if (!appId || !appSecret) {
    log.warn('META_APP_ID or META_APP_SECRET is not configured in environment variables.');
  }

  return { appId, appSecret };
};

/* ----------------------------------------------------
   TypeScript Types & Interfaces
-----------------------------------------------------*/

export interface MetaOAuthTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

export interface MetaAuthResult {
  accessToken: string;
  tokenType: string;
  generatedAt: string;
  wabaId?: string | null;
  phoneNumberId?: string | null;
  phoneData?: MetaPhoneData | null;
}

export interface MetaPhoneData {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  code_verification_status?: string;
  name_status?: string;
  platform_type?: string;
  /** Deprecated by Meta (per-number tier); kept as a fallback */
  messaging_limit_tier?: string;
  /** Current limit, shared by every number of the business portfolio: TIER_250, TIER_2K, TIER_10K, TIER_100K, TIER_UNLIMITED */
  whatsapp_business_manager_messaging_limit?: string;
  is_on_biz_app?: boolean;
  throughput?: {
    level: string;
  };
  [key: string]: unknown;
}

export interface ResolveWabaPhoneResult {
  wabaId: string | null;
  phoneNumberId: string | null;
  phoneData: MetaPhoneData | null;
}

export interface MetaDebugTokenResponse {
  data?: {
    app_id?: string;
    type?: string;
    application?: string;
    data_access_expires_at?: number;
    expires_at?: number;
    is_valid?: boolean;
    scopes?: string[];
    granular_scopes?: Array<{
      scope: string;
      target_ids?: string[];
    }>;
    user_id?: string;
  };
}

export interface MetaApiResponse<T = unknown> {
  success?: boolean;
  data?: T;
  error?: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

const bearer = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });

/** Short preview of message text for debug logs. */
const preview = (text?: string) => (text && text.length > 80 ? `${text.slice(0, 80)}…` : text);

/* ----------------------------------------------------
   1. Exchange Authorization Code for Meta Access Token
-----------------------------------------------------*/
const getAuthTokenFromCode = async (code: string): Promise<MetaOAuthTokenResponse> => {
  if (!code) {
    throw AppError.validation('Meta authorization code was not provided.', 'code');
  }

  const { appId, appSecret } = getAppCredentials();
  if (!appId || !appSecret) {
    throw new AppError('WHATSAPP_CONNECT_FAILED', {
      message: 'WhatsApp connection is not configured on the server. Please contact your administrator.',
      cause: new Error('META_APP_ID / META_APP_SECRET missing'),
    });
  }

  const response = await graphHttp.post<MetaOAuthTokenResponse>('/oauth/access_token', null, {
    params: { client_id: appId, client_secret: appSecret, code },
    operation: 'oauth.exchange_code',
  });
  return response.data;
};

/* ----------------------------------------------------
   2. Subscribe App to WhatsApp Business Account (WABA)
-----------------------------------------------------*/
const subscribeAppToWaba = async (
  wabaId: string,
  accessToken: string
): Promise<{ success: boolean; data?: unknown }> => {
  if (!wabaId || !accessToken) {
    log.warn('Skipping WABA subscription: wabaId or accessToken missing', { wabaId });
    return { success: false };
  }

  try {
    const response = await graphHttp.post(`/${wabaId}/subscribed_apps`, {}, {
      headers: bearer(accessToken),
      operation: 'waba.subscribe_app',
    });
    return { success: true, data: response.data };
  } catch (err) {
    // Non-fatal: the channel still works for sending; webhooks may not arrive until fixed
    log.warn('Could not subscribe app to WABA — incoming webhooks may not arrive', { err, wabaId });
    return { success: false, data: (err as AppError).details };
  }
};

/* ----------------------------------------------------
   2b. Unsubscribe App from WABA (on disconnect)
   Stops Meta delivering this WABA's webhooks to us. Throws on failure so the
   caller can decide whether a local-only disconnect is acceptable.
-----------------------------------------------------*/
const unsubscribeAppFromWaba = async (wabaId: string, accessToken: string): Promise<void> => {
  await graphHttp.delete(`/${wabaId}/subscribed_apps`, {
    headers: bearer(accessToken),
    operation: 'waba.unsubscribe_app',
  });
};

/* ----------------------------------------------------
   3. Register Customer WhatsApp Phone Number (6-digit PIN)
-----------------------------------------------------*/
const registerPhoneNumber = async (
  phoneNumberId: string,
  accessToken: string,
  pin: string = '123456'
): Promise<{ success: boolean; data?: unknown }> => {
  if (!phoneNumberId || !accessToken) {
    log.warn('Skipping phone registration: phoneNumberId or accessToken missing', { phoneNumberId });
    return { success: false };
  }

  try {
    const response = await graphHttp.post(
      `/${phoneNumberId}/register`,
      { messaging_product: 'whatsapp', pin },
      { headers: bearer(accessToken), operation: 'phone.register' }
    );
    return { success: true, data: response.data };
  } catch (err) {
    // Non-fatal: numbers that are already registered return an error here
    log.warn('Phone number registration did not succeed (often already registered)', { err, phoneNumberId });
    return { success: false, data: (err as AppError).details };
  }
};

/* ----------------------------------------------------
   4. Get Phone Number Details
-----------------------------------------------------*/
const getPhoneNumberFromCode = async (
  phoneNumberId: string,
  accessToken: string
): Promise<MetaPhoneData> => {
  if (!phoneNumberId) throw AppError.validation('phoneNumberId was not provided.', 'phoneNumberId');
  if (!accessToken) throw new AppError('WHATSAPP_CHANNEL_MISCONFIGURED', { message: 'WhatsApp access token is missing. Please reconnect the channel.' });

  const response = await graphHttp.get<MetaPhoneData>(`/${phoneNumberId}`, {
    headers: bearer(accessToken),
    operation: 'phone.details',
  });
  return response.data;
};

/* ----------------------------------------------------
   5. Resolve WABA ID and Phone Numbers From Token Debugging
-----------------------------------------------------*/
const resolveWabaAndPhoneFromToken = async (
  accessToken: string
): Promise<ResolveWabaPhoneResult> => {
  if (!accessToken) {
    log.warn('Cannot resolve WABA: accessToken missing');
    return { wabaId: null, phoneNumberId: null, phoneData: null };
  }

  try {
    const { appId, appSecret } = getAppCredentials();

    // 1. Inspect the access token to extract WABA ID from granular scopes
    const debugRes = await graphHttp.get<MetaDebugTokenResponse>('/debug_token', {
      params: { input_token: accessToken, access_token: `${appId}|${appSecret}` },
      operation: 'token.debug',
    });

    const granularScopes = debugRes.data?.data?.granular_scopes || [];
    const wabaScope = granularScopes.find(
      (s) =>
        s.scope === 'whatsapp_business_management' ||
        s.scope === 'whatsapp_business_messaging'
    );
    const wabaId = wabaScope?.target_ids?.[0] || null;

    let phoneNumberId: string | null = null;
    let phoneData: MetaPhoneData | null = null;

    // 2. Query phone numbers under the WABA ID
    if (wabaId) {
      const phoneRes = await graphHttp.get<{ data: MetaPhoneData[] }>(`/${wabaId}/phone_numbers`, {
        headers: bearer(accessToken),
        operation: 'waba.phone_numbers',
      });
      phoneData = phoneRes.data?.data?.[0] || null;
      phoneNumberId = phoneData?.id || null;
    } else {
      log.warn('Access token has no WhatsApp granular scope — WABA could not be resolved');
    }

    return { wabaId, phoneNumberId, phoneData };
  } catch (err) {
    log.warn('Could not resolve WABA / phone number from access token', { err });
    return { wabaId: null, phoneNumberId: null, phoneData: null };
  }
};

/** Every WhatsApp Business Account the token was granted (one token can cover several) */
const getTokenWabaIds = async (accessToken: string): Promise<string[]> => {
  const { appId, appSecret } = getAppCredentials();
  const debugRes = await graphHttp.get<MetaDebugTokenResponse>('/debug_token', {
    params: { input_token: accessToken, access_token: `${appId}|${appSecret}` },
    operation: 'token.debug',
  });
  const ids = (debugRes.data?.data?.granular_scopes || [])
    .filter((s) => s.scope === 'whatsapp_business_management' || s.scope === 'whatsapp_business_messaging')
    .flatMap((s) => s.target_ids || []);
  return [...new Set(ids)];
};

/** Whether `phoneNumberId` is one of the numbers in `wabaId` */
const wabaHasPhoneNumber = async (wabaId: string, accessToken: string, phoneNumberId: string): Promise<boolean> => {
  const response = await graphHttp.get<{ data: Array<{ id: string }> }>(`/${wabaId}/phone_numbers`, {
    params: { fields: 'id' },
    headers: bearer(accessToken),
    operation: 'waba.phone_numbers',
  });
  return (response.data?.data || []).some((p) => p.id === phoneNumberId);
};

/**
 * The WABA that owns `phoneNumberId`, among those the token can reach. Unlike taking the token's first
 * WABA, this stays correct when one Meta user has connected numbers from several business accounts.
 */
const findWabaForPhoneNumber = async (accessToken: string, phoneNumberId: string): Promise<string | null> => {
  try {
    for (const wabaId of await getTokenWabaIds(accessToken)) {
      if (await wabaHasPhoneNumber(wabaId, accessToken, phoneNumberId).catch(() => false)) return wabaId;
    }
  } catch (err) {
    log.warn('Could not look up the WABA for a phone number', { err, phoneNumberId });
  }
  return null;
};

/* ----------------------------------------------------
   6. Full Meta Token Generation & Setup Pipeline
-----------------------------------------------------*/
const generateMetaAuthToken = async (
  code: string,
  wabaId?: string,
  phoneNumberId?: string,
  options: {
    /** Runs once the WABA/phone are known and before anything changes at Meta; throw to stop the connect */
    beforeActivate?: (ids: { wabaId: string | null; phoneNumberId: string | null }) => Promise<void>;
  } = {}
): Promise<MetaAuthResult> => {
  // Step 1: Exchange code for access token
  const token = await getAuthTokenFromCode(code);

  if (!token?.access_token) {
    throw new AppError('WHATSAPP_CONNECT_FAILED', {
      message: 'Meta did not return an access token. Please try connecting again.',
      provider: { name: 'meta', operation: 'oauth.exchange_code', message: 'No access_token in response' },
    });
  }

  const accessToken = token.access_token;
  let activeWabaId = wabaId;
  let activePhoneId = phoneNumberId;
  let activePhoneData: MetaPhoneData | null = null;

  // Only the number is known: take the WABA that contains it, not just the token's first one
  if (!activeWabaId && activePhoneId) {
    activeWabaId = (await findWabaForPhoneNumber(accessToken, activePhoneId)) || undefined;
  }

  // If WABA ID or Phone Number ID is not passed, resolve automatically from token
  if (!activeWabaId || !activePhoneId) {
    const resolved = await resolveWabaAndPhoneFromToken(accessToken);
    activeWabaId = activeWabaId || resolved.wabaId || undefined;
    activePhoneId = activePhoneId || resolved.phoneNumberId || undefined;
    activePhoneData = resolved.phoneData;
  }

  // Ownership checks run here, so a rejected connect never subscribes or re-registers someone else's number
  await options.beforeActivate?.({ wabaId: activeWabaId ?? null, phoneNumberId: activePhoneId ?? null });

  // Step 2: Subscribe App to WABA
  if (activeWabaId) {
    await subscribeAppToWaba(activeWabaId, accessToken);
  }

  // Step 3: Register phone number
  if (activePhoneId) {
    await registerPhoneNumber(activePhoneId, accessToken);
  }

  log.info('Meta access token generated', { wabaId: activeWabaId ?? null, phoneNumberId: activePhoneId ?? null });

  return {
    accessToken,
    tokenType: token.token_type || 'Bearer',
    generatedAt: new Date().toISOString(),
    wabaId: activeWabaId || null,
    phoneNumberId: activePhoneId || null,
    phoneData: activePhoneData,
  };
};

/* ----------------------------------------------------
   7. WhatsApp Message Sending (Cloud API)
-----------------------------------------------------*/

/**
 * Send a plain text message to a WhatsApp user
 */
const sendWhatsAppTextMessage = async (
  phoneNumberId: string,
  accessToken: string,
  to: string,
  text: string
) => {
  log.debug('Sending text message', { phoneNumberId, to, text: preview(text) });

  const response = await graphHttp.post(
    `/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: text },
    },
    { headers: bearer(accessToken), operation: 'whatsapp.send_text' }
  );
  return response.data;
};

/**
 * Send a WhatsApp template message (Marketing, Utility, Auth).
 *
 * `marketingApi: true` sends through the Marketing Messages API for WhatsApp
 * (POST /{phone-number-id}/marketing_messages): same body and response as /messages, MARKETING templates only.
 * With Meta's default product policy (CLOUD_API_FALLBACK), a WABA that hasn't accepted the Marketing Messages
 * terms is still delivered through Cloud API; status webhooks then report pricing category `marketing` instead of
 * `marketing_lite`. https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/send-marketing-messages
 */
const sendWhatsAppTemplateMessage = async (
  phoneNumberId: string,
  accessToken: string,
  to: string,
  templateName: string,
  languageCode: string = 'en_US',
  components: Array<Record<string, unknown>> = [],
  options: { marketingApi?: boolean } = {}
) => {
  const marketingApi = Boolean(options.marketingApi);
  log.debug('Sending template message', { phoneNumberId, to, templateName, languageCode, marketingApi });

  const response = await graphHttp.post(
    `/${phoneNumberId}/${marketingApi ? 'marketing_messages' : 'messages'}`,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components: components.length > 0 ? components : undefined,
      },
    },
    { headers: bearer(accessToken), operation: marketingApi ? 'whatsapp.send_marketing_template' : 'whatsapp.send_template' }
  );
  return response.data;
};

/**
 * Send or remove a reaction to a WhatsApp message
 */
const sendWhatsAppReactionMessage = async (
  phoneNumberId: string,
  accessToken: string,
  to: string,
  messageId: string,
  emoji: string
) => {
  log.debug('Sending reaction', { phoneNumberId, to, messageId, emoji: emoji || '(removed)' });

  const response = await graphHttp.post(
    `/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'reaction',
      reaction: { message_id: messageId, emoji: emoji || '' },
    },
    { headers: bearer(accessToken), operation: 'whatsapp.send_reaction' }
  );
  return response.data;
};

/* ----------------------------------------------------
   8. Fetch WhatsApp Templates from WABA
-----------------------------------------------------*/
const getWabaTemplates = async (
  wabaId: string,
  accessToken: string,
  limit: number = 50
) => {
  const response = await graphHttp.get(`/${wabaId}/message_templates`, {
    params: {
      limit,
      fields: 'id,name,category,language,status,components,quality_score,rejected_reason',
    },
    headers: bearer(accessToken),
    operation: 'waba.templates',
  });
  return response.data;
};

/* ----------------------------------------------------
   9. Get WABA Account Details & Phone Numbers
-----------------------------------------------------*/
const getWabaAccountDetails = async (wabaId: string, accessToken: string) => {
  try {
    const response = await graphHttp.get(`/${wabaId}`, {
      params: {
        fields: 'id,name,currency,timezone_id,message_template_namespace,account_review_status',
      },
      headers: bearer(accessToken),
      operation: 'waba.details',
    });
    return response.data;
  } catch (err) {
    log.warn('Could not fetch WABA account details', { err, wabaId });
    return null;
  }
};

const getWabaPhoneNumbers = async (wabaId: string, accessToken: string) => {
  try {
    const response = await graphHttp.get(`/${wabaId}/phone_numbers`, {
      headers: bearer(accessToken),
      operation: 'waba.phone_numbers',
    });
    return response.data?.data || [];
  } catch (err) {
    log.warn('Could not fetch WABA phone numbers', { err, wabaId });
    return [];
  }
};

/* ----------------------------------------------------
   9b. Phone Number Health (quality, messaging limit, throughput, coexistence)
-----------------------------------------------------*/
const PHONE_STATUS_FIELDS = [
  'id',
  'display_phone_number',
  'verified_name',
  'name_status',
  'quality_rating',
  'messaging_limit_tier',
  'throughput',
  'platform_type',
  'code_verification_status',
  'is_on_biz_app',
].join(',');

/**
 * The business portfolio's messaging limit (unique customers per rolling 24 h, shared by all its numbers):
 * GET /{phone-number-id}?fields=whatsapp_business_manager_messaging_limit. It replaces the deprecated
 * per-number `messaging_limit_tier`. Asked for on its own so a Graph version or token that doesn't support it
 * can't break the rest of the phone status; null when Meta doesn't return it.
 */
const getPortfolioMessagingLimit = async (phoneNumberId: string, accessToken: string): Promise<string | null> => {
  try {
    const response = await graphHttp.get<{ whatsapp_business_manager_messaging_limit?: string }>(`/${phoneNumberId}`, {
      params: { fields: 'whatsapp_business_manager_messaging_limit' },
      headers: bearer(accessToken),
      operation: 'phone.messaging_limit',
    });
    return response.data?.whatsapp_business_manager_messaging_limit ?? null;
  } catch (err) {
    log.warn('Could not read the portfolio messaging limit', { err, phoneNumberId });
    return null;
  }
};

const getPhoneNumberStatus = async (phoneNumberId: string, accessToken: string): Promise<MetaPhoneData> => {
  const limit = getPortfolioMessagingLimit(phoneNumberId, accessToken);
  let phone: MetaPhoneData;
  try {
    const response = await graphHttp.get<MetaPhoneData>(`/${phoneNumberId}`, {
      params: { fields: PHONE_STATUS_FIELDS },
      headers: bearer(accessToken),
      operation: 'phone.status',
    });
    phone = response.data;
  } catch (err) {
    // Older Graph versions reject fields they don't know; the default field set still has the essentials
    if ((err as AppError).code !== 'META_INVALID_REQUEST') throw err;
    log.warn('Phone status fields rejected — falling back to default phone fields', { phoneNumberId });
    phone = await getPhoneNumberFromCode(phoneNumberId, accessToken);
  }
  const portfolioLimit = await limit;
  return portfolioLimit ? { ...phone, whatsapp_business_manager_messaging_limit: portfolioLimit } : phone;
};

/* ----------------------------------------------------
   9c. WhatsApp Business Profile (what customers see in the chat)
-----------------------------------------------------*/
const BUSINESS_PROFILE_FIELDS = 'about,address,description,email,profile_picture_url,websites,vertical';

const getBusinessProfile = async (phoneNumberId: string, accessToken: string): Promise<WhatsAppBusinessProfile> => {
  const response = await graphHttp.get<{ data?: WhatsAppBusinessProfile[] }>(`/${phoneNumberId}/whatsapp_business_profile`, {
    params: { fields: BUSINESS_PROFILE_FIELDS },
    headers: bearer(accessToken),
    operation: 'phone.business_profile',
  });
  return response.data?.data?.[0] ?? {};
};

const updateBusinessProfile = async (
  phoneNumberId: string,
  accessToken: string,
  profile: Omit<WhatsAppBusinessProfile, 'profile_picture_url'>
): Promise<void> => {
  await graphHttp.post(
    `/${phoneNumberId}/whatsapp_business_profile`,
    { messaging_product: 'whatsapp', ...profile },
    { headers: bearer(accessToken), operation: 'phone.update_business_profile' }
  );
};

/* ----------------------------------------------------
   10. Direct WhatsApp Media Upload (Meta Cloud API)
-----------------------------------------------------*/
const uploadWhatsAppMedia = async (
  phoneNumberId: string,
  accessToken: string,
  fileData: Buffer | Uint8Array | Blob,
  mimeType: string,
  filename: string = 'file'
): Promise<{ id: string }> => {
  const blob = fileData instanceof Blob ? fileData : new Blob([fileData as any], { type: mimeType });
  log.debug('Uploading media to Meta', { phoneNumberId, filename, mimeType, bytes: blob.size });

  const formData = new FormData();
  formData.append('file', blob, filename);
  formData.append('type', mimeType);
  formData.append('messaging_product', 'whatsapp');

  const data = await graphUpload<{ id?: string }>('whatsapp.upload_media', `/${phoneNumberId}/media`, formData, accessToken);

  if (!data?.id) {
    throw new AppError('FILE_UPLOAD_FAILED', {
      message: 'WhatsApp accepted the upload but returned no media id. Please try again.',
      provider: { name: 'meta', operation: 'whatsapp.upload_media', message: 'Response had no id' },
      details: { filename, mimeType },
    });
  }
  return { id: data.id };
};

/* ----------------------------------------------------
   11. Get Media URL / Metadata from Meta Cloud API
-----------------------------------------------------*/
const getWhatsAppMediaUrl = async (
  mediaId: string,
  accessToken: string
): Promise<{
  url: string;
  mime_type: string;
  sha256?: string;
  file_size?: number;
  id: string;
}> => {
  const response = await graphHttp.get(`/${mediaId}`, {
    headers: bearer(accessToken),
    operation: 'whatsapp.media_url',
  });
  return response.data;
};

/* ----------------------------------------------------
   12. Fetch Media Binary Stream from Meta CDN
-----------------------------------------------------*/
const fetchWhatsAppMediaBinary = async (
  downloadUrl: string,
  accessToken: string
) => {
  return graphDownload('whatsapp.media_download', downloadUrl, accessToken);
};

/* ----------------------------------------------------
   13. Send WhatsApp Media Message (Image, Document, Video, Audio)
-----------------------------------------------------*/
const sendWhatsAppMediaMessage = async (
  phoneNumberId: string,
  accessToken: string,
  to: string,
  mediaType: 'image' | 'document' | 'video' | 'audio',
  mediaIdOrUrl: string,
  caption?: string,
  filename?: string
) => {
  const isMetaId = !mediaIdOrUrl.startsWith('http://') && !mediaIdOrUrl.startsWith('https://');

  const mediaObject: Record<string, unknown> = isMetaId
    ? { id: mediaIdOrUrl }
    : { link: mediaIdOrUrl };

  if (caption && (mediaType === 'image' || mediaType === 'document' || mediaType === 'video')) {
    mediaObject.caption = caption;
  }

  if (filename && mediaType === 'document') {
    mediaObject.filename = filename;
  }

  log.debug('Sending media message', { phoneNumberId, to, mediaType, caption: preview(caption), filename });

  const response = await graphHttp.post(
    `/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: mediaType,
      [mediaType]: mediaObject,
    },
    { headers: bearer(accessToken), operation: 'whatsapp.send_media' }
  );
  return response.data;
};

/* ----------------------------------------------------
   Unified Meta API Service Object
-----------------------------------------------------*/
export const metaApi = {
  getAuthTokenFromCode,
  subscribeAppToWaba,
  unsubscribeAppFromWaba,
  registerPhoneNumber,
  getPhoneNumberFromCode,
  getPhoneNumberDetails: getPhoneNumberFromCode,
  resolveWabaAndPhoneFromToken,
  findWabaForPhoneNumber,
  wabaHasPhoneNumber,
  generateMetaAuthToken,
  sendWhatsAppTextMessage,
  sendWhatsAppTemplateMessage,
  sendWhatsAppReactionMessage,
  uploadWhatsAppMedia,
  getWhatsAppMediaUrl,
  fetchWhatsAppMediaBinary,
  sendWhatsAppMediaMessage,
  getWabaTemplates,
  getAllTemplates: templateService.getAllTemplates,
  getTemplate: templateService.getTemplate,
  createTemplate: templateService.createTemplate,
  updateTemplate: templateService.updateTemplate,
  deleteTemplate: templateService.deleteTemplate,
  uploadTemplateMedia: templateService.uploadTemplateMedia,
  getWabaAccountDetails,
  getWabaPhoneNumbers,
  getPhoneNumberStatus,
  getBusinessProfile,
  updateBusinessProfile,
};

export default metaApi;
