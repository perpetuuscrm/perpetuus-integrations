'use strict';

/**
 * Settings from the environment. Nothing here is printed or logged.
 *
 * PERPETUUS_API_BASE_URL  Perpetuus REST API (default production).
 * PUBLIC_BASE_URL         Public https URL of this adapter (the `base_url` sent to Pluga and the
 *                         host of the relay URLs registered in Perpetuus).
 * RELAY_KEY               32 random bytes, base64. Encrypts the relay tokens (AES-256-GCM).
 *                         Rotating it breaks every active Pluga trigger.
 * ALLOWED_TARGET_HOSTS    Comma-separated host suffixes the relay may deliver to (default
 *                         `pluga.co`). Protects against the adapter being used to POST elsewhere.
 * PORT                    HTTP port (default 3000).
 */

function loadConfig(env = process.env) {
  const publicBaseUrl = String(env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const relayKey = env.RELAY_KEY ? Buffer.from(String(env.RELAY_KEY), 'base64') : null;
  if (relayKey && relayKey.length !== 32) {
    throw new Error('RELAY_KEY must be 32 bytes encoded in base64.');
  }
  return {
    apiBaseUrl: String(env.PERPETUUS_API_BASE_URL || 'https://api.perpetuus.com.br/api').replace(/\/+$/, ''),
    publicBaseUrl,
    relayKey,
    allowedTargetHosts: String(env.ALLOWED_TARGET_HOSTS || 'pluga.co')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
    port: Number(env.PORT || 3000),
    requestTimeoutMs: Number(env.REQUEST_TIMEOUT_MS || 25000),
    relayTimeoutMs: Number(env.RELAY_TIMEOUT_MS || 8000),
  };
}

module.exports = { loadConfig };
