'use strict';

/**
 * Perpetuus API client with the retry policy of docs/v1-contract.md §3.2:
 * - 429: wait Retry-After (only when ≤ 10 s) and retry up to 2 times, else fail with 429;
 * - 5xx / network error: one retry after 1 s, only for GET (writes have no idempotency key);
 * - other 4xx: fail right away.
 * The user's Bearer key (`ppt_…`) is forwarded as is and never logged.
 */
const { ApiError } = require('./errors');
const { withQuery } = require('./perpetuus/query');

const MAX_RATE_LIMIT_RETRIES = 2;
const MAX_INLINE_RETRY_AFTER_SECONDS = 10;

const timing = { sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };

function parseRetryAfter(headers, body) {
  const raw = headers.get('retry-after');
  if (raw !== null && raw !== undefined) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  }
  const fromBody = Number(body && body.error && body.error.details && body.error.details.retryAfter);
  return Number.isFinite(fromBody) && fromBody >= 0 ? Math.ceil(fromBody) : undefined;
}

async function readBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text.slice(0, 200) } };
  }
}

function createClient({ apiBaseUrl, token, timeoutMs = 25000, fetchImpl = globalThis.fetch }) {
  async function request(method, path, options = {}) {
    const url = `${apiBaseUrl}${withQuery(path, options.query)}`;
    let rateLimitRetries = 0;
    let serverRetries = 0;
    for (;;) {
      let response;
      try {
        response = await fetchImpl(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'User-Agent': 'perpetuus-pluga-adapter/1.0',
            ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (method === 'GET' && serverRetries < 1) {
          serverRetries++;
          await timing.sleep(1000);
          continue;
        }
        throw error;
      }
      const body = await readBody(response);
      const { status } = response;
      if (status >= 200 && status < 300) return body;
      if (status === 429) {
        const retryAfter = parseRetryAfter(response.headers, body) ?? 1;
        if (rateLimitRetries < MAX_RATE_LIMIT_RETRIES && retryAfter <= MAX_INLINE_RETRY_AFTER_SECONDS) {
          rateLimitRetries++;
          await timing.sleep(retryAfter * 1000 + 250);
          continue;
        }
        throw new ApiError(status, body, retryAfter);
      }
      if (status >= 500 && method === 'GET' && serverRetries < 1) {
        serverRetries++;
        await timing.sleep(1000);
        continue;
      }
      throw new ApiError(status, body);
    }
  }
  return { z: null, request };
}

module.exports = { createClient, timing };
