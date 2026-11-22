'use strict';

/** Offline: every route of the adapter against Pluga's official OpenAPI file and prose rules. */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createApp } = require('../src/app');
const { ACTIONS } = require('../src/actions');
const { TRIGGERS } = require('../src/triggers');
const relay = require('../src/relay');
const { makeFakeApi, BASE, GOOD } = require('./fake-api');
const { validateResponse, checkFieldRules } = require('./spec-validator');

const config = {
  apiBaseUrl: BASE,
  publicBaseUrl: 'https://pluga.adapter.test',
  relayKey: crypto.randomBytes(32),
  allowedTargetHosts: ['pluga.co'],
  requestTimeoutMs: 5000,
  relayTimeoutMs: 2000,
  lookup: async () => [{ address: '34.1.2.3', family: 4 }],
};
const auth = { authorization: `Bearer ${GOOD}` };

function setup() {
  const api = makeFakeApi();
  return { api, app: createApp(config, { fetch: api.fetch }) };
}
const get = (app, path, query = {}, headers = auth) => app.handle({ method: 'GET', path, query, headers });

test('GET /manifest.json matches appConfigResponse and has 20–50 word descriptions', async () => {
  const { app } = setup();
  const res = await get(app, '/manifest.json', {}, {});
  assert.equal(res.status, 200);
  validateResponse('GET', '/manifest.json', 200, res.body);
  for (const lang of ['pt_BR', 'en']) {
    const words = res.body.description[lang].split(/\s+/).length;
    assert.ok(words >= 20 && words <= 50, `${lang} description has ${words} words`);
  }
  assert.equal(res.body.base_url, config.publicBaseUrl);
  assert.equal(res.body.name, 'Perpetuus');
});

test('GET /ping: 200 with the account, 401 without or with a bad key', async () => {
  const { app } = setup();
  const ok = await get(app, '/ping');
  assert.equal(ok.status, 200);
  validateResponse('GET', '/ping', 200, ok.body);
  assert.equal(ok.body.name, 'Acme Ltda (demo@acme.test)');
  for (const headers of [{}, { authorization: 'Bearer ppt_wrong' }]) {
    const bad = await get(app, '/ping', {}, headers);
    assert.equal(bad.status, 401);
    validateResponse('GET', '/ping', 401, bad.body);
  }
});

test('helpers return { label: {pt_BR, en}, value } lists; unknown helper is 404', async () => {
  const { app } = setup();
  for (const [id, query] of [['boards_list', {}], ['phases_list', { boardId: 'bd1' }], ['tags_list', { boardId: 'bd1' }], ['members_list', { board_id: 'bd1' }], ['cards_list', { boardId: 'bd1' }]]) {
    const res = await get(app, `/helpers/${id}`, query);
    assert.equal(res.status, 200, id);
    validateResponse('GET', '/helpers/{helper_id}', 200, res.body);
    assert.ok(res.body.length > 0, `${id} has options`);
  }
  assert.equal((await get(app, '/helpers/nope')).status, 404);
  const missingBoard = await get(app, '/helpers/phases_list');
  assert.equal(missingBoard.status, 400);
});

test('every action: manifest, fields and attributes follow the spec and prose rules', async () => {
  const { app } = setup();
  for (const id of Object.keys(ACTIONS)) {
    const manifest = await get(app, `/actions/${id}/manifest.json`, {}, {});
    assert.equal(manifest.status, 200);
    validateResponse('GET', '/actions/{action_id}/manifest.json', 200, manifest.body);
    for (const lang of ['pt_BR', 'en']) assert.match(manifest.body.task_name[lang], /Perpetuus/, `${id} task_name names the app`);
    checkFieldRules(manifest.body.configuration_fields, { config: true });

    for (const query of [{}, { boardId: 'bd1' }]) {
      const fields = await get(app, `/actions/${id}/fields`, query);
      assert.equal(fields.status, 200);
      validateResponse('GET', '/actions/{action_id}/fields', 200, fields.body);
      checkFieldRules(fields.body);
      const configKeys = new Set(manifest.body.configuration_fields.map((f) => f.key));
      for (const f of fields.body) assert.ok(!configKeys.has(f.key), `${id}: field ${f.key} repeats a configuration key`);
      const attributes = await get(app, `/actions/${id}/attributes`, query);
      assert.equal(attributes.status, 200);
      validateResponse('GET', '/actions/{action_id}/attributes', 200, attributes.body);
    }
  }
  assert.equal((await get(app, '/actions/nope/manifest.json')).status, 404);
});

