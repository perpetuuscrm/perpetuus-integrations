'use strict';

const { App, appTester, api, makeBundle, route, expectError, setup, rawCard, rawContact, rawTask, page } = require('./helpers');

setup();

const perform = (key, inputData, extra) =>
  appTester(App.triggers[key].operation.perform, makeBundle(inputData, extra));

describe('New Card', () => {
  it('reads the newest 100 cards and returns them newest first with id = cardId', async () => {
    const calls = [];
    const scope = api()
      .get(route('/api/boards/b1/cards', calls))
      .reply(
        200,
        page([
          rawCard({ documentId: 'old', createdAt: '2026-11-16T10:00:00.000Z' }),
          rawCard({ documentId: 'new', createdAt: '2026-11-16T12:00:00.000Z' }),
        ]),
      );
    const results = await perform('newCard', { boardId: 'b1' });
    expect(calls[0]).toContain('sort=createdAt:desc');
    expect(calls[0]).toContain('pagination[pageSize]=100');
    expect(calls[0]).toContain('stats=false');
    expect(calls[0]).toContain('populate[fieldData][populate][0]=field');
    expect(calls[0]).not.toContain('$gte');
    expect(results.map((r) => r.id)).toEqual(['new', 'old']);
    expect(results[0]).toMatchObject({
      id: 'new',
      cardId: 'new',
      eventId: 'new',
      eventAt: '2026-11-16T12:00:00.000Z',
      boardId: 'b1',
      phaseId: 'ph1',
      phaseName: 'Lead',
      contactId: 'ct1',
      contactEmail: 'maria@example.com',
      value: 1500.5,
      tagIds: ['tg1'],
      tagNames: ['Hot'],
      fields: { origem: 'Website' },
    });
    scope.done();
  });

  it('requires a board', async () => {
    const { message } = await expectError(() => perform('newCard', {}));
    expect(message).toBe('Choose the board to watch.');
  });
});

describe('Card Entered Phase', () => {
  it('filters by phase and uses cardId:phaseId:enteredAt as id', async () => {
    const calls = [];
    const scope = api()
      .get(route('/api/boards/b1/cards', calls))
      .reply(
        200,
        page([
          rawCard({ documentId: 'c1', currentPhaseEnteredAt: '2026-11-16T13:00:00.000Z' }),
          rawCard({ documentId: 'c2', currentPhaseEnteredAt: null }),
        ]),
      );
    const results = await perform('cardEnteredPhase', { boardId: 'b1', phaseId: 'ph1' });
    expect(calls[0]).toContain('filters[currentPhaseEnteredAt][$notNull]=true');
    expect(calls[0]).toContain('filters[currentPhase][documentId][$eq]=ph1');
    expect(calls[0]).toContain('sort=currentPhaseEnteredAt:desc');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: 'c1:ph1:2026-11-16T13:00:00.000Z',
      eventId: 'c1:ph1:2026-11-16T13:00:00.000Z',
      cardId: 'c1',
      eventAt: '2026-11-16T13:00:00.000Z',
    });
    scope.done();
  });

  it('gives a new id when the same card re-enters the phase later', async () => {
    api()
      .get(route('/api/boards/b1/cards', []))
      .reply(200, page([rawCard({ currentPhaseEnteredAt: '2026-11-16T13:00:00.000Z' })]))
      .get(route('/api/boards/b1/cards', []))
      .reply(200, page([rawCard({ currentPhaseEnteredAt: '2026-11-17T09:00:00.000Z' })]));
    const first = await perform('cardEnteredPhase', { boardId: 'b1' });
    const second = await perform('cardEnteredPhase', { boardId: 'b1' });
    expect(first[0].id).not.toBe(second[0].id);
    expect(first[0].cardId).toBe(second[0].cardId);
  });

  it('watches any phase when the phase is empty', async () => {
    const calls = [];
    api().get(route('/api/boards/b1/cards', calls)).reply(200, page([]));
    expect(await perform('cardEnteredPhase', { boardId: 'b1', phaseId: '' })).toEqual([]);
    expect(calls[0]).not.toContain('filters[currentPhase]');
  });
});

describe('New Contact', () => {
  it('reads the newest contacts with id = contactId', async () => {
    const calls = [];
    const scope = api()
      .get(route('/api/contacts', calls))
      .reply(200, page([rawContact()]));
    const results = await perform('newContact', {});
    expect(calls[0]).toContain('sort=createdAt:desc');
    expect(calls[0]).toContain('pagination[pageSize]=100');
    expect(results[0]).toMatchObject({
      id: 'ct1',
      contactId: 'ct1',
      eventId: 'ct1',
      eventAt: '2026-11-16T12:00:00.000Z',
      contactType: 'person',
      postalCode: '01000-000',
      customFields: { origem: 'Website' },
      cpf: null,
    });
    scope.done();
  });
});

