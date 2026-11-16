'use strict';

const nock = require('nock');
const { App, appTester, api, makeBundle, expectError, setup, ORIGIN } = require('./helpers');

setup();

const tokenInfo = {
  data: {
    credential: { type: 'pat', id: 'k1', name: 'Zapier', scopes: ['crm:read', 'crm:write'] },
    user: { documentId: 'us1', email: 'voce@empresa.com', username: 'voce' },
    organization: { documentId: 'or1', slug: 'acme', name: 'Acme Ltda' },
  },
};

describe('authentication', () => {
  it('tests the key on /auth/token-info and builds the connection label', async () => {
    const scope = api().get('/api/auth/token-info').reply(200, tokenInfo);
    const result = await appTester(App.authentication.test, makeBundle());
    expect(result.organization.name).toBe('Acme Ltda');
    expect(result.user.email).toBe('voce@empresa.com');

    const label = await appTester(App.authentication.connectionLabel, {
      authData: {},
      inputData: result,
    });
    expect(label).toBe('Acme Ltda (voce@empresa.com)');
    scope.done();
  });

  it('uses a custom HTTPS base URL without the trailing slash', async () => {
    const scope = nock('https://staging.perpetuus.com.br', {
      reqheaders: { authorization: 'Bearer ppt_test_key' },
    })
      .get('/api/auth/token-info')
      .reply(200, tokenInfo);
    const bundle = makeBundle();
    bundle.authData.baseUrl = 'https://staging.perpetuus.com.br/api/';
    await appTester(App.authentication.test, bundle);
    scope.done();
  });

  it('rejects a base URL that is not HTTPS', async () => {
    const bundle = makeBundle();
    bundle.authData.baseUrl = 'http://api.perpetuus.com.br/api';
    const { message, code } = await expectError(() => appTester(App.authentication.test, bundle));
    expect(code).toBe('InvalidBaseUrl');
    expect(message).toMatch(/must be an HTTPS address/);
  });

  it('turns 401 into the invalid key message', async () => {
    api()
      .get('/api/auth/token-info')
      .reply(401, { data: null, error: { status: 401, name: 'UnauthorizedError', message: 'Invalid token' } });
    const { message, code, status } = await expectError(() =>
      appTester(App.authentication.test, makeBundle()),
    );
    expect(message).toBe(
      'Invalid or expired Perpetuus API key. Create a new key in Settings → API Tokens e MCP and update the credential.',
    );
    expect(code).toBe('AuthenticationError');
    expect(status).toBe(401);
  });

  it('turns 403 without a scope into the missing scope message', async () => {
    api()
      .get('/api/auth/token-info')
      .reply(403, { data: null, error: { status: 403, message: 'PAT sem escopo crm:read' } });
    const { message, code } = await expectError(() =>
      appTester(App.authentication.test, makeBundle()),
    );
    expect(code).toBe('MissingScope');
    expect(message).toBe(
      'The Perpetuus API key is missing the "crm:read" scope. Create a key with the crm:write scope (it includes crm:read).',
    );
  });

  it('turns other 403 responses into the access denied message', async () => {
    api()
      .get('/api/auth/token-info')
      .reply(403, { data: null, error: { status: 403, message: 'Board sem acesso' } });
    const { message, code } = await expectError(() =>
      appTester(App.authentication.test, makeBundle()),
    );
    expect(code).toBe('Forbidden');
    expect(message).toBe('Perpetuus denied access: Board sem acesso');
  });

  it('turns a long 429 into a ThrottledError with Retry-After', async () => {
    api()
      .get('/api/auth/token-info')
      .reply(429, { data: null, error: { status: 429, message: 'Too many requests' } }, { 'Retry-After': '42' });
    const { error, message, delay } = await expectError(() =>
      appTester(App.authentication.test, makeBundle()),
    );
    expect(error.name).toBe('ThrottledError');
    expect(delay).toBe(42);
    expect(message).toBe(
      'Perpetuus rate limit reached (120 requests/min per key). Try again in 42 seconds.',
    );
  });

  it('declares the API key as a password and the base URL as optional', () => {
    expect(App.authentication.fields.map((field) => field.key)).toEqual(['apiKey', 'baseUrl']);
    expect(App.authentication.fields[0].type).toBe('password');
    expect(App.authentication.fields[1].required).toBe(false);
    expect(App.authentication.fields[1].default).toBe(`${ORIGIN}/api`);
  });
});
