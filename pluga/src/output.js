'use strict';

/**
 * Pluga maps flat attributes (dot notation for nested objects). Lists of plain values become
 * comma-separated text; objects such as `fields`/`customFields` stay nested so `fields.<slug>`
 * works; lists of objects are dropped (the caller exposes what is useful as text first).
 */
function forPluga(entity) {
  const out = {};
  for (const [key, value] of Object.entries(entity)) {
    if (Array.isArray(value)) {
      if (value.every((entry) => entry === null || typeof entry !== 'object')) {
        out[key] = value.filter((entry) => entry !== null && entry !== undefined).join(', ');
      }
      continue;
    }
    out[key] = value;
  }
  return out;
}

module.exports = { forPluga };
