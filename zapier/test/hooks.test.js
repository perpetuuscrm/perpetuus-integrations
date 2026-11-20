'use strict';

const crypto = require('crypto');

const { App, appTester, api, makeBundle, setup, rawCard, page } = require('./helpers');
const { verifySignature, toWebhookResult, parseEnvelope } = require('../lib/webhooks');
const { pollCards } = require('../lib/polling');

setup();

const op = (key) => App.triggers[key].operation;
const run = (key, method, inputData, extra) => appTester(op(key)[method], makeBundle(inputData, extra));

const cardData = (overrides = {}) => ({
  documentId: 'card1',
  title: 'Maria - Website',
  description: null,
  value: 1500.5,
  dueDate: null,
  board: { documentId: 'b1', name: 'Sales' },
  currentPhase: { documentId: 'ph1', name: 'Lead' },
  currentPhaseEnteredAt: '2026-11-16T12:00:00.000Z',
  contact: { documentId: 'ct1', name: 'Maria', email: 'maria@example.com', phone: '+5511999990000' },
  assignees: [],
  tags: [{ documentId: 'tg1', name: 'Hot', color: null }],
  fields: { origem: 'Website' },
  creationSource: 'api',
  createdAt: '2026-11-16T12:00:00.000Z',
  updatedAt: '2026-11-16T12:00:00.000Z',
  ...overrides,
});
const delivery = (type, data) => ({ id: 'evt_1', type, version: '1', timestamp: '2026-11-16T12:00:01.000Z', tenant: {}, data });
const signedRaw = (body, secret = 'whsec_x', ts = Math.floor(Date.now() / 1000)) => ({
  content: JSON.stringify(body),
  headers: {
    'Http-X-Perpetuus-Timestamp': String(ts),
    'Http-X-Perpetuus-Signature': `sha256=${crypto.createHmac('sha256', secret).update(`${ts}.${JSON.stringify(body)}`).digest('hex')}`,
  },
});

describe('instant triggers: definitions', () => {
  it('adds hook triggers with new keys and hides the polling ones (existing Zaps keep them)', () => {
    for (const key of ['newCardInstant', 'cardEnteredPhaseInstant', 'newContactInstant', 'newMessage']) {
      expect(op(key).type).toBe('hook');
      expect(App.triggers[key].display.hidden).toBeUndefined();
    }
    for (const key of ['newCard', 'cardEnteredPhase', 'newContact']) {
      expect(op(key).type).toBe('polling');
      expect(App.triggers[key].display.hidden).toBe(true);
    }
    expect(op('taskCompleted').type).toBe('polling');
    expect(App.triggers.taskCompleted.display.hidden).toBeUndefined();
  });
});

describe('performSubscribe / performUnsubscribe', () => {
  it('subscribes the target URL with the trigger events, board and zapier origin', async () => {
    let body;
    const scope = api()
      .post('/api/webhook-subscriptions', (b) => {
        body = b;
        return true;
      })
      .reply(201, { data: { id: 'sub1', url: 'https://hooks.zapier.com/x', events: ['card.created', 'card.phase_changed'], boardId: 'b1', secret: 'whsec_x' } });
    const data = await run('cardEnteredPhaseInstant', 'performSubscribe', { boardId: 'b1', phaseId: 'ph2' }, {
      targetUrl: 'https://hooks.zapier.com/x',
      meta: { zap: { id: 42, name: 'Leads' } },
    });
    expect(body).toEqual({
      url: 'https://hooks.zapier.com/x',
      events: ['card.created', 'card.phase_changed'],
      boardId: 'b1',
      origin: 'zapier',
      description: 'Zapier: Leads (cardEnteredPhaseInstant)',
    });
    expect(data).toEqual({ id: 'sub1', secret: 'whsec_x', events: ['card.created', 'card.phase_changed'], boardId: 'b1' });
    scope.done();
  });

  it('unsubscribes by id; a subscription already gone counts as deleted', async () => {
    const scope = api().delete('/api/webhook-subscriptions/sub1').reply(404, { error: { message: 'Webhook subscription not found' } });
    const result = await run('newContactInstant', 'performUnsubscribe', {}, { subscribeData: { id: 'sub1' } });
    expect(result).toEqual({ id: 'sub1', deleted: true });
    scope.done();
  });

  it('a missing chat:read scope fails with the canonical message', async () => {
    api().post('/api/webhook-subscriptions').reply(403, { error: { message: 'API key lacks scope chat:read for these events' } });
    await expect(run('newMessage', 'performSubscribe', {}, { targetUrl: 'https://hooks.zapier.com/x' })).rejects.toThrow('Perpetuus denied access');
  });
});

