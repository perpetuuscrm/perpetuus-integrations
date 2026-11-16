'use strict';

function append(params, key, value) {
  if (value === undefined || value === null || value === '') return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => append(params, `${key}[${index}]`, entry));
    return;
  }
  if (typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      append(params, `${key}[${childKey}]`, childValue);
    }
    return;
  }
  params.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
}

/**
 * Serializes nested objects with the bracket syntax Strapi expects:
 * `{ filters: { createdAt: { $gte: 'x' } } }` -> `filters%5BcreatedAt%5D%5B%24gte%5D=x`.
 * Empty values (undefined, null, '') are skipped.
 */
function buildQueryString(query) {
  if (!query) return '';
  const params = [];
  for (const [key, value] of Object.entries(query)) append(params, key, value);
  return params.join('&');
}

/** `path` plus its query string. */
function withQuery(path, query) {
  const qs = buildQueryString(query);
  return qs ? `${path}?${qs}` : path;
}

module.exports = { buildQueryString, withQuery };
