'use strict';

/**
 * Perpetuus outgoing webhooks v1 (PRD-010, docs/v1-contract.md §5.7). Copied from
 * zapier/lib/webhooks.js (ported from the n8n node); keep the copies in sync. Pluga changes:
 * origin defaults to `api` (the API does not accept `pluga` yet) and errors use src/errors.js.
 *
 * Zapier notes kept for reference:
 *
 * - performSubscribe: `POST /webhook-subscriptions` `{ url: bundle.targetUrl, events, boardId?,
 *   origin: 'zapier', description }`. Zapier keeps the response (id + signing secret) in
 *   `bundle.subscribeData`.
 * - perform: the delivery `{ id, type, timestamp, tenant, data }`, checked against
 *   `X-Perpetuus-Signature` when Zapier passes the raw request, then mapped to the same
 *   canonical result as the polling triggers (same `id` / `eventId` / `eventAt`).
 * - performUnsubscribe: `DELETE /webhook-subscriptions/{id}` (404 counts as deleted). The API
 *   also deletes the subscription when Zapier answers 410 Gone.
 */
const crypto = require('crypto');

const { isObject, toCard, toContact, unwrapList, unwrapOne } = require('./mappers');
const { UpstreamError } = require('../errors');

const enc = encodeURIComponent;

/** API events behind each trigger. A new card counts as entering its first phase. */
const WEBHOOK_EVENTS = {
  newCard: ['card.created'],
  cardEnteredPhase: ['card.created', 'card.phase_changed'],
  newContact: ['contact.created'],
  newMessage: ['message.received'],
};

/** Deliveries older than this (by X-Perpetuus-Timestamp) are rejected as replays. */
const SIGNATURE_TOLERANCE_SECONDS = 300;

function str(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

function toSubscription(payload) {
  const raw = unwrapOne(payload) || {};
  return {
    id: String(raw.id ?? raw.documentId ?? ''),
    url: str(raw.url),
    events: Array.isArray(raw.events) ? raw.events.map(String) : [],
    boardId: str(raw.boardId),
    status: str(raw.status),
    secret: str(raw.secret),
  };
}

async function subscribe(client, { url, event, boardId, origin = 'api', description }) {
  const body = { url, events: WEBHOOK_EVENTS[event], origin };
  const board = String(boardId ?? '').trim();
  if (board && event !== 'newContact') body.boardId = board;
  if (description) body.description = String(description).slice(0, 500);
  const subscription = toSubscription(
    await client.request('POST', '/webhook-subscriptions', { body }),
  );
  if (!subscription.id) {
    throw new UpstreamError('Perpetuus did not return the webhook subscription id.');
  }
  return subscription;
}

/** ApiError from src/client.js carries the HTTP status. */
function isNotFound(error) {
  return Boolean(error) && error.status === 404;
}

async function unsubscribe(client, id) {
  if (!id) return { deleted: false };
  try {
    await client.request('DELETE', `/webhook-subscriptions/${enc(id)}`);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  return { id, deleted: true };
}

/** Header lookup that also accepts Zapier's `Http-X-…` raw request header names. */
function headerValue(headers, name) {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    const normalized = key.toLowerCase().replace(/^http[-_]/, '').replace(/_/g, '-');
    if (normalized !== wanted) continue;
    return Array.isArray(value) ? str(value[0]) : str(value);
  }
  return null;
}

function verifySignature(secret, headers, rawBody, nowSeconds = Math.floor(Date.now() / 1000)) {
  const signature = headerValue(headers, 'x-perpetuus-signature');
  const timestamp = headerValue(headers, 'x-perpetuus-timestamp');
  if (!signature || !timestamp) return { ok: false, reason: 'missing signature headers' };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'invalid timestamp' };
  if (Math.abs(nowSeconds - ts) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'timestamp outside the tolerance window' };
  }
  const expected = Buffer.from(
    `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex')}`,
  );
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    return { ok: false, reason: 'signature mismatch' };
  }
  return { ok: true };
}

function parseEnvelope(body) {
  if (!isObject(body) || typeof body.type !== 'string') return undefined;
  return {
    id: String(body.id ?? ''),
    type: body.type,
    timestamp: str(body.timestamp),
    data: isObject(body.data) ? body.data : {},
  };
}

