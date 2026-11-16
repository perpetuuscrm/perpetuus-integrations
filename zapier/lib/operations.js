'use strict';

/**
 * Perpetuus operations of the v1 contract, ported from n8n/nodes/Perpetuus/shared/operations.ts.
 * Each function takes the client from lib/client.js and documents the REST calls it makes.
 */
const { CARD_POPULATE, MAX_PAGE_SIZE, NON_VALUE_FIELD_TYPES } = require('./constants');
const { inputError } = require('./errors');
const {
  compact,
  contactTypeToApi,
  pageCountOf,
  phoneSearchDigits,
  relationId,
  toCard,
  toContact,
  toTask,
  toUpsertedContact,
  unwrapList,
  unwrapOne,
} = require('./mappers');

const enc = encodeURIComponent;

function text(value) {
  if (value === undefined || value === null) return undefined;
  const out = String(value).trim();
  return out || undefined;
}

/** Lists may arrive as arrays or comma-separated text; empty entries are dropped. */
function toList(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const list = Array.isArray(value) ? value : String(value).split(',');
  const out = list.map((entry) => String(entry ?? '').trim()).filter(Boolean);
  return out.length ? out : undefined;
}

// ─── Pagination ──────────────────────────────────────────────────────────────

/** Reads `{ data, meta.pagination }` pages until `limit` items were collected. */
async function paginate(client, path, query, limit) {
  const out = [];
  for (let page = 1; ; page++) {
    const remaining = limit - out.length;
    if (remaining <= 0) break;
    const pageSize = Math.min(MAX_PAGE_SIZE, remaining);
    const response = await client.request('GET', path, {
      query: { ...query, pagination: { page, pageSize } },
    });
    const items = unwrapList(response);
    out.push(...items);
    const pageCount = pageCountOf(response);
    if (items.length < pageSize) break;
    if (pageCount !== undefined && page >= pageCount) break;
  }
  return out.slice(0, limit);
}

// ─── Contacts ────────────────────────────────────────────────────────────────

/** POST /contacts/upsert */
async function upsertContact(client, input) {
  const email = text(input.email);
  const phone = text(input.phone);
  if (!email && !phone) {
    throw inputError(client.z, 'Provide an email or a phone to find or create the contact.');
  }
  const customFields = {};
  for (const [key, value] of Object.entries(input.customFields || {})) {
    if (!String(key).trim() || value === undefined || value === null || value === '') continue;
    customFields[String(key).trim()] = value;
  }
  const data = compact({
    name: text(input.name),
    email,
    phone,
    contact_type: contactTypeToApi(input.contactType),
    cpf: text(input.cpf),
    cnpj: text(input.cnpj),
    address: text(input.address),
    city: text(input.city),
    state: text(input.state),
    country: text(input.country),
    postal_code: text(input.postalCode),
    customFields: Object.keys(customFields).length ? customFields : undefined,
  });
  const body = { data };
  const matchBy = toList(input.matchBy);
  if (matchBy) body.matchBy = matchBy;
  const response = await client.request('POST', '/contacts/upsert', { body });
  return toUpsertedContact(response);
}

/** GET /contacts with an exact email filter, a phone quickSearch or a text quickSearch. */
async function findContacts(client, input) {
  const value = text(input.value);
  if (!value) throw inputError(client.z, 'Provide the value to search for.');
  let query;
  if (input.searchBy === 'email') {
    query = { filters: { email: { $eqi: value } }, sort: 'createdAt:asc' };
  } else if (input.searchBy === 'phone') {
    const digits = phoneSearchDigits(value);
    if (!digits) throw inputError(client.z, 'The phone must contain digits.');
    query = { quickSearch: digits, sort: 'createdAt:asc' };
  } else if (input.searchBy === 'text') {
    query = { quickSearch: value, sort: 'updatedAt:desc' };
  } else {
    throw inputError(client.z, 'Choose how to search: email, phone or text.');
  }
  const items = await paginate(client, '/contacts', query, input.limit);
  return items.map(toContact);
}

// ─── Cards ───────────────────────────────────────────────────────────────────

/** GET /boards/{boardId}/cards/{cardId} with the standard card populate. */
async function getCard(client, boardId, cardId) {
  const response = await client.request('GET', `/boards/${enc(boardId)}/cards/${enc(cardId)}`, {
    query: { populate: CARD_POPULATE },
  });
  const raw = unwrapOne(response);
  if (!raw) throw inputError(client.z, `Card ${cardId} was not returned by Perpetuus.`);
  return toCard(raw, boardId);
}

