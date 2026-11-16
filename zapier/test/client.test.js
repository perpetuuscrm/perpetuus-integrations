'use strict';

const zapier = require('zapier-platform-core');
const { App, appTester, api, makeBundle, route, expectError, setup, rawContact, page, timing } = require('./helpers');
const { buildQueryString } = require('../lib/query');
const { toCard, toUpsertedContact, phoneSearchDigits } = require('../lib/mappers');
const { afters } = require('../lib/middleware');

setup();

const poll = () => appTester(App.triggers.newContact.operation.perform, makeBundle());

describe('retry policy (docs/v1-contract.md §3.2)', () => {
  it('waits a short Retry-After inline and retries', async () => {
    const scope = api()
      .get(route('/api/contacts', []))
      .reply(429, {}, { 'Retry-After': '2' })
      .get(route('/api/contacts', []))
      .reply(200, page([rawContact()]));
    const results = await poll();
    expect(results).toHaveLength(1);
    expect(timing.sleep).toHaveBeenCalledWith(2250);
    scope.done();
  });

  it('gives up after 2 inline retries with a ThrottledError', async () => {
    const scope = api()
      .get(route('/api/contacts', []))
      .times(3)
      .reply(429, {}, { 'Retry-After': '1' });
    const { error, delay } = await expectError(poll);
    expect(error.name).toBe('ThrottledError');
    expect(delay).toBe(1);
    expect(timing.sleep).toHaveBeenCalledTimes(2);
    scope.done();
  });

  it('does not wait inline for a long Retry-After', async () => {
    api().get(route('/api/contacts', [])).reply(429, {}, { 'Retry-After': '45' });
    const { error, delay, message } = await expectError(poll);
    expect(error.name).toBe('ThrottledError');
    expect(delay).toBe(45);
    expect(message).toMatch(/Try again in 45 seconds/);
    expect(timing.sleep).not.toHaveBeenCalled();
  });

  it('reads the delay from error.details.retryAfter when the header is missing', async () => {
    api()
      .get(route('/api/contacts', []))
      .reply(429, { data: null, error: { status: 429, message: 'x', details: { retryAfter: 30 } } });
    const { delay } = await expectError(poll);
    expect(delay).toBe(30);
  });

  it('retries a GET once on 5xx', async () => {
    const scope = api()
      .get(route('/api/contacts', []))
      .reply(502, 'Bad Gateway')
      .get(route('/api/contacts', []))
      .reply(200, page([rawContact()]));
    await poll();
    expect(timing.sleep).toHaveBeenCalledWith(1000);
    scope.done();
  });

  it('fails a GET after the second 5xx with the server error message', async () => {
    api().get(route('/api/contacts', [])).times(2).reply(503, '');
    const { message, code, status } = await expectError(poll);
    expect(message).toBe('Perpetuus server error (HTTP 503). Try again later.');
    expect(code).toBe('ServerError');
    expect(status).toBe(503);
  });

  it('never retries a POST on 5xx (no idempotency key)', async () => {
    const scope = api().post('/api/contacts/upsert').reply(500, {});
    const { status } = await expectError(() =>
      appTester(App.creates.upsertContact.operation.perform, makeBundle({ email: 'a@b.com' })),
    );
    expect(status).toBe(500);
    expect(timing.sleep).not.toHaveBeenCalled();
    scope.done();
  });

  it('keeps 400 details and 404 messages', async () => {
    api()
      .post('/api/contacts/upsert')
      .reply(400, {
        data: null,
        error: { status: 400, message: 'CPF inválido', details: { field: 'cpf' } },
      });
    const bad = await expectError(() =>
      appTester(App.creates.upsertContact.operation.perform, makeBundle({ email: 'a@b.com' })),
    );
    expect(bad.message).toBe('Perpetuus rejected the request: CPF inválido Details: {"field":"cpf"}');

    api().get('/api/boards/nope/structure?include=phases').reply(404, {
      data: null,
      error: { status: 404, message: 'Board not found' },
    });
    const missing = await expectError(() =>
      appTester(App.triggers.phaseList.operation.perform, makeBundle({ boardId: 'nope' })),
    );
    expect(missing.message).toBe('Not found in Perpetuus: Board not found');
    expect(missing.status).toBe(404);
  });
});

describe('afterResponse middleware', () => {
  const [handleErrors] = afters;
  const z = { errors: zapier.errors };
  const headers = new Map([['retry-after', '7']]);

  it('passes 2xx and responses that asked to skip the status check', () => {
    const ok = { status: 200 };
    expect(handleErrors(ok, z)).toBe(ok);
    const skipped = { status: 500, skipThrowForStatus: true };
    expect(handleErrors(skipped, z)).toBe(skipped);
  });

  it('throws the canonical errors for 401 and 429', () => {
    expect(() => handleErrors({ status: 401, data: {}, headers: new Map() }, z)).toThrow(
      /Invalid or expired Perpetuus API key/,
    );
    try {
      handleErrors({ status: 429, data: {}, headers }, z);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error.name).toBe('ThrottledError');
      expect(JSON.parse(error.message).delay).toBe(7);
    }
  });
});

describe('helpers', () => {
  it('serializes Strapi filters with brackets and skips empty values', () => {
    const qs = buildQueryString({
      filters: { createdAt: { $gte: '2026-11-16T12:00:00.000Z' }, email: undefined },
      populate: { fieldData: { populate: ['field'] } },
      quickSearch: '',
    });
    expect(decodeURIComponent(qs)).toBe(
      'filters[createdAt][$gte]=2026-11-16T12:00:00.000Z&populate[fieldData][populate][0]=field',
    );
  });

  it('flattens a card and builds fields from fieldData', () => {
    const card = toCard({
      documentId: 'c1',
      title: 'T',
      value: '10.5',
      board: { documentId: 'b1' },
      fieldData: [{ field: { slug: 'origem' }, value: { val: 'Site' } }],
    });
    expect(card).toMatchObject({
      id: 'c1',
      boardId: 'b1',
      value: 10.5,
      phaseId: null,
      tagIds: [],
      fields: { origem: 'Site' },
    });
  });

  it('maps the upsert meta', () => {
    const contact = toUpsertedContact({
      data: { documentId: 'ct1', name: 'A', contact_type: 'empresa' },
      meta: { created: false, matchedBy: 'phone', otherMatches: [{ documentId: 'ct2' }] },
    });
    expect(contact).toMatchObject({
      id: 'ct1',
      contactType: 'company',
      created: false,
      matchedBy: 'phone',
      otherMatchIds: ['ct2'],
    });
  });

  it('strips the 55 country code from phone searches', () => {
    expect(phoneSearchDigits('+55 (11) 99999-0000')).toBe('11999990000');
    expect(phoneSearchDigits('11 99999-0000')).toBe('11999990000');
  });
});
