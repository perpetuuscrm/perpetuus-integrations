'use strict';

/** Offline: relay token, signature check, filters, delivery status mapping and target guard. */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const relay = require('../src/relay');
const { deliver, mapEvent } = require('../src/triggers');

const key = crypto.randomBytes(32);
const SECRET = 'whsec_unit';
const config = {
  relayKey: key,
  allowedTargetHosts: ['pluga.co'],
  relayTimeoutMs: 2000,
  lookup: async () => [{ address: '34.1.2.3', family: 4 }],
};

const card = { documentId: 'cd1', title: 'Proposta', board: { documentId: 'bd1', name: 'Vendas' }, currentPhase: { documentId: 'ph2', name: 'Proposta' }, currentPhaseEnteredAt: '2026-11-22T12:00:00.000Z', tags: [{ documentId: 't1', name: 'Quente' }, { documentId: 't2', name: 'Site' }], fields: { origem: 'site' }, createdAt: '2026-11-22T11:00:00.000Z' };

function signed(envelope, secret = SECRET, ts = Math.floor(Date.now() / 1000)) {
  const rawBody = JSON.stringify(envelope);
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex')}`;
  return { rawBody, headers: { 'x-perpetuus-signature': signature, 'x-perpetuus-timestamp': String(ts) } };
}

function recorder(status = 200) {
  const sent = [];
  const fetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body), redirect: init.redirect });
    return new Response('', { status });
  };
  return { sent, fetch };
}

const token = (extra = {}) => relay.seal(key, { u: 'https://webhook.pluga.co/h1', t: 'card_entered_phase', b: 'bd1', p: 'ph2', s: SECRET, ...extra });

test('token round-trips, is opaque and rejects tampering or another key', () => {
  const tk = token();
  assert.equal(relay.open(key, tk).u, 'https://webhook.pluga.co/h1');
  assert.ok(!Buffer.from(tk, 'base64url').toString('latin1').includes('pluga'));
  const flipped = tk.slice(0, 20) + (tk[20] === 'A' ? 'B' : 'A') + tk.slice(21);
  assert.equal(relay.open(key, flipped), null);
  assert.equal(relay.open(crypto.randomBytes(32), tk), null);
  assert.ok(`https://pluga.services.perpetuus.com.br/relay/${tk}`.length < 2048, 'fits the API url limit');
});

test('phase move into the watched phase is forwarded flat, with previous phase', async () => {
  const { sent, fetch } = recorder();
  const envelope = { id: 'evt_1', type: 'card.phase_changed', version: '1', timestamp: '2026-11-22T12:00:00.000Z', data: { ...card, fromPhase: { documentId: 'ph1', name: 'Lead' }, toPhase: { documentId: 'ph2', name: 'Proposta' } } };
  const res = await deliver({ token: token(), ...signed(envelope) }, config, fetch);
  assert.equal(res.status, 200);
  assert.equal(sent.length, 1);
  const body = sent[0].body;
  assert.equal(sent[0].redirect, 'manual');
  assert.equal(body.cardId, 'cd1');
  assert.equal(body.phaseId, 'ph2');
  assert.equal(body.previousPhaseName, 'Lead');
  assert.equal(body.tagNames, 'Quente, Site');
  assert.equal(body.fields.origem, 'site');
  assert.equal(body.webhookEventId, 'evt_1');
  assert.ok(body.eventId && !('id' in body));
});

test('card created directly in the watched phase also fires (card.created)', async () => {
  const { sent, fetch } = recorder();
  const envelope = { id: 'evt_2', type: 'card.created', timestamp: '2026-11-22T12:00:00.000Z', data: card };
  assert.equal((await deliver({ token: token(), ...signed(envelope) }, config, fetch)).status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.previousPhaseId, null);
});

test('other phase, other board, other event and ping are acknowledged without forwarding', async () => {
  const { sent, fetch } = recorder();
  const cases = [
    { id: 'e3', type: 'card.phase_changed', data: { ...card, toPhase: { documentId: 'ph9', name: 'Won' } } },
    { id: 'e4', type: 'card.created', data: { ...card, board: { documentId: 'bd9' } } },
    { id: 'e5', type: 'contact.created', data: { documentId: 'ct1' } },
    { id: 'e6', type: 'ping', data: {} },
  ];
  for (const envelope of cases) {
    const res = await deliver({ token: token(), ...signed(envelope) }, config, fetch);
    assert.equal(res.status, 200, envelope.id);
  }
  assert.equal(sent.length, 0);
});

test('bad signature, old timestamp, unknown token and missing secret are refused', async () => {
  const { sent, fetch } = recorder();
  const envelope = { id: 'e7', type: 'card.created', data: card };
  assert.equal((await deliver({ token: token(), ...signed(envelope, 'whsec_other') }, config, fetch)).status, 401);
  assert.equal((await deliver({ token: token(), ...signed(envelope, SECRET, Math.floor(Date.now() / 1000) - 3600) }, config, fetch)).status, 401);
  assert.equal((await deliver({ token: 'garbage', ...signed(envelope) }, config, fetch)).status, 404);
  assert.equal((await deliver({ token: token({ s: undefined }), ...signed(envelope) }, config, fetch)).status, 503, 'retryable while provisioning');
  assert.equal(sent.length, 0);
});

test('Pluga answers map to the API retry policy', async () => {
  const envelope = { id: 'e8', type: 'card.created', data: card };
  for (const [pluga, expected] of [[200, 200], [202, 200], [410, 410], [404, 400], [429, 502], [500, 502]]) {
    const { fetch } = recorder(pluga);
    assert.equal((await deliver({ token: token(), ...signed(envelope) }, config, fetch)).status, expected, `Pluga ${pluga}`);
  }
  const down = await deliver({ token: token(), ...signed(envelope) }, config, async () => { throw new Error('ECONNRESET'); });
  assert.equal(down.status, 502);
});

test('target guard: https, allowed host suffix, public IPs only', async () => {
  const ok = (url, ips = ['34.1.2.3']) => relay.assertTargetAllowed(url, ['pluga.co'], async () => ips.map((address) => ({ address, family: 4 })));
  assert.ok(await ok('https://webhook.pluga.co/x'));
  assert.ok(await ok('https://pluga.co/x'));
  for (const [url, ips] of [['http://webhook.pluga.co/x'], ['https://evilpluga.co/x'], ['https://pluga.co.evil.com/x'], ['https://webhook.pluga.co/x', ['10.0.0.5']], ['https://webhook.pluga.co/x', ['169.254.169.254']], ['https://webhook.pluga.co/x', ['198.18.0.1']], ['https://u:p@webhook.pluga.co/x'], ['not a url']]) {
    await assert.rejects(ok(url, ips), undefined, url);
  }
  assert.ok(relay.isPrivateAddress('::ffff:127.0.0.1'));
  assert.ok(!relay.isPrivateAddress('8.8.8.8'));
});

test('message received: attachments become URLs text, Board filter applies', () => {
  const envelope = { id: 'e9', type: 'message.received', data: { message: { id: 'm1', content: 'Oi', createdAt: '2026-11-22T12:00:00.000Z', attachments: [{ id: 'a', url: 'https://x/a.jpg' }, { id: 'b', url: 'https://x/b.pdf' }] }, card: { documentId: 'cd1', board: { documentId: 'bd1' } } } };
  const out = mapEvent('message_received', envelope, {});
  assert.equal(out.attachmentUrls, 'https://x/a.jpg, https://x/b.pdf');
  assert.equal(out.messageId, 'm1');
  assert.equal(mapEvent('message_received', envelope, { boardId: 'other' }), undefined);
});
