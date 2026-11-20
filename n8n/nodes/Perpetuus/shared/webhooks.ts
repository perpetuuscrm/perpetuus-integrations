/**
 * Instant triggers on the Perpetuus outgoing webhooks (PRD-010, docs/v1-contract.md §5.7).
 *
 * - Subscribe: `POST /webhook-subscriptions` with `{ url, events, boardId?, origin, description }`.
 *   The response (`{ data }`) carries the subscription `id` and the signing `secret` (shown once).
 * - Deliveries: `{ id, type, version, timestamp, tenant, data }`, signed with
 *   `X-Perpetuus-Signature: sha256=HMAC_SHA256(secret, "<X-Perpetuus-Timestamp>.<raw body>")`.
 * - Every item has the same canonical shape as the polling triggers (`toCard` / `toContact`),
 *   with the same `eventId` / `eventAt`, plus `webhookEventId` (the delivery envelope `id`).
 */
import { createHmac, timingSafeEqual } from 'crypto';

import { toCard, toContact, unwrapOne, type Card, type Contact } from './mappers';
import { PerpetuusApiError, type ApiClient } from './transport';

export type WebhookTriggerEvent = 'newCard' | 'cardEnteredPhase' | 'newContact' | 'newMessage';

export type WebhookEventType =
	| 'contact.created'
	| 'card.created'
	| 'card.phase_changed'
	| 'message.received';

/** API events behind each trigger. A new card counts as entering its first phase. */
export const WEBHOOK_EVENTS: Record<WebhookTriggerEvent, WebhookEventType[]> = {
	newCard: ['card.created'],
	cardEnteredPhase: ['card.created', 'card.phase_changed'],
	newContact: ['contact.created'],
	newMessage: ['message.received'],
};

export type WebhookOrigin = 'n8n' | 'make' | 'zapier' | 'api';

/** Deliveries older than this (by X-Perpetuus-Timestamp) are rejected as replays. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export interface WebhookSubscription {
	id: string;
	url: string;
	events: string[];
	boardId: string | null;
	status?: string;
	secret?: string;
}

export interface SubscribeInput {
	url: string;
	event: WebhookTriggerEvent;
	boardId?: string;
	origin: WebhookOrigin;
	description?: string;
}

type Raw = Record<string, unknown>;

function isObject(value: unknown): value is Raw {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function str(value: unknown): string | null {
	if (value === undefined || value === null || value === '') return null;
	return String(value);
}

function toSubscription(payload: unknown): WebhookSubscription {
	const raw = unwrapOne(payload) ?? {};
	return {
		id: String(raw.id ?? raw.documentId ?? ''),
		url: String(raw.url ?? ''),
		events: Array.isArray(raw.events) ? raw.events.map(String) : [],
		boardId: str(raw.boardId),
		status: str(raw.status) ?? undefined,
		secret: str(raw.secret) ?? undefined,
	};
}

export async function subscribe(
	client: ApiClient,
	input: SubscribeInput,
): Promise<WebhookSubscription> {
	const body: Raw = {
		url: input.url,
		events: WEBHOOK_EVENTS[input.event],
		origin: input.origin,
	};
	const boardId = input.boardId?.trim();
	if (boardId && input.event !== 'newContact') body.boardId = boardId;
	if (input.description) body.description = input.description.slice(0, 500);
	const subscription = toSubscription(
		await client.request('POST', '/webhook-subscriptions', { body }),
	);
	if (!subscription.id) throw new Error('Perpetuus did not return the webhook subscription id.');
	return subscription;
}

function isNotFound(error: unknown): boolean {
	return error instanceof PerpetuusApiError && error.httpCode === 404;
}

/** The subscription, or undefined when it no longer exists (404). */
export async function findSubscription(
	client: ApiClient,
	id: string,
): Promise<WebhookSubscription | undefined> {
	return await client
		.request('GET', `/webhook-subscriptions/${encodeURIComponent(id)}`)
		.then(toSubscription, (error: unknown) =>
			isNotFound(error) ? undefined : Promise.reject(error),
		);
}

/** Deletes the subscription. A subscription already gone (404) counts as deleted. */
export async function unsubscribe(client: ApiClient, id: string): Promise<boolean> {
	return await client.request('DELETE', `/webhook-subscriptions/${encodeURIComponent(id)}`).then(
		() => true,
		(error: unknown) => (isNotFound(error) ? true : Promise.reject(error)),
	);
}

function headerValue(headers: Record<string, unknown>, name: string): string | undefined {
	const wanted = name.toLowerCase();
	for (const [key, value] of Object.entries(headers ?? {})) {
		if (key.toLowerCase() !== wanted) continue;
		if (Array.isArray(value)) return value.length ? String(value[0]) : undefined;
		return value === undefined || value === null ? undefined : String(value);
	}
	return undefined;
}

export type SignatureCheck = { ok: true } | { ok: false; reason: string };

/**
 * Checks `X-Perpetuus-Signature` against the raw body. `nowSeconds` is injectable for tests.
 */
