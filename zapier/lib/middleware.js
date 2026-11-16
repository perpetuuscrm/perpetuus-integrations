'use strict';

const { DEFAULT_BASE_URL } = require('./constants');
const { toPerpetuusError } = require('./errors');

/**
 * Base URL from the connection, validated: HTTPS only, no trailing slash. Empty means the
 * production API.
 */
function resolveBaseUrl(z, raw) {
  const value = String(raw ?? '').trim();
  if (!value) return DEFAULT_BASE_URL;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    parsed = undefined;
  }
  if (!parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new z.errors.Error(
      `The API Base URL must be an HTTPS address such as ${DEFAULT_BASE_URL}.`,
      'InvalidBaseUrl',
      400,
    );
  }
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
}

/** Adds the base URL to relative paths and the Bearer header with the API key. */
function addAuthHeader(request, z, bundle) {
  const authData = bundle.authData || {};
  if (typeof request.url === 'string' && request.url.startsWith('/')) {
    request.url = `${resolveBaseUrl(z, authData.baseUrl)}${request.url}`;
  }
  request.headers = request.headers || {};
  request.headers.Accept = 'application/json';
  const apiKey = String(authData.apiKey ?? '').trim();
  if (apiKey) request.headers.Authorization = `Bearer ${apiKey}`;
  // Our afterResponse turns 429 into a ThrottledError with the canonical message.
  request.throwForThrottlingEarly = false;
  return request;
}

/**
 * Turns 4xx/5xx into the canonical errors (401, 403, 429...). Requests made through
 * lib/client.js set skipThrowForStatus because the client retries and throws on its own.
 */
function handleErrors(response, z) {
  if (response.skipThrowForStatus) return response;
  if (response.status >= 400) {
    throw toPerpetuusError(z, response.status, response.data, response.headers);
  }
  return response;
}

module.exports = {
  befores: [addAuthHeader],
  afters: [handleErrors],
  resolveBaseUrl,
};
