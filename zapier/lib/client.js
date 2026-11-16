'use strict';

/**
 * HTTP client with the retry policy of the v1 contract (docs/v1-contract.md §3.2):
 * - 429: wait Retry-After inline (only when it is short, see MAX_INLINE_RETRY_AFTER_SECONDS)
 *   and retry up to 2 times; otherwise throw ThrottledError so Zapier retries the step later;
 * - 5xx / network error: retry once after 1 s, only for GET (writes have no idempotency key);
 * - other 4xx: fail right away with the canonical message.
 */
const {
  MAX_INLINE_RETRY_AFTER_SECONDS,
  MAX_RATE_LIMIT_RETRIES,
} = require('./constants');
const { parseRetryAfter, toPerpetuusError } = require('./errors');
const { withQuery } = require('./query');

/** Kept on an object so tests can replace it. */
const timing = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const NETWORK_ERROR_NAMES = ['FetchError', 'AbortError', 'TimeoutError'];
const NETWORK_ERROR_CODES = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND'];

function isNetworkError(error) {
  if (!error) return false;
  return NETWORK_ERROR_NAMES.includes(error.name) || NETWORK_ERROR_CODES.includes(error.code);
}

/**
 * Sends one request to the Perpetuus API. `path` is relative to the base URL (e.g.
 * `/contacts`); the beforeRequest middleware adds the base URL and the Bearer header.
 * Returns the parsed JSON body (null when the response has no body).
 */
async function apiRequest(z, method, path, options = {}) {
  const url = withQuery(path, options.query);
  let rateLimitRetries = 0;
  let serverRetries = 0;

  for (;;) {
    let response;
    try {
      response = await z.request({
        method,
        url,
        ...(options.body === undefined ? {} : { json: options.body }),
        skipThrowForStatus: true,
        throwForThrottlingEarly: false,
      });
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      if (method === 'GET' && serverRetries < 1) {
        serverRetries++;
        await timing.sleep(1000);
        continue;
      }
      throw new z.errors.Error(`Could not reach Perpetuus: ${error.message}`, 'NetworkError');
    }

    const { status } = response;
    if (status >= 200 && status < 300) return response.data ?? null;

    if (status === 429) {
      const retryAfter = parseRetryAfter(response.headers, response.data) ?? 1;
      if (rateLimitRetries < MAX_RATE_LIMIT_RETRIES && retryAfter <= MAX_INLINE_RETRY_AFTER_SECONDS) {
        rateLimitRetries++;
        await timing.sleep(retryAfter * 1000 + 250);
        continue;
      }
    } else if (status >= 500 && method === 'GET' && serverRetries < 1) {
      serverRetries++;
      await timing.sleep(1000);
      continue;
    }

    throw toPerpetuusError(z, status, response.data, response.headers);
  }
}

/** Client object shared by the operations: `client.request(method, path, { query, body })`. */
function createClient(z) {
  return {
    z,
    request: (method, path, options) => apiRequest(z, method, path, options),
  };
}

module.exports = { apiRequest, createClient, timing };
