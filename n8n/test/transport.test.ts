import { describe, expect, it, vi } from 'vitest';

import {
	createApiClient,
	parseRetryAfter,
	PerpetuusApiError,
	sendWithRetry,
	toPerpetuusError,
	type RawResponse,
	type Sender,
} from '../nodes/Perpetuus/shared/transport';

function sequence(...responses: Array<RawResponse | Error>): Sender & { calls: number } {
	let index = 0;
	const send = (async () => {
		send.calls++;
		const next = responses[Math.min(index++, responses.length - 1)];
		if (next instanceof Error) throw next;
		return next;
	}) as Sender & { calls: number };
	send.calls = 0;
	return send;
}

const ok = (body: unknown): RawResponse => ({ statusCode: 200, headers: {}, body });
const rateLimited = (retryAfter: string): RawResponse => ({
	statusCode: 429,
	headers: { 'Retry-After': retryAfter, 'x-ratelimit-remaining': '0' },
	body: { data: null, error: { status: 429, message: 'Limite de 120 requisições por minuto', details: { code: 'RATE_LIMITED', retryAfter: Number(retryAfter) } } },
});

describe('sendWithRetry', () => {
	it('returns the body of a 2xx response', async () => {
		const sleep = vi.fn(async () => {});
		const body = await sendWithRetry(sequence(ok({ data: [] })), { method: 'GET', path: '/boards' }, { sleep });
		expect(body).toEqual({ data: [] });
		expect(sleep).not.toHaveBeenCalled();
	});

	it('waits for Retry-After on 429 and retries', async () => {
		const sleep = vi.fn(async () => {});
		const send = sequence(rateLimited('3'), ok({ data: { documentId: 'x' } }));
		const body = await sendWithRetry(send, { method: 'POST', path: '/tasks', body: {} }, { sleep });
		expect(body).toEqual({ data: { documentId: 'x' } });
		expect(send.calls).toBe(2);
		expect(sleep).toHaveBeenCalledWith(3250);
	});

	it('gives up after 2 rate-limit retries with a clear message', async () => {
		const sleep = vi.fn(async () => {});
		const send = sequence(rateLimited('1'));
		const error = await sendWithRetry(send, { method: 'GET', path: '/contacts' }, { sleep }).catch((e) => e);
		expect(error).toBeInstanceOf(PerpetuusApiError);
		expect(error.httpCode).toBe(429);
		expect(error.message).toBe('Perpetuus rate limit reached (120 requests/min per key). Try again in 1 seconds.');
		expect(send.calls).toBe(3);
		expect(sleep).toHaveBeenCalledTimes(2);
	});

	it('does not wait when Retry-After is longer than 60 seconds', async () => {
		const sleep = vi.fn(async () => {});
		const send = sequence(rateLimited('120'));
		const error = await sendWithRetry(send, { method: 'GET', path: '/contacts' }, { sleep }).catch((e) => e);
		expect(error.retryAfterSeconds).toBe(120);
		expect(send.calls).toBe(1);
		expect(sleep).not.toHaveBeenCalled();
	});

	it('retries a GET once on 5xx but never a write', async () => {
		const sleep = vi.fn(async () => {});
		const getSend = sequence({ statusCode: 502, headers: {}, body: '' }, ok({ data: [] }));
		await expect(sendWithRetry(getSend, { method: 'GET', path: '/boards' }, { sleep })).resolves.toEqual({ data: [] });
		expect(getSend.calls).toBe(2);

		const postSend = sequence({ statusCode: 500, headers: {}, body: {} }, ok({}));
		const error = await sendWithRetry(postSend, { method: 'POST', path: '/boards/b/cards', body: {} }, { sleep }).catch((e) => e);
		expect(error.message).toBe('Perpetuus server error (HTTP 500). Try again later.');
		expect(postSend.calls).toBe(1);
	});

	it('retries a GET once on a network error and then reports it', async () => {
		const sleep = vi.fn(async () => {});
		const send = sequence(new Error('ECONNRESET'));
		const error = await sendWithRetry(send, { method: 'GET', path: '/boards' }, { sleep }).catch((e) => e);
		expect(send.calls).toBe(2);
		expect(error.message).toBe('Could not reach Perpetuus: ECONNRESET');
	});

	it('passes method, path, query and body to the sender through createApiClient', async () => {
		const send = vi.fn(async () => ok({ data: 1 }));
		const client = createApiClient(send, { sleep: async () => {} });
		await client.request('PUT', '/boards/b/cards/c', { query: { a: 1 }, body: { data: {} } });
		expect(send).toHaveBeenCalledWith({ method: 'PUT', path: '/boards/b/cards/c', query: { a: 1 }, body: { data: {} } });
	});
});

describe('toPerpetuusError', () => {
	it('explains invalid or expired keys on 401', () => {
		const error = toPerpetuusError(401, { error: { message: 'Missing or invalid credentials' } });
		expect(error.message).toContain('Invalid or expired Perpetuus API key');
	});

	it('names the missing scope on 403', () => {
		const error = toPerpetuusError(403, { error: { status: 403, name: 'ForbiddenError', message: 'PAT sem escopo crm:write' } });
		expect(error.missingScope).toBe('crm:write');
		expect(error.message).toBe(
			'The Perpetuus API key is missing the "crm:write" scope. Create a key with the crm:write scope (it includes crm:read).',
		);
	});

	it('keeps other 403 messages (role, portfolio) as access denied', () => {
		const error = toPerpetuusError(403, {
			error: { message: 'O contato existe nesta organização, mas está fora da sua carteira', details: { code: 'CONTACT_OUT_OF_SCOPE' } },
		});
		expect(error.message).toMatch(/^Perpetuus denied access: O contato existe/);
		expect(error.apiCode).toBe('CONTACT_OUT_OF_SCOPE');
	});

	it('shows validation details on 400 and the plan limit on 402', () => {
		const bad = toPerpetuusError(400, { error: { message: 'Campos obrigatórios ausentes', details: { missing: ['email'] } } });
		expect(bad.message).toBe('Perpetuus rejected the request: Campos obrigatórios ausentes');
		expect(bad.description).toBe('{"missing":["email"]}');
		expect(toPerpetuusError(402, { error: { message: 'Limite atingido' } }).message).toContain('plan contact limit');
		expect(toPerpetuusError(404, { error: { message: 'Card não encontrado' } }).message).toBe('Not found in Perpetuus: Card não encontrado');
	});
});

describe('parseRetryAfter', () => {
	it('reads the header case-insensitively, then the body', () => {
		expect(parseRetryAfter({ 'retry-after': '42' }, {})).toBe(42);
		expect(parseRetryAfter({ 'Retry-After': ['7'] }, {})).toBe(7);
		expect(parseRetryAfter({}, { error: { details: { retryAfter: 9 } } })).toBe(9);
		expect(parseRetryAfter({}, {})).toBeUndefined();
	});
});
