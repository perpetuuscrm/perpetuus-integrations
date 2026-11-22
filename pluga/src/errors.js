'use strict';

/**
 * Errors of the adapter and their HTTP answer to Pluga.
 *
 * Pluga's contract (developers.pluga.co/api-docs/pluga-developers.yml) answers errors as
 * `{ message }` with 400, 401 or 404. Texts follow docs/v1-contract.md §3.3.
 */

class AdapterError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = 'AdapterError';
    this.status = status;
    Object.assign(this, extra);
  }
}

/** Invalid input from Pluga (missing field, bad value). */
function inputError(_z, message) {
  return new AdapterError(400, message);
}

class UpstreamError extends AdapterError {
  constructor(message) {
    super(502, message);
    this.name = 'UpstreamError';
  }
}

/** Error answered by the Perpetuus API (thrown by src/client.js). */
class ApiError extends Error {
  constructor(status, body, retryAfter) {
    const error = body && typeof body === 'object' && body.error && typeof body.error === 'object' ? body.error : {};
    super(typeof error.message === 'string' && error.message ? error.message : `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.details = error.details;
    this.retryAfter = retryAfter;
  }
}

function detailsText(details) {
  if (details === undefined || details === null) return '';
  if (typeof details === 'object' && Object.keys(details).length === 0) return '';
  try {
    return ` Details: ${JSON.stringify(details)}`;
  } catch {
    return '';
  }
}

function missingScope(error) {
  const fromDetails = error.details && error.details.requiredScope;
  if (fromDetails) return String(fromDetails);
  const match = /PAT sem escopo\s+(\S+)/i.exec(error.message || '');
  return match ? match[1] : null;
}

/** `{ status, headers, body }` answered to Pluga for any thrown error. Never echoes secrets. */
function toResponse(error) {
  if (error instanceof ApiError) {
    const { status } = error;
    if (status === 401) {
      return reply(401, 'Invalid or expired Perpetuus API key. Create a new key in Settings → API Tokens e MCP and update the connection.');
    }
    if (status === 429) {
      const seconds = error.retryAfter ?? 60;
      return {
        status: 429,
        headers: { 'Retry-After': String(seconds) },
        body: { message: `Perpetuus rate limit reached (120 requests/min per key). Try again in ${seconds} seconds.` },
      };
    }
    if (status >= 500) return reply(502, `Perpetuus server error (HTTP ${status}). Try again later.`);
    if (status === 400 || status === 422) return reply(400, `Perpetuus rejected the request: ${error.message}${detailsText(error.details)}`);
    if (status === 402) return reply(400, `Your Perpetuus plan contact limit was reached: ${error.message}`);
    if (status === 403) {
      const scope = missingScope(error);
      return scope
        ? reply(400, `The Perpetuus API key is missing the "${scope}" scope. Create a key with the crm:write scope (it includes crm:read).`)
        : reply(400, `Perpetuus denied access: ${error.message}`);
    }
    if (status === 404) return reply(400, `Not found in Perpetuus: ${error.message}`);
    return reply(400, `Perpetuus rejected the request (HTTP ${status}): ${error.message}`);
  }
  if (error instanceof AdapterError) return reply(error.status, error.message);
  if (error && (error.name === 'TimeoutError' || error.name === 'AbortError' || error.cause)) {
    return reply(502, 'Could not reach Perpetuus. Try again later.');
  }
  return reply(500, 'Internal error in the Perpetuus adapter.');
}

function reply(status, message) {
  return { status, body: { message } };
}

module.exports = { AdapterError, UpstreamError, ApiError, inputError, toResponse };
