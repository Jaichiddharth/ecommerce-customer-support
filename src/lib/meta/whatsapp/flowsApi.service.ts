import { graphHttp, graphUpload } from '../graph-client';
import { createLogger } from '@/lib/logger';

/**
 * Meta WhatsApp Flows API + message-template management calls.
 * Verified against developers.facebook.com/docs/whatsapp/flows/reference/flowsapi,
 * …/flows/guides/sendingaflow and …/templates/template-management.
 * Required token scopes: whatsapp_business_management (+ whatsapp_business_messaging to send).
 * Transport, logging and error mapping come from graph-client (errors surface as AppError META_*).
 */

const log = createLogger('MetaFlowsApi');
const bearer = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });

export interface MetaFlowValidationError {
  error?: string;
  error_type?: string;
  message?: string;
  line_start?: number;
  line_end?: number;
  column_start?: number;
  column_end?: number;
  pointers?: unknown[];
}

export interface MetaFlowCreateResponse {
  id: string;
  success?: boolean;
  validation_errors?: MetaFlowValidationError[];
}

export interface MetaFlowDetails {
  id: string;
  name: string;
  status: 'DRAFT' | 'PUBLISHED' | 'DEPRECATED' | 'BLOCKED' | 'THROTTLED' | string;
  categories?: string[];
  validation_errors?: MetaFlowValidationError[];
  json_version?: string;
  health_status?: Record<string, unknown>;
  preview?: { preview_url: string; expires_at: string };
}

/** POST /{WABA_ID}/flows — creates a DRAFT Flow, optionally with JSON (and cloned from another Flow). */
const createFlow = async (
  wabaId: string,
  accessToken: string,
  params: { name: string; categories: string[]; flowJson?: string; cloneFlowId?: string; publish?: boolean }
): Promise<MetaFlowCreateResponse> => {
  const response = await graphHttp.post(
    `/${wabaId}/flows`,
    {
      name: params.name,
      categories: params.categories,
      ...(params.flowJson ? { flow_json: params.flowJson } : {}),
      ...(params.cloneFlowId ? { clone_flow_id: params.cloneFlowId } : {}),
      ...(params.publish !== undefined ? { publish: params.publish } : {}),
    },
    { headers: bearer(accessToken), operation: 'flows.create' }
  );
  return response.data;
};

/** POST /{FLOW_ID}/assets — replaces the Flow JSON (multipart: file, name=flow.json, asset_type=FLOW_JSON). */
const uploadFlowJson = async (
  flowId: string,
  accessToken: string,
  flowJson: string
): Promise<{ success?: boolean; validation_errors?: MetaFlowValidationError[] }> => {
  const form = new FormData();
  form.append('file', new Blob([flowJson], { type: 'application/json' }), 'flow.json');
  form.append('name', 'flow.json');
  form.append('asset_type', 'FLOW_JSON');
  return graphUpload('flows.upload_json', `/${flowId}/assets`, form, accessToken);
};

const FLOW_FIELDS = 'id,name,status,categories,validation_errors,json_version,health_status';

/** GET /{FLOW_ID} — status, validation errors, health. */
const getFlow = async (flowId: string, accessToken: string, fields = FLOW_FIELDS): Promise<MetaFlowDetails> => {
  const response = await graphHttp.get(`/${flowId}`, {
    params: { fields },
    headers: bearer(accessToken),
    operation: 'flows.get',
  });
  return response.data;
};

/** GET /{WABA_ID}/flows */
const listFlows = async (wabaId: string, accessToken: string, after?: string) => {
  const response = await graphHttp.get(`/${wabaId}/flows`, {
    params: { ...(after ? { after } : {}) },
    headers: bearer(accessToken),
    operation: 'flows.list',
  });
  return response.data as { data: MetaFlowDetails[]; paging?: { cursors?: { before?: string; after?: string } } };
};

/** GET /{FLOW_ID}/assets — includes a download_url for the current flow.json. */
const getFlowAssets = async (flowId: string, accessToken: string) => {
  const response = await graphHttp.get(`/${flowId}/assets`, {
    headers: bearer(accessToken),
    operation: 'flows.assets',
  });
  return response.data as { data: { name: string; asset_type: string; download_url: string }[] };
};

/** POST /{FLOW_ID}/publish — irreversible; the Flow can no longer be edited or deleted. */
const publishFlow = async (flowId: string, accessToken: string): Promise<{ success: boolean }> => {
  const response = await graphHttp.post(`/${flowId}/publish`, {}, { headers: bearer(accessToken), operation: 'flows.publish' });
  return response.data;
};

