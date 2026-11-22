'use strict';

/**
 * Routes of the Pluga Developers contract (developers.pluga.co/api-docs/pluga-developers.yml)
 * plus the relay endpoint that receives Perpetuus webhooks. `handle()` is transport-agnostic so
 * the tests can call it without a socket.
 */
const { createClient } = require('./client');
const { appManifest } = require('./manifest');
const { runHelper } = require('./helpers');
const { ACTIONS, performAction } = require('./actions');
const triggers = require('./triggers');
const { AdapterError, toResponse } = require('./errors');

const json = (status, body, headers) => ({ status, body, ...(headers ? { headers } : {}) });

function bearer(headers) {
  const raw = String(headers.authorization || headers.Authorization || '').trim();
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  const token = (match ? match[1] : raw).trim();
  return token || null;
}

function createApp(config, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  const relayFetch = deps.relayFetch || fetchImpl;

  function clientFor(headers, { required = true } = {}) {
    const token = bearer(headers);
    if (!token) {
      if (required) throw new AdapterError(401, 'Unauthorized');
      return null;
    }
    return createClient({ apiBaseUrl: config.apiBaseUrl, token, timeoutMs: config.requestTimeoutMs, fetchImpl });
  }

  const routes = [
    ['GET', /^\/health$/, async () => json(200, { ok: true })],
    ['GET', /^\/manifest\.json$/, async () => json(200, appManifest(config))],

    ['GET', /^\/ping$/, async (req) => {
      const client = clientFor(req.headers);
      const info = await client.request('GET', '/auth/token-info');
      const data = (info && info.data) || {};
      const user = data.user || {};
      const org = data.organization || {};
      const credential = data.credential || {};
      return json(200, {
        name: org.name ? `${org.name}${user.email ? ` (${user.email})` : ''}` : user.username || user.email || 'Perpetuus',
        email: user.email || null,
        scopes: Array.isArray(credential.scopes) ? credential.scopes : [],
      });
    }],

    ['GET', /^\/helpers\/([^/]+)$/, async (req, [id]) => {
      const client = clientFor(req.headers);
      const options = await runHelper(id, client, req.query);
      return options ? json(200, options) : json(404, { message: 'Helper not found' });
    }],

    ['GET', /^\/actions\/([^/]+)\/manifest\.json$/, async (req, [id]) =>
      ACTIONS[id] ? json(200, ACTIONS[id].manifest) : json(404, { message: 'Action not found' })],

    ['GET', /^\/actions\/([^/]+)\/fields$/, async (req, [id]) => {
      if (!ACTIONS[id]) return json(404, { message: 'Action not found' });
      return json(200, await ACTIONS[id].fields(clientFor(req.headers, { required: false }), req.query));
    }],

    ['GET', /^\/actions\/([^/]+)\/attributes$/, async (req, [id]) => {
      if (!ACTIONS[id]) return json(404, { message: 'Action not found' });
      return json(200, await ACTIONS[id].attributes(clientFor(req.headers, { required: false }), req.query));
    }],

    ['POST', /^\/actions\/([^/]+)$/, async (req, [id]) => {
      if (!ACTIONS[id]) return json(404, { message: 'Action not found' });
      return json(201, await performAction(id, clientFor(req.headers), req.body));
    }],

    ['GET', /^\/triggers\/([^/]+)\/manifest\.json$/, async (req, [id]) =>
      triggers.TRIGGERS[id] ? json(200, triggers.TRIGGERS[id].manifest) : json(404, { message: 'Trigger not found' })],

    ['GET', /^\/triggers\/([^/]+)\/attributes$/, async (req, [id]) => {
      if (!triggers.TRIGGERS[id]) return json(404, { message: 'Trigger not found' });
      return json(200, await triggers.TRIGGERS[id].attributes(clientFor(req.headers, { required: false }), req.query));
    }],

    ['GET', /^\/triggers\/([^/]+)\/sample$/, async (req, [id]) => {
      if (!triggers.TRIGGERS[id]) return json(404, { message: 'Trigger not found' });
      return json(200, await triggers.sample(id, clientFor(req.headers), req.query));
    }],

    ['POST', /^\/triggers\/([^/]+)\/subscribe$/, async (req, [id]) => {
      if (!triggers.TRIGGERS[id]) return json(404, { message: 'Trigger not found' });
      return json(201, await triggers.subscribe(id, clientFor(req.headers), req.body || {}, config));
    }],

    ['DELETE', /^\/triggers\/([^/]+)\/unsubscribe\/([^/]+)$/, async (req, [id, webhookId]) => {
      if (!triggers.TRIGGERS[id]) return json(404, { message: 'Trigger not found' });
      await triggers.unsubscribe(clientFor(req.headers), webhookId);
      return { status: 204 };
    }],

    ['POST', /^\/relay\/([A-Za-z0-9_-]+)$/, async (req, [token]) =>
      triggers.deliver({ token, headers: req.headers, rawBody: req.rawBody || '' }, config, relayFetch)],
  ];

  async function handle(req) {
    const path = req.path.replace(/\/+$/, '') || '/';
    let pathMatched = false;
    for (const [method, pattern, handler] of routes) {
      const match = pattern.exec(path);
      if (!match) continue;
      pathMatched = true;
      if (method !== req.method) continue;
      try {
        return await handler({ ...req, query: req.query || {}, headers: req.headers || {} }, match.slice(1).map(decodeURIComponent));
      } catch (error) {
        return toResponse(error);
      }
    }
    return pathMatched ? json(405, { message: 'Method not allowed' }) : json(404, { message: 'Not found' });
  }

  return { handle };
}

module.exports = { createApp, bearer };
