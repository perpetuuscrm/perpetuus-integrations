'use strict';

/**
 * Live test against the real Perpetuus API with a demo organization key. Creates test records
 * (prefixed "[pluga-test]") and removes them at the end. Never prints the key.
 *
 *   PERPETUUS_TEST_KEY_FILE=/path/key.txt   (or PERPETUUS_TEST_KEY)  key of org perpetuus-demo
 *   PERPETUUS_TEST_BOARD_ID=<board>         board to write in
 *   LIVE_PUBLIC_URL=https://<tunnel>        optional: public URL that reaches LIVE_PORT, enables
 *   LIVE_PORT=3999                          the end-to-end webhook relay test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { createApp } = require('../src/app');
const { createServer } = require('../src/server');
const relay = require('../src/relay');
const triggers = require('../src/triggers');
const { unwrapOne } = require('../src/perpetuus/mappers');
const { validateResponse, checkFieldRules } = require('./spec-validator');

const KEY = (process.env.PERPETUUS_TEST_KEY || (process.env.PERPETUUS_TEST_KEY_FILE && fs.readFileSync(process.env.PERPETUUS_TEST_KEY_FILE, 'utf8')) || '').trim();
const BOARD = process.env.PERPETUUS_TEST_BOARD_ID;
const PUBLIC = (process.env.LIVE_PUBLIC_URL || '').replace(/\/+$/, '');
const PORT = Number(process.env.LIVE_PORT || 3999);
const API = 'https://api.perpetuus.com.br/api';
const skip = !KEY || !BOARD ? 'set PERPETUUS_TEST_KEY(_FILE) and PERPETUUS_TEST_BOARD_ID' : false;

const config = {
  apiBaseUrl: API,
  publicBaseUrl: PUBLIC || process.env.RELAY_HOST || 'https://perpetuus-crm-mcp.services.perpetuus.com.br',
  relayKey: crypto.randomBytes(32),
  allowedTargetHosts: PUBLIC ? [new URL(PUBLIC).hostname] : ['pluga.co'],
  // The box resolves every host to a sandbox address; production uses real DNS.
  lookup: async () => [{ address: '34.1.2.3', family: 4 }],
  requestTimeoutMs: 30000,
  relayTimeoutMs: 8000,
};
const app = createApp(config);
const auth = { authorization: `Bearer ${KEY}` };
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const created = { cards: [], contacts: [], tasks: [], subscriptions: [] };
const report = {};

async function raw(method, path, body) {
  const res = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const call = (method, path, { query = {}, body, headers = auth } = {}) => app.handle({ method, path, query, headers, body });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('live: Pluga contract against the Perpetuus API (demo org)', { skip, timeout: 600000 }, async (t) => {
  const info = await raw('GET', '/auth/token-info');
  assert.equal(info.status, 200);
  assert.equal(info.body.data.organization.slug, 'perpetuus-demo', 'refusing to run outside the demo organization');

  // Sink that plays Pluga's webhook receiver, behind the same public URL as the adapter.
  const received = [];
  let server;
  if (PUBLIC) {
    const adapter = createServer(config);
    server = http.createServer((req, res) => {
      if (req.url.startsWith('/__sink/')) {
        let data = '';
        req.on('data', (c) => (data += c));
        req.on('end', () => {
          received.push({ name: req.url.slice('/__sink/'.length), body: JSON.parse(data || '{}'), at: Date.now() });
          res.writeHead(200).end('{}');
        });
        return;
      }
      adapter.emit('request', req, res);
    });
    await new Promise((r) => server.listen(PORT, r));
  }

  try {
    await t.test('ping', async () => {
      const ok = await call('GET', '/ping');
      assert.equal(ok.status, 200);
      validateResponse('GET', '/ping', 200, ok.body);
      const bad = await call('GET', '/ping', { headers: { authorization: 'Bearer ppt_invalid_key_for_test' } });
      assert.equal(bad.status, 401);
      validateResponse('GET', '/ping', 401, bad.body);
      report.ping = { ok: ok.body.name, scopes: ok.body.scopes.length, invalid: bad.status };
    });

    let phases;
    await t.test('helpers', async () => {
      for (const id of ['boards_list', 'phases_list', 'tags_list', 'members_list', 'cards_list']) {
        const res = await call('GET', `/helpers/${id}`, { query: { boardId: BOARD } });
        assert.equal(res.status, 200, `${id}: ${JSON.stringify(res.body)}`);
        validateResponse('GET', '/helpers/{helper_id}', 200, res.body);
        assert.ok(res.body.length > 0, `${id} not empty`);
        report[id] = res.body.length;
        if (id === 'phases_list') phases = res.body;
      }
    });

    let createFields;
    await t.test('action manifests, fields and attributes with the real Board', async () => {
      for (const id of ['create_card', 'move_card', 'add_card_tags', 'upsert_contact', 'create_task']) {
        const fields = await call('GET', `/actions/${id}/fields`, { query: { boardId: BOARD } });
        assert.equal(fields.status, 200);
        validateResponse('GET', '/actions/{action_id}/fields', 200, fields.body);
        checkFieldRules(fields.body);
        if (id === 'create_card') createFields = fields.body;
        const attributes = await call('GET', `/actions/${id}/attributes`, { query: { boardId: BOARD } });
        validateResponse('GET', '/actions/{action_id}/attributes', 200, attributes.body);
      }
      report.createCardCustomFields = createFields.filter((f) => f.key.startsWith('fields.')).map((f) => `${f.key}:${f.type}${f.required ? '*' : ''}`);
    });

    // Subscribe before writing so the writes produce real deliveries. With LIVE_PUBLIC_URL the
    // relay runs end to end (Perpetuus → public URL → relay → sink). Without it, the relay URL
    // points at RELAY_HOST (a public host of ours that answers 404, so the API does not retry),
    // the API delivery log proves the fan-out, and the relay is replayed locally with the real
    // signing secret.
    const subs = {};
    await t.test('subscribe rest_hook triggers', async () => {
      const plan = {
        card_created: { boardId: BOARD },
        card_entered_phase: { boardId: BOARD, phaseId: phases[phases.length - 1].value },
        entered_any: { trigger: 'card_entered_phase', boardId: BOARD },
        contact_created: {},
      };
      for (const [name, cfg] of Object.entries(plan)) {
        const trigger = cfg.trigger || name;
        const url = PUBLIC ? `${PUBLIC}/__sink/${name}` : `https://webhook.pluga.co/perpetuus-live-test/${name}`;
        const res = await call('POST', `/triggers/${trigger}/subscribe`, { body: { url, boardId: cfg.boardId, phaseId: cfg.phaseId } });
        assert.equal(res.status, 201, `${name}: ${JSON.stringify(res.body)}`);
        validateResponse('POST', '/triggers/{trigger_id}/subscribe', 201, res.body);
        subs[name] = { id: res.body.id, trigger, cfg };
        created.subscriptions.push(res.body.id);
      }
      const list = await raw('GET', '/webhook-subscriptions');
      const mine = list.body.data.filter((s) => created.subscriptions.includes(s.id));
      assert.equal(mine.length, 4);
      for (const s of mine) {
        assert.equal(s.status, 'active');
        assert.ok(s.url.startsWith(`${config.publicBaseUrl}/relay/`), 'relay URL registered');
        const context = relay.open(config.relayKey, s.url.split('/relay/')[1]);
        assert.ok(context && context.s && context.s.startsWith('whsec_'), 'token carries the signing secret after the PATCH');
        const name = Object.keys(subs).find((n) => subs[n].id === s.id);
        subs[name].context = context;
        subs[name].events = s.events;
      }
      report.subscriptions = Object.fromEntries(Object.entries(subs).map(([n, x]) => [n, x.events]));
      report.relayUrlLength = mine[0].url.length;
    });

    let contactId;
    let cardId;
    const firstPhase = () => phases[0].value;
    const secondPhase = () => phases[Math.min(1, phases.length - 1)].value;
    const lastPhase = () => phases[phases.length - 1].value;

    await t.test('upsert_contact creates then updates', async () => {
      const email = `pluga-test-${stamp}@example.com`;
      const first = await call('POST', '/actions/upsert_contact', { body: { name: `[pluga-test] Contato ${stamp}`, email, phone: '+55 11 90000-0000', contactType: 'person' } });
      assert.equal(first.status, 201, JSON.stringify(first.body));
      validateResponse('POST', '/actions/{action_id}', 201, first.body);
      assert.equal(first.body.created, true);
      contactId = first.body.id;
      created.contacts.push(contactId);
      const second = await call('POST', '/actions/upsert_contact', { body: { email, city: 'São Paulo' } });
      assert.equal(second.status, 201);
      assert.equal(second.body.id, contactId);
      assert.equal(second.body.created, false);
      assert.equal(second.body.city, 'São Paulo');
      report.upsert = { created: first.body.created, updatedSameId: second.body.id === contactId, matchedBy: second.body.matchedBy };
    });

    await t.test('create_card in a later Phase with contact by email and custom fields', async () => {
      const body = { boardId: BOARD, phaseId: secondPhase(), title: `[pluga-test] Card ${stamp}`, contactEmail: `pluga-test-${stamp}@example.com`, value: '1234,56', description: 'Criado pelo teste do adaptador Pluga' };
      for (const f of createFields.filter((x) => x.key.startsWith('fields.') && x.required)) {
        const k = f.key.toLowerCase();
        body[f.key] = f.options ? f.options[0].value
          : f.type === 'decimal' ? '1'
          : f.type === 'datetime' ? new Date().toISOString()
          : /whats|phone|telefone|celular/.test(k) ? '+5511900000000'
          : /mail/.test(k) ? `pluga-test-${stamp}@example.com`
          : 'teste';
      }
      const res = await call('POST', '/actions/create_card', { body });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      validateResponse('POST', '/actions/{action_id}', 201, res.body);
      cardId = res.body.id;
      created.cards.push(cardId);
      assert.equal(res.body.phaseId, secondPhase());
      assert.equal(res.body.contactId, contactId, 'linked to the upserted contact (no duplicate)');
      assert.equal(res.body.value, 1234.56);
      assert.ok(!res.body.warning, res.body.warning);
      const attributes = (await call('GET', '/actions/create_card/attributes')).body;
      for (const { key } of attributes) assert.ok(key in res.body, `has ${key}`);
      report.createCard = { phase: res.body.phaseName, contactLinked: res.body.contactId === contactId };
    });

    await t.test('move_card and add_card_tags', async () => {
      const moved = await call('POST', '/actions/move_card', { body: { boardId: BOARD, phaseId: lastPhase(), cardId, reason: 'pluga-test' } });
      assert.equal(moved.status, 201, JSON.stringify(moved.body));
      assert.equal(moved.body.phaseId, lastPhase());
      const tags = (await call('GET', '/helpers/tags_list', { query: { boardId: BOARD } })).body;
      const tagged = await call('POST', '/actions/add_card_tags', { body: { boardId: BOARD, tagIds: [tags[0].value], cardId } });
      assert.equal(tagged.status, 201, JSON.stringify(tagged.body));
      assert.ok(tagged.body.tagIds.includes(tags[0].value));
      const notFound = await call('POST', '/actions/move_card', { body: { boardId: BOARD, phaseId: lastPhase(), cardId: 'doesnotexist000000000000' } });
      assert.equal(notFound.status, 400);
      report.move = { to: moved.body.phaseName, tag: tagged.body.tagNames, notFound: notFound.body.message };
    });

    await t.test('create_task on the Card', async () => {
      const res = await call('POST', '/actions/create_task', { body: { name: `[pluga-test] Tarefa ${stamp}`, cardId, type: 'follow-up', priority: 'high', dueDate: new Date(Date.now() + 86400000).toISOString() } });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      validateResponse('POST', '/actions/{action_id}', 201, res.body);
      created.tasks.push(res.body.id);
      assert.equal(res.body.cardId, cardId);
      report.task = { priority: res.body.priority, status: res.body.status };
    });

    await t.test('trigger samples with real data', async () => {
      for (const id of ['card_created', 'card_entered_phase', 'contact_created', 'message_received']) {
        const res = await call('GET', `/triggers/${id}/sample`, { query: { boardId: BOARD } });
        assert.equal(res.status, 200, `${id}: ${JSON.stringify(res.body)}`);
        validateResponse('GET', '/triggers/{trigger_id}/sample', 200, res.body);
        const attributes = (await call('GET', `/triggers/${id}/attributes`)).body;
        const missing = attributes.map((a) => a.key).filter((k) => !(k in res.body));
        assert.deepEqual(missing, [], `${id} sample misses ${missing}`);
      }
    });

    await t.test('Perpetuus fans the events out to the relay subscriptions', async () => {
      const expect = { card_created: ['card.created'], card_entered_phase: ['card.created', 'card.phase_changed'], entered_any: ['card.created', 'card.phase_changed'], contact_created: ['contact.created'] };
      const log = {};
      const deadline = Date.now() + 90000;
      for (;;) {
        for (const [name, s] of Object.entries(subs)) {
          const d = await raw('GET', `/webhook-subscriptions/${s.id}/deliveries`);
          log[name] = ((d.body && d.body.data) || []).map((x) => ({ type: x.eventType, status: x.status, http: x.responseStatus, eventId: x.eventId }));
        }
        const done = Object.entries(expect).every(([n, types]) => types.every((ty) => log[n].some((x) => x.type === ty)));
        if (done || Date.now() > deadline) break;
        await sleep(5000);
      }
      report.apiDeliveryLog = Object.fromEntries(Object.entries(log).map(([n, rows]) => [n, rows.map((x) => `${x.type}:${x.status}:${x.http}`)]));
      for (const [n, types] of Object.entries(expect)) for (const ty of types) assert.ok(log[n].some((x) => x.type === ty), `${n} got ${ty}`);
      const phaseChanges = log.entered_any.filter((x) => x.type === 'card.phase_changed').length;
      report.phaseChangedCount = phaseChanges;
    });

    await t.test('relay: real-shaped deliveries signed with the real secret reach Pluga, filtered', async () => {
      const cardRaw = (await raw('GET', `/boards/${BOARD}/cards/${cardId}?populate[contact]=true&populate[currentPhase]=true&populate[tags]=true`)).body;
      const data = { ...unwrapOne(cardRaw), board: { documentId: BOARD } };
      const last = phases[phases.length - 1];
      const prev = phases[Math.min(1, phases.length - 1)];
      const moved = { ...data, fromPhase: { documentId: prev.value, name: prev.label.en }, toPhase: { documentId: last.value, name: last.label.en } };
      const created = { ...data, currentPhase: { documentId: prev.value, name: prev.label.en } };
      const cases = [
        ['card_created', { type: 'card.created', data: created }, true],
        ['card_entered_phase', { type: 'card.created', data: created }, false],
        ['card_entered_phase', { type: 'card.phase_changed', data: moved }, true],
        ['entered_any', { type: 'card.created', data: created }, true],
        ['entered_any', { type: 'card.phase_changed', data: moved }, true],
      ];
      const results = [];
      for (const [name, partial, shouldForward] of cases) {
        const s = subs[name];
        const envelope = { id: `evt_live_${crypto.randomUUID()}`, version: '1', timestamp: new Date().toISOString(), ...partial };
        const rawBody = JSON.stringify(envelope);
        const ts = Math.floor(Date.now() / 1000);
        const headers = { 'x-perpetuus-timestamp': String(ts), 'x-perpetuus-signature': `sha256=${crypto.createHmac('sha256', s.context.s).update(`${ts}.${rawBody}`).digest('hex')}` };
        const sent = [];
        const token = (await raw('GET', `/webhook-subscriptions/${s.id}`)).body;
        const url = (token.data || token).url;
        const res = await triggers.deliver({ token: url.split('/relay/')[1], headers, rawBody }, config, async (u, init) => { sent.push({ u, body: JSON.parse(init.body) }); return new Response('', { status: 200 }); });
        assert.equal(res.status, 200);
        assert.equal(sent.length, shouldForward ? 1 : 0, `${name} ${partial.type}`);
        if (sent[0]) {
          assert.equal(sent[0].u, s.context.u);
          assert.equal(sent[0].body.cardId, cardId);
          const attrs = (await call('GET', `/triggers/${s.trigger}/attributes`)).body.map((a) => a.key);
          for (const k of attrs) assert.ok(k in sent[0].body, `${name} delivery has ${k}`);
        }
        results.push(`${name}/${partial.type}:${sent.length ? `forwarded@${sent[0].body.phaseName}` : 'filtered'}`);
      }
      report.relayReplay = results;
    });

  } finally {
    for (const id of created.subscriptions) {
      const res = await call('DELETE', `/triggers/card_created/unsubscribe/${id}`);
      report.unsubscribe = [...(report.unsubscribe || []), res.status];
    }
    for (const id of created.tasks) report.cleanupTask = (await raw('DELETE', `/tasks/${id}`)).status;
    for (const id of created.cards) report.cleanupCard = (await raw('DELETE', `/boards/${BOARD}/cards/${id}`)).status;
    // Active automations in the org (for example a live Zap on new contacts) may copy test
    // records into Cards of other Boards; sweep "[pluga-test]" Cards until the contacts can go.
    const sweep = async () => {
      const boards = ((await raw('GET', '/boards?pagination[pageSize]=100')).body.data || []).map((b) => b.documentId);
      for (const b of boards) {
        const left = (await raw('GET', `/boards/${b}/cards?filters[title][$containsi]=${encodeURIComponent('[pluga-test]')}&stats=false&pagination[pageSize]=100`)).body.data || [];
        for (const c of left) report.sweptCards = [...(report.sweptCards || []), `${c.title}:${(await raw('DELETE', `/boards/${b}/cards/${c.documentId}`)).status}`];
      }
    };
    await sweep();
    for (const id of created.contacts) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const res = await raw('DELETE', `/contacts/${id}`);
        report.cleanupContact = res.status;
        if (res.status !== 400) break;
        await sleep(10000);
        await sweep();
      }
    }
    const left = await raw('GET', '/webhook-subscriptions');
    report.subscriptionsLeft = (left.body.data || []).filter((s) => created.subscriptions.includes(s.id)).length;
    if (server) await new Promise((r) => server.close(r));
    console.log('LIVE REPORT', JSON.stringify(report, null, 1));
  }
});
