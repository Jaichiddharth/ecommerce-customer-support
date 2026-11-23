import { getTemplateSendFields, type TemplateSendField } from '@/lib/whatsapp-templates';
import type { WhatsAppTemplate } from '@/types/templates';
import type { CampaignVariableSource as VariableSource } from '@/lib/db/schema/campaigns';
import type { CampaignRecipient } from './contact-file';

/** Fields the user maps; a media header always sends the template's approved sample, so it isn't mapped */
export const mappableFields = (tpl: WhatsAppTemplate | null): TemplateSendField[] =>
  tpl ? getTemplateSendFields(tpl).filter((f) => f.kind !== 'header_media') : [];

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Pre-fills variables whose name matches a column (`{{first_name}}` ↔ "First Name") */
export function autoMapVariables(tpl: WhatsAppTemplate, columns: string[]): Record<string, VariableSource> {
  const map: Record<string, VariableSource> = {};
  for (const field of mappableFields(tpl)) {
    const name = field.paramName ?? (field.kind === 'coupon_code' ? 'coupon' : '');
    if (!name) continue;
    const column = columns.find((c) => normalize(c) === normalize(name)) ?? columns.find((c) => normalize(c).includes(normalize(name)));
    if (column) map[field.id] = { type: 'column', column };
  }
  return map;
}

/** The values one recipient's message is sent with, keyed by field id; an empty cell uses the column's fallback */
export function resolveValues(
  variables: Record<string, VariableSource>,
  recipient: { fields?: CampaignRecipient['fields'] | null } | undefined
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [id, source] of Object.entries(variables)) {
    values[id] = source.type === 'text' ? source.value : recipient?.fields?.[source.column]?.trim() || source.fallback?.trim() || '';
  }
  return values;
}

/** Contacts with an empty cell in the column a variable is mapped to (0 for fixed text or unknown counts) */
export const emptyCellCount = (source: VariableSource | undefined, emptyCells: Record<string, number> | undefined) =>
  source?.type === 'column' && source.column ? emptyCells?.[source.column] ?? 0 : 0;

/**
 * Fields that still need a column or a value. With `emptyCells` (from the import), a column that is empty for
 * some contacts also needs a fallback value, since Meta rejects a message with an empty variable (131008).
 */
export function unmappedFields(
  tpl: WhatsAppTemplate | null,
  variables: Record<string, VariableSource>,
  emptyCells?: Record<string, number>
): TemplateSendField[] {
  return mappableFields(tpl).filter((f) => {
    const source = variables[f.id];
    if (!source) return true;
    if (source.type === 'text') return !source.value.trim();
    if (!source.column) return true;
    return emptyCellCount(source, emptyCells) > 0 && !source.fallback?.trim();
  });
}

/** Fields that would be sent empty to this recipient (they'd fail with 131008, so the message isn't sent) */
export function emptyFieldsFor(
  tpl: WhatsAppTemplate,
  variables: Record<string, VariableSource>,
  values: Record<string, string>
): TemplateSendField[] {
  return mappableFields(tpl).filter((f) => variables[f.id] && !values[f.id]?.trim());
}