/**
 * POST /boards/{boardId}/cards, then PUT currentPhase when `phaseId` differs from the
 * initial phase (the API always creates cards in the first workflow phase), then GET.
 * A failed move does not fail the step: the created card comes back with `warning`.
 */
async function createCard(client, input) {
  const boardId = text(input.boardId);
  const title = text(input.title);
  if (!boardId) throw inputError(client.z, 'Choose the board of the card.');
  if (!title) throw inputError(client.z, 'The card title is required.');

  const fields = {};
  for (const [slug, raw] of Object.entries(input.fields || {})) {
    const value = Array.isArray(raw) ? raw.filter((entry) => entry !== '' && entry != null) : raw;
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    fields[slug] = value;
  }
  fields.name = title;

  const data = compact({
    fields,
    contact: text(input.contactId),
    tags: toList(input.tagIds),
    assignees: toList(input.assigneeIds),
    value: input.value,
    dueDate: text(input.dueDate),
    description: text(input.description),
  });

  const created = unwrapOne(
    await client.request('POST', `/boards/${enc(boardId)}/cards`, { body: { data } }),
  );
  const cardId = created ? relationId(created.documentId) : null;
  if (!created || !cardId) {
    throw inputError(client.z, 'Perpetuus did not return the created card.');
  }

  let warning;
  const phaseId = text(input.phaseId);
  const initialPhaseId = relationId(created.currentPhase);
  if (phaseId && phaseId !== initialPhaseId) {
    try {
      await client.request('PUT', `/boards/${enc(boardId)}/cards/${enc(cardId)}`, {
        body: { data: { currentPhase: phaseId } },
      });
    } catch (error) {
      warning = `Card created in the initial phase, but moving it to phase ${phaseId} failed: ${errorText(error)}`;
    }
  }

  const card = await getCard(client, boardId, cardId);
  return warning ? { ...card, warning } : card;
}

/** Zapier errors carry a JSON message ({ message, code, status }); keep the readable part. */
function errorText(error) {
  const raw = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.message === 'string') return parsed.message;
  } catch {
    // Not JSON.
  }
  return raw;
}

/** PUT /boards/{boardId}/cards/{cardId} with `currentPhase`, then GET. */
async function moveCard(client, input) {
  const boardId = text(input.boardId);
  const cardId = text(input.cardId);
  const phaseId = text(input.phaseId);
  if (!boardId || !cardId) throw inputError(client.z, 'Choose the board and the card.');
  if (!phaseId) throw inputError(client.z, 'Choose the phase to move the card to.');
  const data = compact({ currentPhase: phaseId, reason: text(input.reason) });
  await client.request('PUT', `/boards/${enc(boardId)}/cards/${enc(cardId)}`, { body: { data } });
  return getCard(client, boardId, cardId);
}

/** The API replaces `tags` on PUT, so: GET the current tags, merge, PUT the union, GET. */
async function addCardTags(client, input) {
  const boardId = text(input.boardId);
  const cardId = text(input.cardId);
  if (!boardId || !cardId) throw inputError(client.z, 'Choose the board and the card.');
  const wanted = toList(input.tagIds) || [];
  if (!wanted.length) throw inputError(client.z, 'Choose at least one tag to add.');
  const path = `/boards/${enc(boardId)}/cards/${enc(cardId)}`;
  const current = unwrapOne(await client.request('GET', path, { query: { populate: ['tags'] } }));
  const existing = unwrapList({ data: current?.tags })
    .map((tag) => relationId(tag.documentId))
    .filter(Boolean);
  const merged = [...existing];
  for (const id of wanted) if (!merged.includes(id)) merged.push(id);
  if (merged.length !== existing.length) {
    await client.request('PUT', path, { body: { data: { tags: merged } } });
  }
  return getCard(client, boardId, cardId);
}

