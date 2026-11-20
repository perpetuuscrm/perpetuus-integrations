import { createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';

import { cardEvent, contactEvent } from '../nodes/Perpetuus/shared/polling';
import { toCard, toContact } from '../nodes/Perpetuus/shared/mappers';
import { PerpetuusApiError } from '../nodes/Perpetuus/shared/transport';
import {
	findSubscription,
	parseEnvelope,
	subscribe,
	toWebhookItem,
	unsubscribe,
	verifySignature,
} from '../nodes/Perpetuus/shared/webhooks';
import { mockClient } from './helpers';

/** `data` of card.created as the API sends it (contract projection). */
const cardData = (overrides: Record<string, unknown> = {}) => ({
	documentId: 'card1',
	title: 'ACME deal',
	description: null,
	value: 1500.5,
	dueDate: null,
	board: { documentId: 'board1', name: 'Sales' },
	currentPhase: { documentId: 'ph2', name: 'Proposal' },
	currentPhaseEnteredAt: '2026-11-16T10:00:00.000Z',
	contact: { documentId: 'ct1', name: 'Ana', email: 'ana@acme.com', phone: '+5511999999999' },
	assignees: [],
	tags: [{ documentId: 'tg1', name: 'Hot', color: '#f00' }],
	fields: { origem: 'Site' },
	creationSource: 'api',
	createdAt: '2026-11-16T09:00:00.000Z',
	updatedAt: '2026-11-16T10:00:00.000Z',
	...overrides,
});

const envelope = (type: string, data: Record<string, unknown>) =>
	parseEnvelope({
		id: 'evt_1',
		type,
		version: '1',
		timestamp: '2026-11-16T10:00:01.000Z',
		tenant: {},
		data,
	})!;

const sign = (secret: string, ts: number, body: string) =>
	`sha256=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`;

describe('subscriptions', () => {
	it('subscribes with the trigger events, board and origin', async () => {
		const { client, calls } = mockClient(() => ({
			data: {
				id: 'sub1',
				url: 'https://n8n.example/webhook/x',
				events: ['card.created', 'card.phase_changed'],
				secret: 'whsec_abc',
			},
		}));
		const sub = await subscribe(client, {
			url: 'https://n8n.example/webhook/x',
			event: 'cardEnteredPhase',
			boardId: ' board1 ',
			origin: 'n8n',
			description: 'n8n: test',
		});
		expect(calls[0]).toMatchObject({
			method: 'POST',
			path: '/webhook-subscriptions',
			body: {
				url: 'https://n8n.example/webhook/x',
				events: ['card.created', 'card.phase_changed'],
				boardId: 'board1',
				origin: 'n8n',
				description: 'n8n: test',
			},
		});
		expect(sub).toMatchObject({ id: 'sub1', secret: 'whsec_abc' });
	});

	it('never sends a board for New Contact', async () => {
		const { client, calls } = mockClient(() => ({ data: { id: 'sub1' } }));
		await subscribe(client, {
			url: 'https://x.example/h',
			event: 'newContact',
			boardId: 'b',
			origin: 'n8n',
		});
		expect(calls[0].body).toEqual({
			url: 'https://x.example/h',
			events: ['contact.created'],
			origin: 'n8n',
		});
	});

	it('treats 404 as gone on read and delete', async () => {
		const notFound = new PerpetuusApiError('Not found in Perpetuus: x', { httpCode: 404 });
		const { client } = mockClient(() => notFound);
		await expect(findSubscription(client, 'sub1')).resolves.toBeUndefined();
		await expect(unsubscribe(client, 'sub1')).resolves.toBe(true);
	});

	it('propagates other errors', async () => {
		const { client } = mockClient(
			() => new PerpetuusApiError('Perpetuus denied access: x', { httpCode: 403 }),
		);
		await expect(unsubscribe(client, 'sub1')).rejects.toThrow('denied');
	});
});

describe('verifySignature', () => {
	const secret = 'whsec_test';
	const body = '{"id":"evt_1","type":"ping"}';
	const now = 1_800_000_000;

	it('accepts the signature of the raw body', () => {
		const headers = {
			'X-Perpetuus-Timestamp': String(now),
			'X-Perpetuus-Signature': sign(secret, now, body),
		};
		expect(verifySignature(secret, headers, body, now + 10)).toEqual({ ok: true });
	});

	it('rejects a wrong secret, a changed body, old timestamps and missing headers', () => {
		const headers = {
			'x-perpetuus-timestamp': String(now),
			'x-perpetuus-signature': sign('other', now, body),
		};
		expect(verifySignature(secret, headers, body, now).ok).toBe(false);
		const good = {
			'x-perpetuus-timestamp': String(now),
			'x-perpetuus-signature': sign(secret, now, body),
		};
		expect(verifySignature(secret, good, `${body} `, now).ok).toBe(false);
		expect(verifySignature(secret, good, body, now + 301)).toEqual({
			ok: false,
			reason: 'timestamp outside the tolerance window',
		});
		expect(verifySignature(secret, {}, body, now)).toEqual({
			ok: false,
			reason: 'missing signature headers',
		});
	});
});

describe('toWebhookItem', () => {
	it('New Card: same object and eventId as the polling trigger, plus webhookEventId', () => {
		const item = toWebhookItem('newCard', envelope('card.created', cardData()))!;
		const polled = cardEvent(toCard(cardData()), 'newCard')!.item;
		expect(item).toEqual({ ...polled, webhookEventId: 'evt_1' });
		expect(item).toMatchObject({
			id: 'card1',
			boardId: 'board1',
			tagNames: ['Hot'],
			fields: { origem: 'Site' },
			eventId: 'card1',
		});
	});

	it('Card Entered Phase: uses toPhase on a move and filters by phase', () => {
		const moved = envelope(
			'card.phase_changed',
			cardData({
				fromPhase: { documentId: 'ph1', name: 'Lead' },
				toPhase: { documentId: 'ph2', name: 'Proposal' },
			}),
		);
		const item = toWebhookItem('cardEnteredPhase', moved, { boardId: 'board1', phaseId: 'ph2' })!;
		expect(item).toMatchObject({
			phaseId: 'ph2',
			previousPhaseId: 'ph1',
			previousPhaseName: 'Lead',
			eventId: 'card1:ph2:2026-11-16T10:00:00.000Z',
			eventAt: '2026-11-16T10:00:00.000Z',
		});
		expect(toWebhookItem('cardEnteredPhase', moved, { phaseId: 'ph9' })).toBeUndefined();
		// A new card counts as entering its first phase, like the polling trigger.
		const created = toWebhookItem('cardEnteredPhase', envelope('card.created', cardData()), {
			phaseId: 'ph2',
		})!;
		expect(created.eventId).toBe(cardEvent(toCard(cardData()), 'cardEnteredPhase')!.eventId);
		expect(created.previousPhaseId).toBeNull();
	});

	it('drops other boards, other events and pings', () => {
		expect(
			toWebhookItem('newCard', envelope('card.created', cardData()), { boardId: 'other' }),
		).toBeUndefined();
		expect(toWebhookItem('newCard', envelope('card.phase_changed', cardData()))).toBeUndefined();
		expect(toWebhookItem('newContact', envelope('ping', { test: true }))).toBeUndefined();
	});

	it('New Contact: same object as polling, contact type normalized', () => {
		const data = {
			documentId: 'ct1',
			name: 'Ana',
			email: 'a@x.com',
			contact_type: 'pessoa',
			customFields: { empresa: 'Acme' },
			createdAt: '2026-11-16T09:00:00.000Z',
		};
		const item = toWebhookItem('newContact', envelope('contact.created', data))!;
		expect(item).toEqual({ ...contactEvent(toContact(data))!.item, webhookEventId: 'evt_1' });
		expect(item.contactType).toBe('person');
		expect(toContact({ contact_type: 'company' }).contactType).toBe('company');
	});

	it('New Message: flat message with conversation, contact and card', () => {
		const item = toWebhookItem(
			'newMessage',
			envelope('message.received', {
				message: {
					id: '98765',
					content: 'Olá',
					messageType: 'incoming',
					createdAt: '2026-11-16T10:00:00.000Z',
					sender: { id: '321', name: 'Ana', type: 'contact' },
					attachments: [{ id: '5', fileType: 'image', url: 'https://x/y.jpg' }],
				},
				conversation: { id: '1234', status: 'open', inboxId: '7' },
				contact: { documentId: 'ct1', name: 'Ana', email: null, phone: '+55' },
				card: {
					documentId: 'card1',
					title: 'ACME',
					board: { documentId: 'board1', name: 'Sales' },
					currentPhase: { documentId: 'ph2', name: 'Proposal' },
				},
			}),
			{ boardId: 'board1' },
		)!;
		expect(item).toMatchObject({
			id: '98765',
			content: 'Olá',
			senderName: 'Ana',
			conversationId: '1234',
			contactId: 'ct1',
			cardId: 'card1',
			boardId: 'board1',
			attachments: [{ id: '5', fileType: 'image', url: 'https://x/y.jpg' }],
			eventId: '98765',
			eventAt: '2026-11-16T10:00:00.000Z',
		});
	});
});