test('create_card with board custom fields lists them with Pluga types', async () => {
  const { app } = setup();
  const res = await get(app, '/actions/create_card/fields', { boardId: 'bd1' });
  const byKey = Object.fromEntries(res.body.map((f) => [f.key, f]));
  assert.equal(byKey['fields.origem'].type, 'dropdown');
  assert.equal(byKey['fields.origem'].required, true);
  assert.equal(byKey['fields.orcamento'].type, 'decimal');
  assert.equal(byKey['fields.aceite'].type, 'dropdown');
  assert.ok(!byKey['fields.name'], 'title field is not repeated');
});

test('POST /actions/*: 201 with every attribute key; API errors become 400/401', async () => {
  const { app, api } = setup();
  const bodies = {
    create_card: { boardId: 'bd1', phaseId: 'ph1', title: 'Novo lead', contactEmail: 'ana@acme.test', value: '10,5', 'fields.origem': 'site', fields: { orcamento: '2000', aceite: 'sim' }, tagIds: 'tg1, tg2' },
    move_card: { boardId: 'bd1', phaseId: 'ph1', cardId: 'cd1', reason: 'ok' },
    add_card_tags: { boardId: 'bd1', tagIds: ['tg2'], cardId: 'cd1' },
    upsert_contact: { name: 'Ana', email: 'ana@acme.test', contactType: 'company' },
    create_task: { name: 'Ligar', cardId: 'cd1', type: 'follow-up', priority: 'high' },
  };
  for (const [id, body] of Object.entries(bodies)) {
    const res = await app.handle({ method: 'POST', path: `/actions/${id}`, query: {}, headers: auth, body });
    assert.equal(res.status, 201, `${id}: ${JSON.stringify(res.body)}`);
    validateResponse('POST', '/actions/{action_id}', 201, res.body);
    const attributes = (await get(app, `/actions/${id}/attributes`)).body.map((a) => a.key);
    for (const key of attributes) assert.ok(key in res.body, `${id} result has ${key}`);
    for (const [key, value] of Object.entries(res.body)) assert.ok(!Array.isArray(value), `${id}.${key} is not an array`);
  }
  const create = api.calls.find((c) => c.method === 'POST' && c.path === '/boards/bd1/cards');
  assert.deepEqual(create.body.data.fields, { origem: 'site', orcamento: 2000, aceite: true, name: 'Novo lead' });
  assert.equal(create.body.data.value, 10.5);
  assert.equal(create.body.data.contact, 'ct2', 'new contact created with the Card title as name');
  const upserts = api.calls.filter((c) => c.path === '/contacts/upsert' && c.body.data.email === 'ana@acme.test');
  assert.equal(upserts[0].body.data.name, undefined, 'first try keeps an existing name');
  assert.equal(upserts[1].body.data.name, 'Novo lead');
  assert.deepEqual(create.body.data.tags, ['tg1', 'tg2']);
  assert.ok(api.calls.some((c) => c.method === 'PUT' && c.body.data.currentPhase === 'ph1'), 'card moved to the chosen phase');
  const upsert = api.calls.find((c) => c.path === '/contacts/upsert' && c.body.data.contact_type);
  assert.equal(upsert.body.data.contact_type, 'empresa');

  const missing = await app.handle({ method: 'POST', path: '/actions/move_card', query: {}, headers: auth, body: { boardId: 'bd1', cardId: 'missing', phaseId: 'ph1' } });
  assert.equal(missing.status, 400);
  validateResponse('POST', '/actions/{action_id}', 400, missing.body);
  assert.match(missing.body.message, /^Not found in Perpetuus/);
  const invalid = await app.handle({ method: 'POST', path: '/actions/create_card', query: {}, headers: auth, body: { title: 'x' } });
  assert.equal(invalid.status, 400);
  const unauth = await app.handle({ method: 'POST', path: '/actions/create_task', query: {}, headers: {}, body: { name: 'x', cardId: 'cd1' } });
  assert.equal(unauth.status, 401);
});

test('create_card with an existing contact email does not rename the contact', async () => {
  const { app, api } = setup();
  const res = await app.handle({ method: 'POST', path: '/actions/create_card', query: {}, headers: auth, body: { boardId: 'bd1', title: 'Outro título', contactEmail: 'maria@acme.test' } });
  assert.equal(res.status, 201);
  const upserts = api.calls.filter((c) => c.path === '/contacts/upsert');
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].body.data.name, undefined);
  assert.equal(api.calls.find((c) => c.method === 'POST' && c.path === '/boards/bd1/cards').body.data.contact, 'ct1');
});