/** GET /boards/{boardId}/cards filtered by title, phase and contact, newest update first. */
async function findCards(client, input) {
  const boardId = text(input.boardId);
  if (!boardId) throw inputError(client.z, 'Choose the board to search in.');
  const filters = {};
  const query = text(input.query);
  const phaseId = text(input.phaseId);
  const contactId = text(input.contactId);
  if (query) filters.title = { $containsi: query };
  if (phaseId) filters.currentPhase = { documentId: { $eq: phaseId } };
  if (contactId) filters.contact = { documentId: { $eq: contactId } };
  const items = await paginate(
    client,
    `/boards/${enc(boardId)}/cards`,
    { filters, sort: 'updatedAt:desc', stats: 'false', populate: CARD_POPULATE },
    input.limit,
  );
  return items.map((raw) => toCard(raw, boardId));
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

/** POST /tasks (the API takes the board from the card when a card is given). */
async function createTask(client, input) {
  const name = text(input.name);
  const boardId = text(input.boardId);
  const cardId = text(input.cardId);
  if (!name) throw inputError(client.z, 'The task name is required.');
  if (!boardId && !cardId) throw inputError(client.z, 'Choose a board or a card for the task.');
  const data = compact({
    name,
    card: cardId,
    board: cardId ? undefined : boardId,
    description: text(input.description),
    dueDate: text(input.dueDate),
    type: text(input.type),
    priority: text(input.priority),
    taskStatus: text(input.status),
    assignees: toList(input.assigneeIds),
  });
  const response = await client.request('POST', '/tasks', { body: { data } });
  return toTask(unwrapOne(response) ?? {}, cardId);
}

// ─── Board structure (dropdowns and dynamic fields) ──────────────────────────

function toOptions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((option) => {
      if (option && typeof option === 'object') {
        const value = option.value ?? option.label ?? option.name;
        const name = option.label ?? option.name ?? option.value;
        return value === undefined || value === null ? null : { name: String(name), value: String(value) };
      }
      return option === undefined || option === null
        ? null
        : { name: String(option), value: String(option) };
    })
    .filter(Boolean);
}

/** GET /boards/{boardId}/structure?include=phases,fields,tags */
async function getBoardStructure(client, boardId, include = ['phases', 'fields', 'tags']) {
  const response = await client.request('GET', `/boards/${enc(boardId)}/structure`, {
    query: { include: include.join(',') },
  });
  const structure = unwrapOne(response) ?? {};
  const phases = unwrapList({ data: structure.phases })
    .map((phase) => ({
      id: String(phase.documentId ?? ''),
      name: String(phase.name ?? phase.documentId ?? ''),
      order: Number(phase.order ?? 0),
      kind: phase.kind === undefined || phase.kind === null ? null : String(phase.kind),
      fields: unwrapList({ data: phase.fields }).map((field) => ({
        id: String(field.documentId ?? ''),
        slug: String(field.slug ?? ''),
        label: String(field.label ?? field.slug ?? ''),
        type: String(field.type ?? 'text'),
        required: field.required === true,
        options: toOptions(field.options),
      })),
    }))
    .filter((phase) => phase.id)
    .sort((a, b) => a.order - b.order);
  const tags = unwrapList({ data: structure.tags })
    .map((tag) => ({
      name: String(tag.name ?? tag.slug ?? tag.documentId),
      value: String(tag.documentId ?? ''),
    }))
    .filter((tag) => tag.value);
  return { phases, tags };
}

/**
 * Custom fields a card can receive: every phase field with a value, except the title
 * (`name`, exposed as its own input). Duplicated slugs keep the first phase. Only fields of
 * the form phase (order 0) are required on creation.
 */
function cardFieldDefinitions(structure) {
  const seen = new Set(['name']);
  const out = [];
  for (const phase of structure.phases) {
    for (const field of phase.fields) {
      if (!field.slug || seen.has(field.slug)) continue;
      if (NON_VALUE_FIELD_TYPES.includes(field.type)) continue;
      seen.add(field.slug);
      out.push({
        ...field,
        phaseName: phase.name,
        requiredOnCreate: phase.order === 0 && field.required && field.type !== 'hidden',
      });
    }
  }
  return out;
}

/** GET /boards/{boardId}/members */
async function listBoardMembers(client, boardId) {
  const response = await client.request('GET', `/boards/${enc(boardId)}/members`);
  const list =
    response && typeof response === 'object' && Array.isArray(response.members)
      ? response.members
      : unwrapList(response);
  return list
    .map((member) => {
      const user = member.user && typeof member.user === 'object' ? member.user : {};
      const label = member.displayName ?? user.name ?? user.username ?? user.email ?? member.documentId;
      return {
        id: String(member.documentId ?? ''),
        name: String(label),
        email: user.email ? String(user.email) : null,
      };
    })
    .filter((member) => member.id);
}

module.exports = {
  paginate,
  upsertContact,
  findContacts,
  getCard,
  createCard,
  moveCard,
  addCardTags,
  findCards,
  createTask,
  getBoardStructure,
  cardFieldDefinitions,
  listBoardMembers,
  errorText,
  toList,
};
