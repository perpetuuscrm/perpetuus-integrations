'use strict';

/**
 * Maps raw Perpetuus (Strapi) payloads to the flat, stable output objects of the v1 contract
 * (docs/v1-contract.md §4). Every key is always present; missing values become null.
 * Ported from n8n/nodes/Perpetuus/shared/mappers.ts.
 */

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** `{ data: {...} }` or the object itself. */
function unwrapOne(payload) {
  if (!isObject(payload)) return null;
  if (isObject(payload.data)) {
    const inner = payload.data;
    // Some routes double-wrap: { data: { data: {...} } }
    if (isObject(inner.data) && !('documentId' in inner)) return inner.data;
    return inner;
  }
  return payload;
}

/** `{ data: [...] }`, a plain array, or `{ data: { data: [...] } }`. */
function unwrapList(payload) {
  if (Array.isArray(payload)) return payload.filter(isObject);
  if (isObject(payload)) {
    if (Array.isArray(payload.data)) return payload.data.filter(isObject);
    if (isObject(payload.data) && Array.isArray(payload.data.data)) {
      return payload.data.data.filter(isObject);
    }
  }
  return [];
}

function pageCountOf(payload) {
  if (!isObject(payload) || !isObject(payload.meta) || !isObject(payload.meta.pagination)) {
    return undefined;
  }
  const value = Number(payload.meta.pagination.pageCount);
  return Number.isFinite(value) ? value : undefined;
}

function str(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

function num(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** documentId of a relation that may come populated (`{ documentId }`) or as a bare id. */
function relationId(value) {
  if (isObject(value)) return str(value.documentId);
  if (typeof value === 'string' && value) return value;
  return null;
}

function relationList(value) {
  if (Array.isArray(value)) return value.filter(isObject);
  if (isObject(value) && Array.isArray(value.data)) return value.data.filter(isObject);
  return [];
}

function contactTypeFromApi(value) {
  // The REST API stores pessoa/empresa; webhook samples may already use person/company.
  if (value === 'pessoa' || value === 'person') return 'person';
  if (value === 'empresa' || value === 'company') return 'company';
  return null;
}

function contactTypeToApi(value) {
  if (value === 'person') return 'pessoa';
  if (value === 'company') return 'empresa';
  return undefined;
}

function plainObject(value) {
  return isObject(value) ? { ...value } : {};
}

function toContact(raw) {
  return {
    id: String(raw.documentId ?? ''),
    name: str(raw.name),
    email: str(raw.email),
    phone: str(raw.phone),
    contactType: contactTypeFromApi(raw.contact_type),
    cpf: str(raw.cpf),
    cnpj: str(raw.cnpj),
    address: str(raw.address),
    city: str(raw.city),
    state: str(raw.state),
    country: str(raw.country),
    postalCode: str(raw.postal_code),
    customFields: plainObject(raw.customFields),
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
  };
}

function toUpsertedContact(payload) {
  const contact = toContact(unwrapOne(payload) ?? {});
  const meta = isObject(payload) && isObject(payload.meta) ? payload.meta : {};
  const otherMatches = Array.isArray(meta.otherMatches) ? meta.otherMatches : [];
  return {
    ...contact,
    created: meta.created === true,
    matchedBy: str(meta.matchedBy),
    otherMatchIds: otherMatches.map((entry) => relationId(entry)).filter(Boolean),
  };
}

/** Field values are stored as `{ val: x }`; unwrap them. */
function unwrapFieldValue(value) {
  if (isObject(value) && 'val' in value) return value.val;
  return value ?? null;
}

/** Builds the slug → value map from `fieldData[]` when the API did not send `fields`. */
function flattenFieldData(fieldData) {
  const out = {};
  for (const entry of relationList(fieldData)) {
    const field = entry.field;
    const slug = isObject(field) ? str(field.slug) : str(field);
    if (!slug) continue;
    out[slug] = unwrapFieldValue(entry.value);
  }
  return out;
}

function toCard(raw, fallbackBoardId) {
  const phase = isObject(raw.currentPhase) ? raw.currentPhase : undefined;
  const contact = isObject(raw.contact) ? raw.contact : undefined;
  const tags = relationList(raw.tags);
  const fields = isObject(raw.fields) ? { ...raw.fields } : flattenFieldData(raw.fieldData);
  return {
    id: String(raw.documentId ?? ''),
    title: str(raw.title),
    boardId: relationId(raw.board) ?? fallbackBoardId ?? null,
    phaseId: relationId(raw.currentPhase),
    phaseName: phase ? str(phase.name) : null,
    phaseEnteredAt: str(raw.currentPhaseEnteredAt),
    contactId: relationId(raw.contact),
    contactName: contact ? str(contact.name) : null,
    contactEmail: contact ? str(contact.email) : null,
    contactPhone: contact ? str(contact.phone) : null,
    value: num(raw.value),
    dueDate: str(raw.dueDate),
    description: str(raw.description),
    tagIds: tags.map((tag) => str(tag.documentId)).filter(Boolean),
    tagNames: tags.map((tag) => str(tag.name)).filter(Boolean),
    fields,
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
  };
}

function toTask(raw, fallbackCardId) {
  const card = isObject(raw.card) ? raw.card : undefined;
  return {
    id: String(raw.documentId ?? ''),
    name: str(raw.name),
    description: str(raw.description),
    type: str(raw.type),
    priority: str(raw.priority),
    status: str(raw.taskStatus),
    dueDate: str(raw.dueDate),
    completedAt: str(raw.completedAt),
    cardId: relationId(raw.card) ?? fallbackCardId ?? null,
    cardTitle: card ? str(card.title) : null,
    assigneeIds: relationList(raw.assignees)
      .map((member) => str(member.documentId))
      .filter(Boolean),
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
  };
}

/**
 * Digits used to search a contact by phone with `quickSearch` (a `contains` match):
 * keeps only numbers and drops the 55 country code when the number has 12+ digits,
 * so `+55 (11) 99999-9999` matches a phone stored as `+5511999999999`.
 */
function phoneSearchDigits(phone) {
  const digits = String(phone).replace(/\D+/g, '');
  if (digits.length >= 12 && digits.startsWith('55')) return digits.slice(2);
  return digits;
}

/** Drops undefined, null, '' and empty arrays so optional inputs are never sent. */
function compact(input) {
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

module.exports = {
  isObject,
  unwrapOne,
  unwrapList,
  pageCountOf,
  relationId,
  contactTypeFromApi,
  contactTypeToApi,
  toContact,
  toUpsertedContact,
  flattenFieldData,
  toCard,
  toTask,
  phoneSearchDigits,
  compact,
};
