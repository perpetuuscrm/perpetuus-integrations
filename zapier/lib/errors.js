'use strict';

/**
 * Canonical error messages of the v1 contract (docs/v1-contract.md §3.3), as Zapier errors.
 * `z.errors.Error` for every failure except the final 429, which becomes a
 * `z.errors.ThrottledError` with the Retry-After delay so Zapier retries the step later.
 */
const { DEFAULT_THROTTLE_DELAY_SECONDS } = require('./constants');

function headerValue(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') {
    const value = headers.get(name);
    return value === null ? undefined : value;
  }
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    if (Array.isArray(value)) return value.length ? String(value[0]) : undefined;
    return value === undefined || value === null ? undefined : String(value);
  }
  return undefined;
}

function asErrorBody(body) {
  return body && typeof body === 'object' ? body : {};
}

/** Seconds to wait, from the Retry-After header or `error.details.retryAfter`. */
function parseRetryAfter(headers, body) {
  const raw = headerValue(headers, 'retry-after');
  if (raw !== undefined) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
    const date = Date.parse(raw);
    if (!Number.isNaN(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  }
  const details = asErrorBody(body).error?.details;
  const fromBody = Number(details?.retryAfter);
  return details && Number.isFinite(fromBody) && fromBody >= 0 ? Math.ceil(fromBody) : undefined;
}

function stringifyDetails(details) {
  if (details === undefined || details === null) return '';
  if (typeof details === 'object' && Object.keys(details).length === 0) return '';
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

function withDetails(message, details) {
  return details ? `${message} Details: ${details}` : message;
}

/** Turns a non-2xx response (status, parsed body, headers) into the canonical Zapier error. */
function toPerpetuusError(z, statusCode, body, headers) {
  const parsed = asErrorBody(body);
  const apiMessage = String(parsed.error?.message ?? parsed.message ?? '').trim();
  const details = parsed.error?.details;
  const detailText = stringifyDetails(details);

  switch (statusCode) {
    case 400:
      return new z.errors.Error(
        withDetails(`Perpetuus rejected the request: ${apiMessage || 'invalid data'}`, detailText),
        'InvalidData',
        400,
      );
    case 401:
      return new z.errors.Error(
        'Invalid or expired Perpetuus API key. Create a new key in Settings → API Tokens e MCP and update the credential.',
        'AuthenticationError',
        401,
      );
    case 402:
      return new z.errors.Error(
        `Your Perpetuus plan contact limit was reached: ${apiMessage || 'upgrade the plan to add more contacts'}`,
        'PlanLimitReached',
        402,
      );
    case 403: {
      const scope =
        /escopo\s+([a-z]+:[a-z]+)/i.exec(apiMessage)?.[1] ??
        (typeof details?.requiredScope === 'string' ? details.requiredScope : undefined);
      if (scope) {
        return new z.errors.Error(
          `The Perpetuus API key is missing the "${scope}" scope. Create a key with the crm:write scope (it includes crm:read).`,
          'MissingScope',
          403,
        );
      }
      return new z.errors.Error(
        `Perpetuus denied access: ${apiMessage || 'forbidden'}`,
        'Forbidden',
        403,
      );
    }
    case 404:
      return new z.errors.Error(
        `Not found in Perpetuus: ${apiMessage || 'resource not found'}`,
        'NotFound',
        404,
      );
    case 429: {
      const retryAfter = parseRetryAfter(headers, body);
      const wait = retryAfter === undefined ? 'a minute' : `${retryAfter} seconds`;
      return new z.errors.ThrottledError(
        `Perpetuus rate limit reached (120 requests/min per key). Try again in ${wait}.`,
        retryAfter ?? DEFAULT_THROTTLE_DELAY_SECONDS,
      );
    }
    default:
      if (statusCode >= 500) {
        return new z.errors.Error(
          `Perpetuus server error (HTTP ${statusCode}). Try again later.`,
          'ServerError',
          statusCode,
        );
      }
      return new z.errors.Error(
        withDetails(
          `Perpetuus request failed (HTTP ${statusCode}): ${apiMessage || 'unknown error'}`,
          detailText,
        ),
        'RequestFailed',
        statusCode,
      );
  }
}

/** Error for invalid user input caught before calling the API. */
function inputError(z, message) {
  return new z.errors.Error(message, 'InvalidInput', 400);
}

module.exports = { parseRetryAfter, toPerpetuusError, inputError };
