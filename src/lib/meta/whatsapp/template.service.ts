import { AppError } from '../../errors';
import { graphHttp } from '../graph-client';
import type { TemplateComponent } from '@/types/templates';

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

const TEMPLATE_FIELDS = 'id,name,status,category,language,components,quality_score,rejected_reason';

export interface GetTemplatesOptions {
  limit?: number;
  after?: string;
  before?: string;
  name?: string;
  status?: string;
  category?: string;
}

/** List a WABA's message templates (Meta supports name/status/category filters natively) */
export const getAllTemplates = async (wabaId: string, token: string, options: GetTemplatesOptions = {}) => {
  const { limit = 50, ...filters } = options;
  const response = await graphHttp.get(`/${wabaId}/message_templates`, {
    params: { limit, fields: TEMPLATE_FIELDS, ...filters },
    headers: bearer(token),
    operation: 'waba.templates_list',
  });
  return {
    data: response.data?.data ?? [],
    paging: response.data?.paging ?? null,
  };
};

/** One template by id */
export const getTemplate = async (templateId: string, token: string) => {
  const response = await graphHttp.get(`/${templateId}`, {
    params: { fields: TEMPLATE_FIELDS },
    headers: bearer(token),
    operation: 'waba.template_get',
  });
  return response.data as { id: string; name: string; status: string; components: TemplateComponent[] };
};

export interface CreateTemplatePayload {
  name: string;
  category: string;
  language: string;
  components: TemplateComponent[];
}

/** Submit a new template for review. Returns `{ id, status, category }` */
export const createTemplate = async (wabaId: string, token: string, payload: CreateTemplatePayload) => {
  const response = await graphHttp.post(`/${wabaId}/message_templates`, payload, {
    headers: bearer(token),
    operation: 'waba.template_create',
  });
  return response.data as { id: string; status: string; category: string };
};

export interface UpdateTemplatePayload {
  components?: TemplateComponent[];
  category?: string;
}

/**
 * Edit a template. Meta allows this only for APPROVED, REJECTED or PAUSED templates,
 * once per 24h and up to 10 times per 30 days. Name and language can't be changed.
 */
export const updateTemplate = async (templateId: string, token: string, payload: UpdateTemplatePayload) => {
  const response = await graphHttp.post(`/${templateId}`, payload, {
    headers: bearer(token),
    operation: 'waba.template_update',
  });
  return response.data as { success: boolean };
};

/** Delete one language version (with `hsmId`) or every language version of `templateName` */
export const deleteTemplate = async (wabaId: string, token: string, templateName: string, hsmId?: string) => {
  const response = await graphHttp.delete(`/${wabaId}/message_templates`, {
    params: { name: templateName, ...(hsmId ? { hsm_id: hsmId } : {}) },
    headers: bearer(token),
    operation: 'waba.template_delete',
  });
  return response.data as { success: boolean };
};

/**
 * Upload a sample header file via Meta's Resumable Upload API.
 * Returns the handle (`h`) used in a media header's `example.header_handle`.
 */
export const uploadTemplateMedia = async (token: string, file: Buffer, mimeType: string): Promise<string> => {
  const appId = process.env.META_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID;
  if (!appId) {
    throw new AppError('INTERNAL_ERROR', { message: 'META_APP_ID is not configured, so header samples cannot be uploaded.' });
  }

  const session = await graphHttp.post(`/${appId}/uploads`, null, {
    params: { file_length: file.length, file_type: mimeType },
    headers: bearer(token),
    operation: 'waba.template_upload_start',
  });

  const upload = await graphHttp.post(`/${session.data.id}`, file, {
    headers: { Authorization: `OAuth ${token}`, file_offset: '0', 'Content-Type': mimeType },
    maxBodyLength: Infinity,
    operation: 'waba.template_upload',
  });

  const handle = upload.data?.h;
  if (!handle) {
    throw new AppError('FILE_UPLOAD_FAILED', {
      message: 'Meta accepted the upload but returned no file handle. Please try again.',
      provider: { name: 'meta', operation: 'waba.template_upload', message: 'Response had no h' },
    });
  }
  return handle as string;
};