/** POST /{FLOW_ID}/deprecate — stops a published Flow from being sent or opened. Irreversible. */
const deprecateFlow = async (flowId: string, accessToken: string): Promise<{ success: boolean }> => {
  const response = await graphHttp.post(`/${flowId}/deprecate`, {}, { headers: bearer(accessToken), operation: 'flows.deprecate' });
  return response.data;
};

/** DELETE /{FLOW_ID} — DRAFT Flows only. */
const deleteFlow = async (flowId: string, accessToken: string): Promise<{ success: boolean }> => {
  const response = await graphHttp.delete(`/${flowId}`, { headers: bearer(accessToken), operation: 'flows.delete' });
  return response.data;
};

/** Web preview link (valid 30 days unless invalidated). */
const getFlowPreview = async (flowId: string, accessToken: string, invalidate = false) => {
  const flow = await getFlow(flowId, accessToken, `preview.invalidate(${invalidate})`);
  return flow.preview ?? null;
};

/* ----------------------------------------------------
   Message templates
-----------------------------------------------------*/

export interface MetaTemplateCreateRequest {
  name: string;
  language: string;
  category: 'MARKETING' | 'UTILITY';
  components: Record<string, unknown>[];
}

/** POST /{WABA_ID}/message_templates — the template starts in review (PENDING). */
const createMessageTemplate = async (wabaId: string, accessToken: string, body: MetaTemplateCreateRequest) => {
  log.debug('Creating message template', { wabaId, name: body.name, language: body.language });
  const response = await graphHttp.post(`/${wabaId}/message_templates`, body, {
    headers: bearer(accessToken),
    operation: 'templates.create',
  });
  return response.data as { id: string; status: string; category: string };
};

export interface MetaTemplateDetails {
  id: string;
  name?: string;
  language?: string;
  status: string;
  category?: string;
  rejected_reason?: string;
}

/**
 * GET /{TEMPLATE_ID}?fields=… — current status of one template.
 * `rejected_reason` is requested first; if this API version refuses the field, retry with the
 * documented minimum so status sync never breaks on it.
 */
const getMessageTemplate = async (templateId: string, accessToken: string): Promise<MetaTemplateDetails> => {
  const get = (fields: string) =>
    graphHttp.get(`/${templateId}`, { params: { fields }, headers: bearer(accessToken), operation: 'templates.get' });
  try {
    return (await get('id,name,language,status,category,rejected_reason')).data;
  } catch (err) {
    if ((err as { code?: string })?.code !== 'META_INVALID_REQUEST') throw err;
    log.debug('rejected_reason not accepted; retrying template status with basic fields', { templateId });
    return (await get('id,name,language,status,category')).data;
  }
};

/** DELETE /{WABA_ID}/message_templates?hsm_id=…&name=… — deletes exactly this template. */
const deleteMessageTemplate = async (wabaId: string, accessToken: string, name: string, templateId: string) => {
  const response = await graphHttp.delete(`/${wabaId}/message_templates`, {
    params: { name, hsm_id: templateId },
    headers: bearer(accessToken),
    operation: 'templates.delete',
  });
  return response.data as { success: boolean };
};

/* ----------------------------------------------------
   Interactive Flow message (inside the 24h customer service window)
-----------------------------------------------------*/

const sendInteractiveFlowMessage = async (
  phoneNumberId: string,
  accessToken: string,
  to: string,
  params: {
    flowId: string;
    flowToken: string;
    cta: string;
    bodyText: string;
    headerText?: string;
    footerText?: string;
    screen: string;
  }
) => {
  const response = await graphHttp.post(
    `/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'flow',
        ...(params.headerText ? { header: { type: 'text', text: params.headerText } } : {}),
        body: { text: params.bodyText },
        ...(params.footerText ? { footer: { text: params.footerText } } : {}),
        action: {
          name: 'flow',
          parameters: {
            flow_message_version: '3',
            flow_token: params.flowToken,
            flow_id: params.flowId,
            flow_cta: params.cta,
            flow_action: 'navigate',
            flow_action_payload: { screen: params.screen },
          },
        },
      },
    },
    { headers: bearer(accessToken), operation: 'whatsapp.send_flow' }
  );
  return response.data;
};

export const flowsApi = {
  createFlow,
  uploadFlowJson,
  getFlow,
  listFlows,
  getFlowAssets,
  publishFlow,
  deprecateFlow,
  deleteFlow,
  getFlowPreview,
  createMessageTemplate,
  getMessageTemplate,
  deleteMessageTemplate,
  sendInteractiveFlowMessage,
};

export default flowsApi;
