'use strict';

/**
 * Polling triggers for Zapier (docs/v1-contract.md §5 and §5.6).
 *
 * Zapier keeps no cursor for us and deduplicates by the `id` of each result, so every poll
 * reads the newest page (`sort=<field>:desc`, 100 items) with the same filters as the other
 * connectors, and returns it newest first with `id = eventId`. The entity id goes in
 * `cardId` / `contactId` / `taskId` next to the canonical fields.
 */
const { CARD_POPULATE, MAX_PAGE_SIZE } = require('./constants');
const { inputError } = require('./errors');
const { toCard, toContact, toTask, unwrapList } = require('./mappers');

const enc = encodeURIComponent;

function time(value) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Newest first; ties keep the API order. Drops items without event id or timestamp. */
function newestFirst(events) {
  return events
    .filter((event) => event && event.eventId && event.eventAt)
    .map((event, index) => ({ event, index }))
    .sort((a, b) => time(b.event.eventAt) - time(a.event.eventAt) || a.index - b.index)
    .map(({ event }) => event);
}

/** One Zapier result: canonical object + entity id key + eventId/eventAt, with id = eventId. */
function toResult(entity, entityKey, eventId, eventAt) {
  return { ...entity, [entityKey]: entity.id, id: eventId, eventId, eventAt };
}

function cardEvent(card, event) {
  if (event === 'newCard') {
    return card.createdAt ? toResult(card, 'cardId', card.id, card.createdAt) : undefined;
  }
  if (!card.phaseEnteredAt) return undefined;
  return toResult(
    card,
    'cardId',
    `${card.id}:${card.phaseId ?? ''}:${card.phaseEnteredAt}`,
    card.phaseEnteredAt,
  );
}

function contactEvent(contact) {
  return contact.createdAt
    ? toResult(contact, 'contactId', contact.id, contact.createdAt)
    : undefined;
}

function taskEvent(task) {
  return task.completedAt
    ? toResult(task, 'taskId', `${task.id}:${task.completedAt}`, task.completedAt)
    : undefined;
}

/** New Card / Card Entered Phase: GET /boards/{boardId}/cards, newest first. */
async function pollCards(client, input, event) {
  const boardId = String(input.boardId ?? '').trim();
  if (!boardId) throw inputError(client.z, 'Choose the board to watch.');
  const phaseId = String(input.phaseId ?? '').trim();
  const field = event === 'newCard' ? 'createdAt' : 'currentPhaseEnteredAt';
  const filters = {};
  if (event === 'cardEnteredPhase') {
    filters.currentPhaseEnteredAt = { $notNull: true };
    if (phaseId) filters.currentPhase = { documentId: { $eq: phaseId } };
  }
  const response = await client.request('GET', `/boards/${enc(boardId)}/cards`, {
    query: {
      filters,
      sort: `${field}:desc`,
      stats: 'false',
      populate: CARD_POPULATE,
      pagination: { page: 1, pageSize: MAX_PAGE_SIZE },
    },
  });
  return newestFirst(unwrapList(response).map((raw) => cardEvent(toCard(raw, boardId), event)));
}

/** New Contact: GET /contacts, newest first. */
async function pollContacts(client) {
  const response = await client.request('GET', '/contacts', {
    query: { sort: 'createdAt:desc', pagination: { page: 1, pageSize: MAX_PAGE_SIZE } },
  });
  return newestFirst(unwrapList(response).map((raw) => contactEvent(toContact(raw))));
}

/** Task Completed: GET /tasks (plain array, limit/offset), newest completion first. */
async function pollCompletedTasks(client, input) {
  const boardId = String(input.boardId ?? '').trim();
  const filters = { completedAt: { $notNull: true } };
  if (boardId) filters.board = { documentId: boardId };
  const response = await client.request('GET', '/tasks', {
    query: { filters, sort: 'completedAt:desc', limit: MAX_PAGE_SIZE, offset: 0 },
  });
  return newestFirst(unwrapList(response).map((raw) => taskEvent(toTask(raw))));
}

module.exports = {
  newestFirst,
  cardEvent,
  contactEvent,
  taskEvent,
  pollCards,
  pollContacts,
  pollCompletedTasks,
};