describe('Task Completed', () => {
  it('reads the plain array of /tasks with limit/offset and id = taskId:completedAt', async () => {
    const calls = [];
    const scope = api()
      .get(route('/api/tasks', calls))
      .reply(200, [
        rawTask({ documentId: 'tk1', completedAt: '2026-11-16T10:00:00.000Z' }),
        rawTask({ documentId: 'tk2', completedAt: '2026-11-16T12:00:00.000Z' }),
      ]);
    const results = await perform('taskCompleted', { boardId: 'b1' });
    expect(calls[0]).toContain('filters[completedAt][$notNull]=true');
    expect(calls[0]).toContain('filters[board][documentId]=b1');
    expect(calls[0]).toContain('sort=completedAt:desc');
    expect(calls[0]).toContain('limit=100');
    expect(calls[0]).toContain('offset=0');
    expect(results.map((r) => r.id)).toEqual([
      'tk2:2026-11-16T12:00:00.000Z',
      'tk1:2026-11-16T10:00:00.000Z',
    ]);
    expect(results[0]).toMatchObject({
      taskId: 'tk2',
      cardId: 'card1',
      cardTitle: 'Maria - Website',
      status: 'Done',
      assigneeIds: ['mb1'],
    });
    scope.done();
  });

  it('includes every board when the board is empty', async () => {
    const calls = [];
    api().get(route('/api/tasks', calls)).reply(200, []);
    await perform('taskCompleted', {});
    expect(calls[0]).not.toContain('filters[board]');
  });
});

describe('hidden dropdown triggers', () => {
  it('lists boards by name with Zapier paging', async () => {
    const calls = [];
    api()
      .get(route('/api/boards', calls))
      .reply(200, page([{ documentId: 'b1', name: 'Sales' }]));
    const results = await perform('boardList', {}, { meta: { page: 1 } });
    expect(calls[0]).toContain('sort=name:asc');
    expect(calls[0]).toContain('pagination[page]=2');
    expect(results).toEqual([{ id: 'b1', name: 'Sales' }]);
  });

  it('lists the phases of the board in order and marks the form phase', async () => {
    api()
      .get('/api/boards/b1/structure?include=phases')
      .reply(200, {
        data: {
          phases: [
            { documentId: 'ph2', name: 'Won', order: 2 },
            { documentId: 'ph0', name: 'Form', order: 0 },
            { documentId: 'ph1', name: 'Lead', order: 1 },
          ],
        },
      });
    const results = await perform('phaseList', { boardId: 'b1' });
    expect(results.map((r) => r.name)).toEqual(['Form (form)', 'Lead', 'Won']);
    expect(results[0].id).toBe('ph0');
  });

  it('returns no phases, tags, members or cards before a board is chosen', async () => {
    for (const key of ['phaseList', 'tagList', 'memberList', 'cardList']) {
      expect(await perform(key, {})).toEqual([]);
      expect(await perform(key, { boardId: '{{123__boardId}}' })).toEqual([]);
    }
  });

  it('lists tags and members of the board', async () => {
    api()
      .get('/api/boards/b1/structure?include=tags')
      .reply(200, { tags: [{ documentId: 'tg1', name: 'Hot' }] })
      .get('/api/boards/b1/members')
      .reply(200, {
        members: [
          { documentId: 'mb1', user: { username: 'joao', email: 'joao@example.com' } },
          { documentId: 'mb2', displayName: 'Ana' },
        ],
      });
    expect(await perform('tagList', { boardId: 'b1' })).toEqual([{ id: 'tg1', name: 'Hot' }]);
    expect(await perform('memberList', { boardId: 'b1' })).toEqual([
      { id: 'mb1', name: 'joao', email: 'joao@example.com' },
      { id: 'mb2', name: 'Ana', email: null },
    ]);
  });

  it('lists recent contacts and cards', async () => {
    const contactCalls = [];
    const cardCalls = [];
    api()
      .get(route('/api/contacts', contactCalls))
      .reply(200, page([rawContact()]))
      .get(route('/api/boards/b1/cards', cardCalls))
      .reply(200, page([rawCard()]));
    expect(await perform('contactList', {})).toEqual([
      { id: 'ct1', name: 'Maria (maria@example.com)', email: 'maria@example.com' },
    ]);
    expect(await perform('cardList', { boardId: 'b1' })).toEqual([
      { id: 'card1', title: 'Maria - Website', phaseName: 'Lead' },
    ]);
    expect(contactCalls[0]).toContain('sort=updatedAt:desc');
    expect(cardCalls[0]).toContain('pagination[pageSize]=50');
  });
});