/** Flat output of New Message (`message.received`). */
function toMessage(data) {
  const message = isObject(data.message) ? data.message : {};
  const sender = isObject(message.sender) ? message.sender : {};
  const conversation = isObject(data.conversation) ? data.conversation : {};
  const contact = isObject(data.contact) ? data.contact : {};
  const card = isObject(data.card) ? data.card : {};
  const board = isObject(card.board) ? card.board : {};
  const phase = isObject(card.currentPhase) ? card.currentPhase : {};
  return {
    id: str(message.id),
    content: typeof message.content === 'string' ? message.content : '',
    messageType: str(message.messageType),
    sentAt: str(message.createdAt),
    senderId: str(sender.id),
    senderName: str(sender.name),
    senderType: str(sender.type),
    attachments: (Array.isArray(message.attachments) ? message.attachments : [])
      .filter(isObject)
      .map((a) => ({ id: str(a.id), fileType: str(a.fileType), url: str(a.url) })),
    conversationId: str(conversation.id),
    conversationStatus: str(conversation.status),
    inboxId: str(conversation.inboxId),
    contactId: str(contact.documentId),
    contactName: str(contact.name),
    contactEmail: str(contact.email),
    contactPhone: str(contact.phone),
    cardId: str(card.documentId),
    cardTitle: str(card.title),
    boardId: str(board.documentId),
    phaseId: str(phase.documentId),
    phaseName: str(phase.name),
  };
}

/** Zapier result: same shape as lib/polling.js `toResult`, plus webhookEventId. */
function toResult(entity, entityKey, eventId, eventAt, envelope, extra = {}) {
  return {
    ...entity,
    ...(entityKey ? { [entityKey]: entity.id } : {}),
    ...extra,
    id: eventId,
    eventId,
    eventAt,
    webhookEventId: envelope.id || null,
  };
}

/**
 * The result for one delivery, or undefined when it does not match the trigger (ping, other
 * event, other board or phase).
 */
function toWebhookResult(event, envelope, { boardId, phaseId } = {}) {
  if (!WEBHOOK_EVENTS[event] || !WEBHOOK_EVENTS[event].includes(envelope.type)) return undefined;
  const data = envelope.data;
  const board = str(String(boardId ?? '').trim());
  const phase = str(String(phaseId ?? '').trim());

  if (event === 'newContact') {
    const contact = toContact(data);
    return toResult(contact, 'contactId', contact.id, contact.createdAt ?? envelope.timestamp, envelope);
  }

  if (event === 'newMessage') {
    const message = toMessage(data);
    if (board && message.boardId !== board) return undefined;
    const eventId = message.id ?? envelope.id;
    return toResult(message, 'messageId', eventId, message.sentAt ?? envelope.timestamp, envelope);
  }

  const card = toCard(data, board ?? undefined);
  if (board && card.boardId && card.boardId !== board) return undefined;

  if (event === 'newCard') {
    return toResult(card, 'cardId', card.id, card.createdAt ?? envelope.timestamp, envelope);
  }

  // cardEnteredPhase: the phase entered is `toPhase` on a move, the current phase on create.
  const moved = envelope.type === 'card.phase_changed';
  const entered = moved && isObject(data.toPhase) ? data.toPhase : undefined;
  if (entered) {
    card.phaseId = str(entered.documentId) ?? card.phaseId;
    card.phaseName = str(entered.name) ?? card.phaseName;
  }
  if (phase && card.phaseId !== phase) return undefined;
  const eventAt = card.phaseEnteredAt ?? envelope.timestamp;
  const from = moved && isObject(data.fromPhase) ? data.fromPhase : {};
  return toResult(card, 'cardId', `${card.id}:${card.phaseId ?? ''}:${eventAt}`, eventAt, envelope, {
    previousPhaseId: str(from.documentId),
    previousPhaseName: str(from.name),
  });
}

/** `GET /webhook-subscriptions/samples?event=…`: the `data` of a fictional delivery. */
async function fetchSamples(client, type) {
  return unwrapList(
    await client.request('GET', '/webhook-subscriptions/samples', { query: { event: type } }),
  );
}

module.exports = {
  WEBHOOK_EVENTS,
  toSubscription,
  SIGNATURE_TOLERANCE_SECONDS,
  subscribe,
  unsubscribe,
  headerValue,
  verifySignature,
  parseEnvelope,
  toMessage,
  toWebhookResult,
  fetchSamples,
};