describe('perform (delivery)', () => {
  it('returns the same result as the polling trigger, with webhookEventId', async () => {
    const body = delivery('card.created', cardData());
    const [result] = await run('newCardInstant', 'perform', { boardId: 'b1' }, {
      cleanedRequest: body,
      rawRequest: signedRaw(body),
      subscribeData: { id: 'sub1', secret: 'whsec_x' },
    });
    // The polling trigger fed with the same card (as GET /boards/{id}/cards returns it).
    const raw = rawCard({ fieldData: undefined, fields: { origem: 'Website' }, board: { documentId: 'b1' }, value: 1500.5 });
    const fakeClient = { z: null, request: async () => page([raw]) };
    const [polled] = await pollCards(fakeClient, { boardId: 'b1' }, 'newCard');
    expect(result).toEqual({ ...polled, webhookEventId: 'evt_1' });
    expect(result).toMatchObject({ id: 'card1', cardId: 'card1', eventId: 'card1' });
  });

  it('drops deliveries with a bad signature, pings and other phases', async () => {
    const body = delivery('card.phase_changed', cardData({ toPhase: { documentId: 'ph2', name: 'Won' }, fromPhase: { documentId: 'ph1', name: 'Lead' } }));
    const bad = await run('cardEnteredPhaseInstant', 'perform', { boardId: 'b1' }, {
      cleanedRequest: body,
      rawRequest: signedRaw(body, 'whsec_other'),
      subscribeData: { id: 'sub1', secret: 'whsec_x' },
    });
    expect(bad).toEqual([]);
    const ping = { id: 'evt_2', type: 'ping', data: { test: true } };
    expect(await run('newContactInstant', 'perform', {}, { cleanedRequest: ping, rawRequest: signedRaw(ping), subscribeData: { secret: 'whsec_x' } })).toEqual([]);
    const otherPhase = await run('cardEnteredPhaseInstant', 'perform', { boardId: 'b1', phaseId: 'ph9' }, { cleanedRequest: body });
    expect(otherPhase).toEqual([]);
    const [moved] = await run('cardEnteredPhaseInstant', 'perform', { boardId: 'b1', phaseId: 'ph2' }, { cleanedRequest: body });
    expect(moved).toMatchObject({ phaseId: 'ph2', phaseName: 'Won', previousPhaseId: 'ph1', id: 'card1:ph2:2026-11-16T12:00:00.000Z' });
  });
});

describe('performList', () => {
  it('uses real recent records when there are any', async () => {
    const scope = api().get(/\/api\/contacts/).reply(200, page([{ documentId: 'ct1', name: 'Maria', createdAt: '2026-11-16T12:00:00.000Z' }]));
    const results = await run('newContactInstant', 'performList', {});
    expect(results[0]).toMatchObject({ id: 'ct1', contactId: 'ct1' });
    scope.done();
  });

  it('falls back to /webhook-subscriptions/samples (always for New Message)', async () => {
    const scope = api()
      .get('/api/webhook-subscriptions/samples')
      .query({ event: 'message.received' })
      .reply(200, { data: [{ message: { id: 98765, content: 'Olá', createdAt: '2026-11-19T19:04:00.000Z' }, conversation: { id: 1234 }, contact: null, card: null }] });
    const [result] = await run('newMessage', 'performList', {});
    expect(result).toMatchObject({ id: '98765', messageId: '98765', content: 'Olá', conversationId: '1234' });
    scope.done();
  });
});

describe('verifySignature', () => {
  it('accepts Http- prefixed headers and rejects stale timestamps', () => {
    const body = { id: 'evt_1', type: 'ping' };
    const raw = signedRaw(body, 'whsec_x', 1_800_000_000);
    expect(verifySignature('whsec_x', raw.headers, raw.content, 1_800_000_010)).toEqual({ ok: true });
    expect(verifySignature('whsec_x', raw.headers, raw.content, 1_800_000_400).ok).toBe(false);
  });

  it('New Contact maps contact_type like the polling trigger', () => {
    const result = toWebhookResult('newContact', parseEnvelope(delivery('contact.created', { documentId: 'ct1', contact_type: 'empresa', createdAt: 'x' })));
    expect(result).toMatchObject({ id: 'ct1', contactId: 'ct1', contactType: 'company', eventAt: 'x' });
  });
});
