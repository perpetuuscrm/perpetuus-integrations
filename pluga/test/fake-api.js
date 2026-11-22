'use strict';

/** In-memory stand-in for the Perpetuus API, enough for the offline contract tests. */
const BASE = 'https://api.test/api';
const GOOD = 'ppt_test_good';

function makeFakeApi() {
  const calls = [];
  const state = { subscriptions: new Map(), seq: 0 };
  const board = { documentId: 'bd1', name: 'Vendas' };
  const phases = [
    { documentId: 'ph0', name: 'Formulário', order: 0, fields: [
      { documentId: 'f1', slug: 'origem', label: 'Origem', type: 'select', required: true, options: [{ label: 'Site', value: 'site' }, { label: 'Indicação', value: 'indicacao' }] },
      { documentId: 'f2', slug: 'name', label: 'Nome', type: 'text', required: true },
    ] },
    { documentId: 'ph1', name: 'Qualificação', order: 1, fields: [
      { documentId: 'f3', slug: 'orcamento', label: 'Orçamento', type: 'currency', required: false },
      { documentId: 'f4', slug: 'aceite', label: 'Aceite', type: 'checkbox', required: false },
    ] },
  ];
  const card = (id, extra = {}) => ({
    documentId: id, title: 'Proposta Acme', value: '1500.50', board,
    currentPhase: { documentId: 'ph0', name: 'Formulário' }, currentPhaseEnteredAt: '2026-11-22T12:00:00.000Z',
    contact: { documentId: 'ct1', name: 'Maria', email: 'maria@acme.test', phone: '+5511999990000' },
    tags: [{ documentId: 'tg1', name: 'Quente' }], fields: { origem: 'site' },
    createdAt: '2026-11-22T12:00:00.000Z', updatedAt: '2026-11-22T12:00:00.000Z', ...extra,
  });
  const contact = { documentId: 'ct1', name: 'Maria', email: 'maria@acme.test', phone: '+5511999990000', contact_type: 'pessoa', createdAt: '2026-11-22T12:00:00.000Z', updatedAt: '2026-11-22T12:00:00.000Z' };

  const routes = [
    ['GET', /^\/auth\/token-info$/, () => [200, { data: { credential: { type: 'pat', scopes: ['crm:read', 'crm:write'] }, user: { email: 'demo@acme.test', username: 'demo' }, organization: { name: 'Acme Ltda', slug: 'acme' } } }]],
    ['GET', /^\/boards$/, () => [200, { data: [board], meta: { pagination: { page: 1, pageSize: 100, pageCount: 1, total: 1 } } }]],
    ['GET', /^\/boards\/bd1\/structure$/, () => [200, { data: { board, phases, tags: [{ documentId: 'tg1', name: 'Quente' }, { documentId: 'tg2', name: 'Frio' }] } }]],
    ['GET', /^\/boards\/bd1\/members$/, () => [200, { members: [{ documentId: 'mb1', user: { username: 'joao', email: 'joao@acme.test' } }] }]],
    ['GET', /^\/boards\/bd1\/cards$/, () => [200, { data: [card('cd1')], meta: { pagination: { page: 1, pageSize: 1, pageCount: 1, total: 1 } } }]],
    ['POST', /^\/boards\/bd1\/cards$/, (body) => [201, { data: card('cd2', { title: body.data.fields.name }) }]],
    ['PUT', /^\/boards\/bd1\/cards\/(cd\d)$/, () => [200, { data: {} }]],
    ['GET', /^\/boards\/bd1\/cards\/(cd\d)$/, (_b, [id]) => [200, { data: card(id) }]],
    ['GET', /^\/boards\/bd1\/cards\/missing$/, () => [404, { data: null, error: { status: 404, name: 'NotFoundError', message: 'Card not found' } }]],
    ['POST', /^\/contacts\/upsert$/, (body) => {
      if (body.data.email === contact.email) return [200, { data: { ...contact, ...body.data }, meta: { created: false, matchedBy: 'email' } }];
      if (!body.data.name) return [400, { data: null, error: { status: 400, name: 'ValidationError', message: 'name must be defined.' } }];
      return [200, { data: { ...contact, documentId: 'ct2', ...body.data }, meta: { created: true, matchedBy: null } }];
    }],
    ['GET', /^\/contacts$/, () => [200, { data: [contact], meta: { pagination: { page: 1, pageSize: 1, pageCount: 1, total: 1 } } }]],
    ['POST', /^\/tasks$/, (body) => [201, { data: { documentId: 'tk1', ...body.data, taskStatus: 'A fazer', createdAt: '2026-11-22T12:00:00.000Z' } }]],
    ['GET', /^\/webhook-subscriptions\/samples$/, () => [200, { data: [{ message: { id: 'm1', content: 'Oi', createdAt: '2026-11-22T12:00:00.000Z', sender: { id: 's1', name: 'Maria', type: 'contact' }, attachments: [{ id: 'a1', fileType: 'image', url: 'https://x.test/a.jpg' }] }, conversation: { id: 'c1', status: 'open', inboxId: 'i1' }, contact, card: card('cd1') }] }]],
    ['POST', /^\/webhook-subscriptions$/, (body) => {
      const id = `ws${++state.seq}`;
      state.subscriptions.set(id, { ...body });
      return [201, { data: { id, url: body.url, events: body.events, boardId: body.boardId ?? null, status: 'active', secret: 'whsec_testsecret' } }];
    }],
    ['PATCH', /^\/webhook-subscriptions\/(ws\d+)$/, (body, [id]) => {
      if (!state.subscriptions.has(id)) return [404, { error: { message: 'not found' } }];
      Object.assign(state.subscriptions.get(id), body);
      return [200, { data: { id } }];
    }],
    ['DELETE', /^\/webhook-subscriptions\/([^/]+)$/, (_b, [id]) => (state.subscriptions.delete(id) ? [200, { data: { id, deleted: true } }] : [404, { error: { message: 'Webhook subscription not found' } }])],
  ];

  async function fetch(url, init = {}) {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/api/, '');
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, query: u.search, body, auth: init.headers && init.headers.Authorization });
    if (!init.headers || init.headers.Authorization !== `Bearer ${GOOD}`) {
      return new Response(JSON.stringify({ data: null, error: { status: 401, message: 'Unauthorized' } }), { status: 401 });
    }
    for (const [m, re, fn] of routes) {
      const match = re.exec(path);
      if (m === method && match) {
        const [status, payload] = fn(body, match.slice(1));
        return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
      }
    }
    return new Response(JSON.stringify({ error: { message: `no fake route ${method} ${path}` } }), { status: 404 });
  }
  return { fetch, calls, state, BASE, GOOD };
}

module.exports = { makeFakeApi, BASE, GOOD };
