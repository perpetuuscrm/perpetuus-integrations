import { createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';

import { PerpetuusTrigger } from '../nodes/PerpetuusTrigger/PerpetuusTrigger.node';
import { PerpetuusPollingTrigger } from '../nodes/PerpetuusPollingTrigger/PerpetuusPollingTrigger.node';
import { PerpetuusTriggerV2 } from '../nodes/PerpetuusTrigger/PerpetuusTriggerV2.node';

type Call = { method: string; url: string; body?: unknown };

/** Fake hook/webhook context: parameters, static data and an HTTP handler. */
function context(options: {
	params: Record<string, unknown>;
	staticData?: Record<string, unknown>;
	handler?: (call: Call) => { statusCode: number; body?: unknown };
	request?: { body: unknown; rawBody?: string; headers?: Record<string, string> };
}) {
	const calls: Call[] = [];
	const staticData = options.staticData ?? {};
	const response = { statusCode: 200, payload: undefined as unknown };
	const ctx = {
		getNodeParameter: (name: string, fallback?: unknown, opts?: { extractValue?: boolean }) => {
			const value = name in options.params ? options.params[name] : fallback;
			if (opts?.extractValue && value && typeof value === 'object' && '__rl' in value) {
				return (value as { value: unknown }).value;
			}
			return value;
		},
		getWorkflowStaticData: () => staticData,
		getNodeWebhookUrl: () => 'https://n8n.example.com/webhook/abc/webhook',
		getWorkflow: () => ({ id: 'wf1', name: 'Leads', active: true }),
		getNode: () => ({
			name: 'Perpetuus Trigger',
			type: 'n8n-nodes-perpetuus.perpetuusTrigger',
			typeVersion: 2,
			parameters: {},
		}),
		getCredentials: async () => ({ apiKey: 'ppt_test', baseUrl: 'https://api.example.com/api' }),
		logger: { warn: () => undefined },
		helpers: {
			httpRequestWithAuthentication: async (
				_name: string,
				req: { method: string; url: string; body?: unknown },
			) => {
				const call = { method: req.method, url: req.url, body: req.body };
				calls.push(call);
				const result = options.handler ? options.handler(call) : { statusCode: 200, body: {} };
				return { statusCode: result.statusCode, headers: {}, body: result.body };
			},
			returnJsonArray: (items: unknown[]) => items.map((json) => ({ json })),
		},
		getRequestObject: () => ({
			body: options.request?.body,
			rawBody:
				options.request?.rawBody === undefined ? undefined : Buffer.from(options.request.rawBody),
		}),
		getBodyData: () => options.request?.body,
		getHeaderData: () => options.request?.headers ?? {},
		getResponseObject: () => ({
			status(code: number) {
				response.statusCode = code;
				return this;
			},
			json(payload: unknown) {
				response.payload = payload;
			},
		}),
	};
	return { ctx: ctx as never, calls, staticData, response };
}

const node = new PerpetuusTriggerV2();
const hooks = node.webhookMethods.default;
const board = { __rl: true, mode: 'list', value: 'board1' };

describe('Perpetuus Trigger versions', () => {
	it('defaults to v2 (webhook) and keeps v1 (polling) for existing workflows', () => {
		const versioned = new PerpetuusTrigger();
		expect(versioned.currentVersion).toBe(2);
		expect(versioned.getNodeType(2).description.webhooks?.[0]).toMatchObject({
			httpMethod: 'POST',
			name: 'default',
		});
		const v1 = versioned.getNodeType(1);
		expect(v1.description.polling).toBe(true);
		expect(v1.description.name).toBe('perpetuusTrigger');
		expect(typeof v1.poll).toBe('function');
		const events = (v1.description.properties[0].options as Array<{ value: string }>).map(
			(o) => o.value,
		);
		expect(events).toEqual(['cardEnteredPhase', 'newCard', 'newContact', 'taskCompleted']);
	});

	it('Perpetuus Polling Trigger keeps every polling event', () => {
		const polling = new PerpetuusPollingTrigger();
		expect(polling.description.name).toBe('perpetuusPollingTrigger');
		expect(polling.description.polling).toBe(true);
	});
});

describe('Perpetuus Trigger v2 lifecycle', () => {
	it('create subscribes with the n8n origin and stores id and secret', async () => {
		const { ctx, calls, staticData } = context({
			params: { event: 'cardEnteredPhase', boardId: board, phaseId: 'ph2' },
			handler: () => ({
				statusCode: 201,
				body: {
					data: { id: 'sub1', secret: 'whsec_x', events: ['card.created', 'card.phase_changed'] },
				},
			}),
		});
		await expect(hooks.create.call(ctx)).resolves.toBe(true);
		expect(calls[0]).toMatchObject({
			method: 'POST',
			url: 'https://api.example.com/api/webhook-subscriptions',
			body: {
				url: 'https://n8n.example.com/webhook/abc/webhook',
				events: ['card.created', 'card.phase_changed'],
				boardId: 'board1',
				origin: 'n8n',
				description: 'n8n: Leads (cardEnteredPhase)',
			},
		});
		expect(staticData).toEqual({ webhookId: 'sub1', webhookSecret: 'whsec_x' });
	});

	it('checkExists keeps a matching subscription and replaces a changed one', async () => {
		const sub = {
			id: 'sub1',
			url: 'https://n8n.example.com/webhook/abc/webhook',
			events: ['card.created'],
			boardId: 'board1',
			status: 'active',
		};
		const same = context({
			params: { event: 'newCard', boardId: board },
			staticData: { webhookId: 'sub1', webhookSecret: 'whsec_x' },
			handler: () => ({ statusCode: 200, body: { data: sub } }),
		});
		await expect(hooks.checkExists.call(same.ctx)).resolves.toBe(true);

		const changed = context({
			params: { event: 'newCard', boardId: { ...board, value: 'board2' } },
			staticData: { webhookId: 'sub1', webhookSecret: 'whsec_x' },
			handler: (call) => ({
				statusCode: 200,
				body: call.method === 'GET' ? { data: sub } : { data: { deleted: true } },
			}),
		});
		await expect(hooks.checkExists.call(changed.ctx)).resolves.toBe(false);
		expect(changed.calls.map((c) => c.method)).toEqual(['GET', 'DELETE']);
		expect(changed.staticData).toEqual({});

		const gone = context({
			params: { event: 'newCard', boardId: board },
			staticData: { webhookId: 'sub1', webhookSecret: 'whsec_x' },
			handler: () => ({
				statusCode: 404,
				body: { error: { message: 'Webhook subscription not found' } },
			}),
		});
		await expect(hooks.checkExists.call(gone.ctx)).resolves.toBe(false);
	});

	it('delete removes the subscription (404 counts as deleted)', async () => {
		const { ctx, calls, staticData } = context({
			params: { event: 'newContact' },
			staticData: { webhookId: 'sub1', webhookSecret: 'whsec_x' },
			handler: () => ({ statusCode: 404, body: {} }),
		});
		await expect(hooks.delete.call(ctx)).resolves.toBe(true);
		expect(calls[0]).toMatchObject({
			method: 'DELETE',
			url: 'https://api.example.com/api/webhook-subscriptions/sub1',
		});
		expect(staticData).toEqual({});
	});
});

describe('Perpetuus Trigger v2 webhook', () => {
	const secret = 'whsec_x';
	const delivery = {
		id: 'evt_1',
		type: 'contact.created',
		version: '1',
		timestamp: '2026-11-16T10:00:01.000Z',
		tenant: { organizationId: 'org1', slug: 'acme' },
		data: {
			documentId: 'ct1',
			name: 'Ana',
			contact_type: 'pessoa',
			customFields: {},
			createdAt: '2026-11-16T10:00:00.000Z',
		},
	};
	const rawBody = JSON.stringify(delivery);
	const signed = (body: string, key = secret) => {
		const ts = Math.floor(Date.now() / 1000);
		return {
			'x-perpetuus-timestamp': String(ts),
			'x-perpetuus-signature': `sha256=${createHmac('sha256', key).update(`${ts}.${body}`).digest('hex')}`,
		};
	};

	it('emits the canonical item of a signed delivery', async () => {
		const { ctx } = context({
			params: { event: 'newContact' },
			staticData: { webhookId: 'sub1', webhookSecret: secret },
			request: { body: delivery, rawBody, headers: signed(rawBody) },
		});
		const result = await node.webhook.call(ctx);
		expect(result.workflowData?.[0][0].json).toMatchObject({
			id: 'ct1',
			contactType: 'person',
			eventId: 'ct1',
			webhookEventId: 'evt_1',
		});
	});

	it('rejects a bad signature with 401 and does not start the workflow', async () => {
		const { ctx, response } = context({
			params: { event: 'newContact' },
			staticData: { webhookId: 'sub1', webhookSecret: secret },
			request: { body: delivery, rawBody, headers: signed(rawBody, 'whsec_other') },
		});
		const result = await node.webhook.call(ctx);
		expect(result).toEqual({ noWebhookResponse: true });
		expect(response.statusCode).toBe(401);
	});

	it('rejects an unsigned delivery with 401 even with a stored secret', async () => {
		const { ctx, response } = context({
			params: { event: 'newContact' },
			staticData: { webhookId: 'sub1', webhookSecret: secret },
			request: { body: delivery, rawBody },
		});
		expect(await node.webhook.call(ctx)).toEqual({ noWebhookResponse: true });
		expect(response.statusCode).toBe(401);
	});

	it('rejects every delivery with 401 when no signing secret is stored', async () => {
		for (const headers of [undefined, signed(rawBody)]) {
			const { ctx, response } = context({
				params: { event: 'newContact' },
				staticData: { webhookId: 'sub1' },
				request: { body: delivery, rawBody, headers },
			});
			expect(await node.webhook.call(ctx)).toEqual({ noWebhookResponse: true });
			expect(response.statusCode).toBe(401);
		}
	});

	it('acknowledges pings and other phases without starting the workflow', async () => {
		const ping = JSON.stringify({ id: 'evt_2', type: 'ping', data: { test: true } });
		const { ctx } = context({
			params: { event: 'newContact' },
			staticData: { webhookSecret: secret },
			request: { body: JSON.parse(ping), rawBody: ping, headers: signed(ping) },
		});
		expect(await node.webhook.call(ctx)).toEqual({ webhookResponse: 'OK' });
	});
});

describe('Perpetuus Trigger v2 create without a secret', () => {
	it('deletes the subscription and fails when Perpetuus returns no signing secret', async () => {
		const { ctx, calls } = context({
			params: { event: 'newContact' },
			handler: (call) =>
				call.method === 'POST'
					? { statusCode: 201, body: { data: { id: 'sub9', events: ['contact.created'] } } }
					: { statusCode: 204 },
		});
		await expect(node.webhookMethods.default.create.call(ctx)).rejects.toThrow(/signing secret/);
		expect(calls.map((c) => c.method)).toEqual(['POST', 'DELETE']);
	});
});
