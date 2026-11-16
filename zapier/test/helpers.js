'use strict';

const nock = require('nock');
const zapier = require('zapier-platform-core');

const App = require('../index');
const { timing } = require('../lib/client');

// skipHttpPatch only in tests: the core wraps http(s).request once per process, and Jest
// reuses the process across test files, so a later file would bypass its own nock instance.
const appTester = zapier.createAppTester({
  ...App,
  flags: { ...App.flags, skipHttpPatch: true },
});
const ORIGIN = 'https://api.perpetuus.com.br';
const API_KEY = 'ppt_test_key';

/** nock scope for the production API that requires the Bearer header. */
const api = (origin = ORIGIN) =>
  nock(origin, { reqheaders: { authorization: `Bearer ${API_KEY}` } });

const makeBundle = (inputData = {}, extra = {}) => ({
  authData: { apiKey: API_KEY },
  inputData,
  ...extra,
});

/**
 * Path matcher that records the decoded request path (with query string) of each call, so
 * tests can assert on the Strapi filters: `api().get(route('/api/contacts', calls))`.
 */
const route = (path, calls) => (uri) => {
  const [pathname, search] = uri.split('?');
  if (pathname !== path) return false;
  // nock may also probe the matcher with the bare path; only record full request paths.
  if (search !== undefined) calls.push(decodeURIComponent(uri));
  return true;
};

/** Parses the JSON message of z.errors.Error / ThrottledError. */
const parseError = (error) => {
  try {
    return JSON.parse(error.message);
  } catch {
    return { message: error.message };
  }
};

/** Runs `fn` and returns the parsed error it throws (fails when nothing is thrown). */
const expectError = async (fn) => {
  let caught;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  if (!caught) throw new Error('Expected an error to be thrown');
  return { error: caught, ...parseError(caught) };
};

/** Shared setup: no real network, no real sleeping. */
const setup = () => {
  beforeAll(() => nock.disableNetConnect());
  afterAll(() => nock.enableNetConnect());
  beforeEach(() => {
    jest.spyOn(timing, 'sleep').mockResolvedValue(undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    nock.cleanAll();
  });
};

// ─── Raw API fixtures ─────────────────────────────────────────────────────────

const rawCard = (overrides = {}) => ({
  documentId: 'card1',
  title: 'Maria - Website',
  value: '1500.50',
  dueDate: null,
  description: null,
  currentPhaseEnteredAt: '2026-11-16T12:00:00.000Z',
  createdAt: '2026-11-16T12:00:00.000Z',
  updatedAt: '2026-11-16T12:00:00.000Z',
  currentPhase: { documentId: 'ph1', name: 'Lead' },
  contact: { documentId: 'ct1', name: 'Maria', email: 'maria@example.com', phone: '+5511999990000' },
  tags: [{ documentId: 'tg1', name: 'Hot' }],
  fieldData: [{ field: { slug: 'origem' }, value: { val: 'Website' } }],
  ...overrides,
});

const rawContact = (overrides = {}) => ({
  documentId: 'ct1',
  name: 'Maria',
  email: 'maria@example.com',
  phone: '+5511999990000',
  contact_type: 'pessoa',
  postal_code: '01000-000',
  customFields: { origem: 'Website' },
  createdAt: '2026-11-16T12:00:00.000Z',
  updatedAt: '2026-11-16T12:00:00.000Z',
  ...overrides,
});

const rawTask = (overrides = {}) => ({
  documentId: 'tk1',
  name: 'Call back',
  type: 'follow-up',
  priority: 'medium',
  taskStatus: 'Done',
  completedAt: '2026-11-16T12:00:00.000Z',
  createdAt: '2026-11-16T11:00:00.000Z',
  updatedAt: '2026-11-16T12:00:00.000Z',
  card: { documentId: 'card1', title: 'Maria - Website' },
  assignees: [{ documentId: 'mb1' }],
  ...overrides,
});

const page = (data, pageCount = 1) => ({
  data,
  meta: { pagination: { page: 1, pageSize: data.length, pageCount, total: data.length } },
});

module.exports = {
  App,
  appTester,
  api,
  makeBundle,
  route,
  expectError,
  setup,
  rawCard,
  rawContact,
  rawTask,
  page,
  ORIGIN,
  API_KEY,
  timing,
};
