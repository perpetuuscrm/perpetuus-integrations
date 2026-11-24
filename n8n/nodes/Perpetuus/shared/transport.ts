import { MAX_RATE_LIMIT_RETRIES, MAX_RATE_LIMIT_WAIT_SECONDS } from './constants';
import type { Query } from './query';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface RawResponse {
	statusCode: number;
	headers: Record<string, unknown>;
	body: unknown;
}

/** Sends one HTTP request. `path` is relative to the base URL (e.g. `/contacts`). */
export type Sender = (request: {
	method: HttpMethod;
	path: string;
	query?: Query;
	body?: unknown;
}) => Promise<RawResponse>;

export type Sleeper = (ms: number) => Promise<void>;

export interface ApiClient {
	request<T = unknown>(
		method: HttpMethod,
		path: string,
		options?: { query?: Query; body?: unknown },
	): Promise<T>;
}

export class PerpetuusApiError extends Error {
	readonly httpCode: number;
	readonly description: string;
	readonly retryAfterSeconds?: number;
	readonly apiCode?: string;
	readonly missingScope?: string;

	constructor(
		message: string,
		options: {
			httpCode: number;
			description?: string;
			retryAfterSeconds?: number;
			apiCode?: string;
			missingScope?: string;
		},
	) {
		super(message);
		this.name = 'PerpetuusApiError';
		this.httpCode = options.httpCode;
		this.description = options.description ?? '';
		this.retryAfterSeconds = options.retryAfterSeconds;
		this.apiCode = options.apiCode;
		this.missingScope = options.missingScope;
	}
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

interface ApiErrorBody {
	error?: { message?: string; name?: string; details?: Record<string, unknown> };
	message?: string;
}

function asErrorBody(body: unknown): ApiErrorBody {
	return body && typeof body === 'object' ? (body as ApiErrorBody) : {};
}

/** Seconds to wait, from the Retry-After header or `error.details.retryAfter`. */
export function parseRetryAfter(headers: Record<string, unknown>, body: unknown): number | undefined {
	const raw = headerValue(headers, 'retry-after');
	if (raw !== undefined) {
		const seconds = Number(raw);
		if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
		const date = Date.parse(raw);
		if (!Number.isNaN(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
	}
	const fromBody = Number(asErrorBody(body).error?.details?.retryAfter);
	return Number.isFinite(fromBody) && fromBody >= 0 ? Math.ceil(fromBody) : undefined;
}

function stringifyDetails(details: unknown): string {
	if (details === undefined || details === null) return '';
	if (typeof details === 'object' && Object.keys(details as object).length === 0) return '';
	try {
		return JSON.stringify(details);
	} catch {
		return String(details);
	}
}

/** Turns a non-2xx response into the canonical connector error (see docs/v1-contract.md §3.3). */
export function toPerpetuusError(
	statusCode: number,
	body: unknown,
	headers: Record<string, unknown> = {},
): PerpetuusApiError {
	const parsed = asErrorBody(body);
	const apiMessage = String(parsed.error?.message ?? parsed.message ?? '').trim();
	const details = parsed.error?.details;
	const apiCode = typeof details?.code === 'string' ? details.code : undefined;
	const detailText = stringifyDetails(details);

	switch (statusCode) {
		case 400:
			return new PerpetuusApiError(
				`Perpetuus rejected the request: ${apiMessage || 'invalid data'}`,
				{ httpCode: 400, description: detailText, apiCode },
			);
		case 401:
			return new PerpetuusApiError(
				'Invalid or expired Perpetuus API key. Create a new key in Settings → API Tokens and MCP ("API Tokens e MCP") → Connect your AI (MCP) → Connect editor → Connect new editor and update the credential.',
				{ httpCode: 401, description: apiMessage },
			);
		case 402:
			return new PerpetuusApiError(
				`Your Perpetuus plan contact limit was reached: ${apiMessage || 'upgrade the plan to add more contacts'}`,
				{ httpCode: 402, description: detailText, apiCode },
			);
		case 403: {
			const scope = /escopo\s+([a-z]+:[a-z]+)/i.exec(apiMessage)?.[1] ??
				(typeof details?.requiredScope === 'string' ? details.requiredScope : undefined);
			if (scope) {
				return new PerpetuusApiError(
					`The Perpetuus API key is missing the "${scope}" scope. Create a key with the crm:write scope (it includes crm:read).`,
					{ httpCode: 403, description: apiMessage, missingScope: scope, apiCode },
				);
			}
			return new PerpetuusApiError(`Perpetuus denied access: ${apiMessage || 'forbidden'}`, {
				httpCode: 403,
				description: detailText,
				apiCode,
			});
		}
		case 404:
			return new PerpetuusApiError(`Not found in Perpetuus: ${apiMessage || 'resource not found'}`, {
				httpCode: 404,
				description: detailText,
				apiCode,
			});
		case 429: {
			const retryAfter = parseRetryAfter(headers, body);
			const wait = retryAfter === undefined ? 'a minute' : `${retryAfter} seconds`;
			return new PerpetuusApiError(
				`Perpetuus rate limit reached (120 requests/min per key). Try again in ${wait}.`,
				{ httpCode: 429, description: apiMessage, retryAfterSeconds: retryAfter, apiCode },
			);
		}
		default:
			if (statusCode >= 500) {
				return new PerpetuusApiError(
					`Perpetuus server error (HTTP ${statusCode}). Try again later.`,
					{ httpCode: statusCode, description: apiMessage },
				);
			}
			return new PerpetuusApiError(
				`Perpetuus request failed (HTTP ${statusCode}): ${apiMessage || 'unknown error'}`,
				{ httpCode: statusCode, description: detailText, apiCode },
			);
	}
}

export interface RetryOptions {
	sleep: Sleeper;
	maxRateLimitRetries?: number;
	maxRateLimitWaitSeconds?: number;
}

/**
 * Sends a request with the retry policy of the v1 contract (§3.2):
 * - 429: wait Retry-After (when <= 60 s) and retry up to 2 times;
 * - 5xx / network error: retry once after 1 s, only for GET (writes have no idempotency key);
 * - other 4xx: fail right away.
 */
export async function sendWithRetry(
	send: Sender,
	request: { method: HttpMethod; path: string; query?: Query; body?: unknown },
	options: RetryOptions,
): Promise<unknown> {
	const maxRateLimitRetries = options.maxRateLimitRetries ?? MAX_RATE_LIMIT_RETRIES;
	const maxWait = options.maxRateLimitWaitSeconds ?? MAX_RATE_LIMIT_WAIT_SECONDS;
	let rateLimitRetries = 0;
	let serverRetries = 0;

	for (;;) {
		let response: RawResponse | undefined;
		let networkError: unknown;
		try {
			response = await send(request);
		} catch (error) {
			networkError = error;
		}
		if (!response) {
			if (request.method === 'GET' && serverRetries < 1) {
				serverRetries++;
				await options.sleep(1000);
				continue;
			}
			const reason = networkError instanceof Error ? networkError.message : String(networkError);
			throw new PerpetuusApiError(`Could not reach Perpetuus: ${reason}`, { httpCode: 0 });
		}

		const { statusCode, headers, body } = response;
		if (statusCode >= 200 && statusCode < 300) return body;

		if (statusCode === 429) {
			const retryAfter = parseRetryAfter(headers, body) ?? 1;
			if (rateLimitRetries < maxRateLimitRetries && retryAfter <= maxWait) {
				rateLimitRetries++;
				await options.sleep(retryAfter * 1000 + 250);
				continue;
			}
		} else if (statusCode >= 500 && request.method === 'GET' && serverRetries < 1) {
			serverRetries++;
			await options.sleep(1000);
			continue;
		}

		throw toPerpetuusError(statusCode, body, headers);
	}
}

export function createApiClient(send: Sender, options: RetryOptions): ApiClient {
	return {
		async request<T = unknown>(
			method: HttpMethod,
			path: string,
			requestOptions: { query?: Query; body?: unknown } = {},
		): Promise<T> {
			return (await sendWithRetry(
				send,
				{ method, path, query: requestOptions.query, body: requestOptions.body },
				options,
			)) as T;
		},
	};
}
