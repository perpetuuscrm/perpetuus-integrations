'use strict';

/**
 * Stateless relay between Perpetuus webhooks v1 and Pluga.
 *
 * Pluga gives us its webhook URL on subscribe. Instead of registering that URL in Perpetuus
 * (Pluga would get the raw v1 envelope), the adapter registers `${PUBLIC_BASE_URL}/relay/<token>`,
 * where the token is the subscription context encrypted with AES-256-GCM (RELAY_KEY):
 * `{ v, u: plugaUrl, t: triggerId, b: boardId, p: phaseId, s: whsecSecret }`.
 * On delivery the adapter decrypts the token, checks the Perpetuus HMAC signature, filters
 * (event type, Board, Phase), maps the event to the same flat output as the other connectors
 * and POSTs it to Pluga. No database: the token carries everything and only this service can
 * read or forge it.
 */
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');

const TOKEN_VERSION = 1;

function seal(key, payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify({ v: TOKEN_VERSION, ...payload }), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

/** The payload, or null when the token was not made with this key or was tampered with. */
function open(key, token) {
  try {
    const raw = Buffer.from(String(token), 'base64url');
    if (raw.length < 29) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const text = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    const payload = JSON.parse(text);
    return payload && payload.v === TOKEN_VERSION ? payload : null;
  } catch {
    return null;
  }
}

// ─── Target URL guard (anti-SSRF) ───────────────────────────────────────────

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  const lower = address.toLowerCase();
  if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7));
  return lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
}

/** Throws unless `url` is https, on an allowed host suffix and resolves only to public IPs. */
async function assertTargetAllowed(url, allowedHosts, lookup = dns.lookup) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    throw Object.assign(new Error('The webhook url is not a valid URL.'), { status: 400 });
  }
  if (parsed.protocol !== 'https:') throw Object.assign(new Error('The webhook url must use https.'), { status: 400 });
  if (parsed.username || parsed.password) throw Object.assign(new Error('The webhook url must not carry credentials.'), { status: 400 });
  const host = parsed.hostname.toLowerCase();
  if (!allowedHosts.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
    throw Object.assign(new Error(`The webhook url host ${host} is not allowed.`), { status: 400 });
  }
  const addresses = await lookup(host, { all: true }).catch(() => []);
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw Object.assign(new Error(`The webhook url host ${host} does not resolve to a public address.`), { status: 400 });
  }
  return parsed.toString();
}

module.exports = { seal, open, assertTargetAllowed, isPrivateAddress };