export function verifySignature(
	secret: string,
	headers: Record<string, unknown>,
	rawBody: string,
	nowSeconds: number = Math.floor(Date.now() / 1000),
): SignatureCheck {
	const signature = headerValue(headers, 'x-perpetuus-signature');
	const timestamp = headerValue(headers, 'x-perpetuus-timestamp');
	if (!signature || !timestamp) return { ok: false, reason: 'missing signature headers' };
	const ts = Number(timestamp);
	if (!Number.isFinite(ts)) return { ok: false, reason: 'invalid timestamp' };
	if (Math.abs(nowSeconds - ts) > SIGNATURE_TOLERANCE_SECONDS) {
		return { ok: false, reason: 'timestamp outside the tolerance window' };
	}
	const expected = Buffer.from(
		`sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex')}`,
	);
	const received = Buffer.from(signature);
	if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
		return { ok: false, reason: 'signature mismatch' };
	}
	return { ok: true };
}

export interface WebhookEnvelope {
	id: string;
	type: string;
	timestamp: string | null;
	data: Raw;
}

export function parseEnvelope(body: unknown): WebhookEnvelope | undefined {
	if (!isObject(body) || typeof body.type !== 'string') return undefined;
	return {
		id: String(body.id ?? ''),
		type: body.type,
		timestamp: str(body.timestamp),
		data: isObject(body.data) ? body.data : {},
	};
}

export interface Message {
	[key: string]: unknown;
	id: string | null;
	content: string;
	messageType: string | null;
	sentAt: string | null;
	senderId: string | null;
	senderName: string | null;
	senderType: string | null;
	attachments: Array<{ id: string | null; fileType: string | null; url: string | null }>;
	conversationId: string | null;
	conversationStatus: string | null;
	inboxId: string | null;
	contactId: string | null;
	contactName: string | null;
	contactEmail: string | null;
	contactPhone: string | null;
	cardId: string | null;
	cardTitle: string | null;
	boardId: string | null;
	phaseId: string | null;
	phaseName: string | null;
}

/** Flat output of New Message (`message.received`), in the style of the other objects. */
export function toMessage(data: Raw): Message {
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

export interface WebhookItemOptions {
	boardId?: string;
	phaseId?: string;
}

/**
 * The trigger item for one delivery, or undefined when the delivery does not match the
 * trigger (ping, other event, other board or phase).
 */
export function toWebhookItem(
	event: WebhookTriggerEvent,
	envelope: WebhookEnvelope,
	options: WebhookItemOptions = {},
): Record<string, unknown> | undefined {
	if (!(WEBHOOK_EVENTS[event] as string[]).includes(envelope.type)) return undefined;
	const extra = { webhookEventId: envelope.id || null };
	const data = envelope.data;

	if (event === 'newContact') {
		const contact: Contact = toContact(data);
		const eventAt = contact.createdAt ?? envelope.timestamp ?? '';
		return { ...contact, eventId: contact.id, eventAt, ...extra };
	}

	if (event === 'newMessage') {
		const message = toMessage(data);
		if (options.boardId && message.boardId !== options.boardId) return undefined;
		const eventAt = message.sentAt ?? envelope.timestamp ?? '';
		return { ...message, eventId: message.id ?? envelope.id, eventAt, ...extra };
	}

	const card: Card = toCard(data, options.boardId);
	if (options.boardId && card.boardId && card.boardId !== options.boardId) return undefined;

	if (event === 'newCard') {
		const eventAt = card.createdAt ?? envelope.timestamp ?? '';
		return { ...card, eventId: card.id, eventAt, ...extra };
	}

	// cardEnteredPhase: the phase entered is `toPhase` on a move, the current phase on create.
	const entered =
		envelope.type === 'card.phase_changed' && isObject(data.toPhase) ? data.toPhase : undefined;
	if (entered) {
		card.phaseId = str(entered.documentId) ?? card.phaseId;
		card.phaseName = str(entered.name) ?? card.phaseName;
	}
	if (options.phaseId && card.phaseId !== options.phaseId) return undefined;
	const eventAt = card.phaseEnteredAt ?? envelope.timestamp ?? '';
	const from =
		envelope.type === 'card.phase_changed' && isObject(data.fromPhase) ? data.fromPhase : {};
	return {
		...card,
		eventId: `${card.id}:${card.phaseId ?? ''}:${eventAt}`,
		eventAt,
		previousPhaseId: str(from.documentId),
		previousPhaseName: str(from.name),
		...extra,
	};
}

/** Sample used by the polling-less New Message trigger when there is nothing to show. */
export async function fetchSamples(client: ApiClient, type: WebhookEventType): Promise<Raw[]> {
	const response = await client.request('GET', '/webhook-subscriptions/samples', {
		query: { event: type },
	});
	const list =
		isObject(response) && Array.isArray(response.data)
			? response.data
			: Array.isArray(response)
				? response
				: [];
	return list.filter(isObject);
}
