'use strict';

const { App, appTester, api, makeBundle, route, expectError, setup, rawCard, rawTask } = require('./helpers');

setup();

const perform = (key, inputData) =>
  appTester(App.creates[key].operation.perform, makeBundle(inputData));

const CARD_GET = route('/api/boards/b1/cards/card1', []);

describe('Create or Update Contact', () => {
  it('maps the canonical fields to the upsert body and returns created/matchedBy', async () => {
    let body;
    const scope = api()
      .post('/api/contacts/upsert', (sent) => {
        body = sent;
        return true;
      })
      .reply(200, {
        data: { documentId: 'ct1', name: 'Maria', email: 'maria@example.com', contact_type: 'pessoa' },
        meta: { created: false, matchedBy: 'email', otherMatches: [{ documentId: 'ct9' }] },
      });
    const result = await perform('upsertContact', {
      email: ' maria@example.com ',
      phone: '',
      name: 'Maria',
      matchBy: ['email'],
      contactType: 'person',
      postalCode: '01000-000',
      city: '',
      customFields: { origem: 'Website', vazio: '' },
    });
    expect(body).toEqual({
      data: {
        name: 'Maria',
        email: 'maria@example.com',
        contact_type: 'pessoa',
        postal_code: '01000-000',
        customFields: { origem: 'Website' },
      },
      matchBy: ['email'],
    });
    expect(result).toMatchObject({
      id: 'ct1',
      contactType: 'person',
      created: false,
      matchedBy: 'email',
      otherMatchIds: ['ct9'],
    });
    scope.done();
  });

  it('requires an email or a phone before calling the API', async () => {
    const { message, code } = await expectError(() => perform('upsertContact', { name: 'Maria' }));
    expect(message).toBe('Provide an email or a phone to find or create the contact.');
    expect(code).toBe('InvalidInput');
  });

  it('reports the plan contact limit (402)', async () => {
    api()
      .post('/api/contacts/upsert')
      .reply(402, { data: null, error: { status: 402, message: 'Limite de 500 contatos' } });
    const { message } = await expectError(() => perform('upsertContact', { phone: '11999990000' }));
    expect(message).toBe('Your Perpetuus plan contact limit was reached: Limite de 500 contatos');
  });
});

describe('Create Card', () => {
  it('creates the card with title, custom fields and relations, then reads it back', async () => {
    let body;
    const scope = api()
      .post('/api/boards/b1/cards', (sent) => {
        body = sent;
        return true;
      })
      .reply(201, { data: { documentId: 'card1', currentPhase: { documentId: 'ph1' } } })
      .get(CARD_GET)
      .reply(200, { data: rawCard() });
    const result = await perform('createCard', {
      boardId: 'b1',
      title: 'Maria - Website',
      phaseId: 'ph1',
      contactId: 'ct1',
      tagIds: ['tg1', ''],
      value: '1500.50',
      dueDate: '2026-11-30T18:00:00-03:00',
      description: '',
      assigneeIds: [],
      fields: { extra: 'x', empty: '' },
      fields__origem: 'Website',
      fields__interesses: ['a', ''],
    });
    expect(body).toEqual({
      data: {
        fields: { extra: 'x', origem: 'Website', interesses: ['a'], name: 'Maria - Website' },
        contact: 'ct1',
        tags: ['tg1'],
        value: 1500.5,
        dueDate: '2026-11-30T18:00:00-03:00',
      },
    });
    expect(result).toMatchObject({ id: 'card1', boardId: 'b1', phaseId: 'ph1', title: 'Maria - Website' });
    expect(result.warning).toBeUndefined();
    scope.done();
  });

  it('moves the card when another phase is chosen', async () => {
    let moveBody;
    const scope = api()
      .post('/api/boards/b1/cards')
      .reply(201, { data: { documentId: 'card1', currentPhase: { documentId: 'ph1' } } })
      .put('/api/boards/b1/cards/card1', (sent) => {
        moveBody = sent;
        return true;
      })
      .reply(200, { data: {} })
      .get(CARD_GET)
      .reply(200, { data: rawCard({ currentPhase: { documentId: 'ph3', name: 'Proposal' } }) });
    const result = await perform('createCard', { boardId: 'b1', title: 'T', phaseId: 'ph3' });
    expect(moveBody).toEqual({ data: { currentPhase: 'ph3' } });
    expect(result.phaseId).toBe('ph3');
    scope.done();
  });

  it('returns the created card with a warning when the move fails', async () => {
    const scope = api()
      .post('/api/boards/b1/cards')
      .reply(201, { data: { documentId: 'card1', currentPhase: { documentId: 'ph1' } } })
      .put('/api/boards/b1/cards/card1')
      .reply(400, { data: null, error: { status: 400, message: 'Campo obrigatório: cpf' } })
      .get(CARD_GET)
      .reply(200, { data: rawCard() });
    const result = await perform('createCard', { boardId: 'b1', title: 'T', phaseId: 'ph3' });
    expect(result.id).toBe('card1');
    expect(result.warning).toBe(
      'Card created in the initial phase, but moving it to phase ph3 failed: Perpetuus rejected the request: Campo obrigatório: cpf',
    );
    scope.done();
  });

  it('builds dynamic inputs from the custom fields of the board', async () => {
    api()
      .get('/api/boards/b1/structure?include=phases%2Cfields')
      .reply(200, {
        data: {
          phases: [
            {
              documentId: 'ph0',
              name: 'Form',
              order: 0,
              fields: [
                { slug: 'name', label: 'Name', type: 'text', required: true },
                { slug: 'origem', label: 'Origin', type: 'select', required: true, options: ['Site', 'Ads'] },
                { slug: 'aviso', label: 'Notice', type: 'statement' },
                { slug: 'valor', label: 'Amount', type: 'currency', required: false },
              ],
            },
            {
              documentId: 'ph1',
              name: 'Proposal',
              order: 1,
              fields: [
                { slug: 'aceite', label: 'Accepted', type: 'switch', required: true },
                { slug: 'tags_extra', label: 'Extra', type: 'multiselect', options: [{ label: 'A', value: 'a' }] },
              ],
            },
          ],
        },
      });
    const dynamicFields = App.creates.createCard.operation.inputFields.find(
      (field) => typeof field === 'function',
    );
    const fields = await appTester(dynamicFields, makeBundle({ boardId: 'b1' }));
    expect(fields.map((f) => f.key)).toEqual([
      'fields__origem',
      'fields__valor',
      'fields__aceite',
      'fields__tags_extra',
    ]);
    expect(fields[0]).toMatchObject({
      label: 'Origin',
      required: true,
      type: 'string',
      choices: [
        { value: 'Site', label: 'Site', sample: 'Site' },
        { value: 'Ads', label: 'Ads', sample: 'Ads' },
      ],
    });
    expect(fields[1]).toMatchObject({ type: 'number', required: false });
    expect(fields[2]).toMatchObject({ type: 'boolean', required: false });
    expect(fields[3]).toMatchObject({ list: true, choices: [{ value: 'a', label: 'A', sample: 'a' }] });
    expect(await appTester(dynamicFields, makeBundle({}))).toEqual([]);
  });

  it('requires the board and the title', async () => {
    const { message } = await expectError(() => perform('createCard', { boardId: 'b1', title: ' ' }));
    expect(message).toBe('The card title is required.');
  });
});