test('every trigger: manifest, attributes and sample follow the spec; sample has every attribute', async () => {
  const { app } = setup();
  for (const id of Object.keys(TRIGGERS)) {
    const manifest = await get(app, `/triggers/${id}/manifest.json`, {}, {});
    assert.equal(manifest.status, 200);
    validateResponse('GET', '/triggers/{trigger_id}/manifest.json', 200, manifest.body);
    assert.equal(manifest.body.type, 'rest_hook');
    for (const lang of ['pt_BR', 'en']) assert.match(manifest.body.task_name[lang], /Perpetuus/);
    checkFieldRules(manifest.body.configuration_fields, { config: true });

    const attributes = await get(app, `/triggers/${id}/attributes`);
    validateResponse('GET', '/triggers/{trigger_id}/attributes', 200, attributes.body);
    const sample = await get(app, `/triggers/${id}/sample`, { boardId: 'bd1' });
    assert.equal(sample.status, 200, JSON.stringify(sample.body));
    validateResponse('GET', '/triggers/{trigger_id}/sample', 200, sample.body);
    for (const { key } of attributes.body) assert.ok(key in sample.body, `${id} sample has ${key}`);
    for (const key of manifest.body.unique_keys) assert.ok(sample.body[key], `${id} sample has unique key ${key}`);
  }
});

test('subscribe registers a relay URL (secret only in the encrypted token) and unsubscribe deletes it', async () => {
  const { app, api } = setup();
  const res = await app.handle({ method: 'POST', path: '/triggers/card_entered_phase/subscribe', query: {}, headers: auth, body: { url: 'https://webhook.pluga.co/abc', boardId: 'bd1', phaseId: 'ph1' } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  validateResponse('POST', '/triggers/{trigger_id}/subscribe', 201, res.body);
  const sub = api.state.subscriptions.get(res.body.id);
  assert.deepEqual(sub.events, ['card.created', 'card.phase_changed']);
  assert.equal(sub.boardId, 'bd1');
  assert.ok(sub.url.startsWith('https://pluga.adapter.test/relay/'));
  assert.ok(!sub.url.includes('whsec_') && !sub.url.includes('pluga.co'), 'nothing readable in the relay URL');
  const context = relay.open(config.relayKey, sub.url.split('/relay/')[1]);
  assert.equal(context.u, 'https://webhook.pluga.co/abc');
  assert.equal(context.s, 'whsec_testsecret');
  assert.equal(context.p, 'ph1');

  const blocked = await app.handle({ method: 'POST', path: '/triggers/card_created/subscribe', query: {}, headers: auth, body: { url: 'https://evil.example.com/x', boardId: 'bd1' } });
  assert.equal(blocked.status, 400);
  validateResponse('POST', '/triggers/{trigger_id}/subscribe', 400, blocked.body);
  const noBoard = await app.handle({ method: 'POST', path: '/triggers/card_created/subscribe', query: {}, headers: auth, body: { url: 'https://webhook.pluga.co/abc' } });
  assert.equal(noBoard.status, 400);

  const del = await app.handle({ method: 'DELETE', path: `/triggers/card_entered_phase/unsubscribe/${res.body.id}`, query: {}, headers: auth });
  assert.equal(del.status, 204);
  assert.equal(api.state.subscriptions.size, 0);
  const again = await app.handle({ method: 'DELETE', path: `/triggers/card_entered_phase/unsubscribe/${res.body.id}`, query: {}, headers: auth });
  assert.equal(again.status, 204, 'already removed counts as removed');
  const unauth = await app.handle({ method: 'DELETE', path: '/triggers/card_created/unsubscribe/ws1', query: {}, headers: {} });
  assert.equal(unauth.status, 401);
});

test('no response ever uses the word "deal"', async () => {
  const { app } = setup();
  const texts = [JSON.stringify((await get(app, '/manifest.json')).body)];
  for (const id of Object.keys(ACTIONS)) texts.push(JSON.stringify((await get(app, `/actions/${id}/manifest.json`)).body), JSON.stringify((await get(app, `/actions/${id}/fields`, { boardId: 'bd1' })).body));
  for (const id of Object.keys(TRIGGERS)) texts.push(JSON.stringify((await get(app, `/triggers/${id}/manifest.json`)).body));
  assert.ok(!/\bdeals?\b|negócio/i.test(texts.join(' ')));
});