describe('Move Card to Phase', () => {
  it('sends the phase and the reason, then reads the card', async () => {
    let body;
    const scope = api()
      .put('/api/boards/b1/cards/card1', (sent) => {
        body = sent;
        return true;
      })
      .reply(200, { data: {} })
      .get(CARD_GET)
      .reply(200, { data: rawCard() });
    const result = await perform('moveCard', {
      boardId: 'b1',
      cardId: 'card1',
      phaseId: 'ph2',
      reason: 'Signed',
    });
    expect(body).toEqual({ data: { currentPhase: 'ph2', reason: 'Signed' } });
    expect(result.id).toBe('card1');
    scope.done();
  });
});

describe('Add Tags to Card', () => {
  it('merges the new tags with the current ones', async () => {
    let body;
    const scope = api()
      .get(route('/api/boards/b1/cards/card1', []))
      .reply(200, { data: { documentId: 'card1', tags: [{ documentId: 'tg1' }] } })
      .put('/api/boards/b1/cards/card1', (sent) => {
        body = sent;
        return true;
      })
      .reply(200, { data: {} })
      .get(CARD_GET)
      .reply(200, { data: rawCard() });
    await perform('addCardTags', { boardId: 'b1', cardId: 'card1', tagIds: ['tg1', 'tg2'] });
    expect(body).toEqual({ data: { tags: ['tg1', 'tg2'] } });
    scope.done();
  });

  it('skips the update when the card already has every tag', async () => {
    const scope = api()
      .get(route('/api/boards/b1/cards/card1', []))
      .reply(200, { data: { documentId: 'card1', tags: [{ documentId: 'tg1' }] } })
      .get(CARD_GET)
      .reply(200, { data: rawCard() });
    await perform('addCardTags', { boardId: 'b1', cardId: 'card1', tagIds: 'tg1' });
    scope.done();
  });
});

describe('Create Task', () => {
  it('sends the card (not the board) and fills cardId from the input', async () => {
    let body;
    const scope = api()
      .post('/api/tasks', (sent) => {
        body = sent;
        return true;
      })
      .reply(201, { data: rawTask({ card: undefined, completedAt: null }) });
    const result = await perform('createTask', {
      name: 'Call back',
      boardId: 'b1',
      cardId: 'card1',
      type: 'follow-up',
      priority: 'high',
      status: '',
      assigneeIds: ['mb1'],
    });
    expect(body).toEqual({
      data: { name: 'Call back', card: 'card1', type: 'follow-up', priority: 'high', assignees: ['mb1'] },
    });
    expect(result).toMatchObject({ id: 'tk1', cardId: 'card1', completedAt: null });
    scope.done();
  });

  it('requires a board or a card', async () => {
    const { message } = await expectError(() => perform('createTask', { name: 'X' }));
    expect(message).toBe('Choose a board or a card for the task.');
  });
});
