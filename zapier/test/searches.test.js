'use strict';

const { App, appTester, api, makeBundle, route, expectError, setup, rawCard, rawContact, page } = require('./helpers');

setup();

const search = (key, inputData) =>
  appTester(App.searches[key].operation.perform, makeBundle(inputData));

describe('Find Contact', () => {
  it('searches by exact email, oldest first', async () => {
    const calls = [];
    const scope = api().get(route('/api/contacts', calls)).reply(200, page([rawContact()]));
    const results = await search('findContact', { searchBy: 'email', value: 'Maria@Example.com' });
    expect(calls[0]).toContain('filters[email][$eqi]=Maria@Example.com');
    expect(calls[0]).toContain('sort=createdAt:asc');
    expect(calls[0]).toContain('pagination[pageSize]=50');
    expect(results[0]).toMatchObject({ id: 'ct1', email: 'maria@example.com' });
    scope.done();
  });

  it('searches by phone digits without the 55 country code', async () => {
    const calls = [];
    api().get(route('/api/contacts', calls)).reply(200, page([]));
    expect(await search('findContact', { searchBy: 'phone', value: '+55 (11) 99999-0000' })).toEqual([]);
    expect(calls[0]).toContain('quickSearch=11999990000');
    expect(calls[0]).toContain('sort=createdAt:asc');
  });

  it('searches free text by most recent update', async () => {
    const calls = [];
    api().get(route('/api/contacts', calls)).reply(200, page([]));
    await search('findContact', { searchBy: 'text', value: 'Acme' });
    expect(calls[0]).toContain('quickSearch=Acme');
    expect(calls[0]).toContain('sort=updatedAt:desc');
  });

  it('requires a value', async () => {
    const { message } = await expectError(() => search('findContact', { searchBy: 'email', value: ' ' }));
    expect(message).toBe('Provide the value to search for.');
  });
});

describe('Find Card', () => {
  it('filters by title, phase and contact inside the board', async () => {
    const calls = [];
    const scope = api().get(route('/api/boards/b1/cards', calls)).reply(200, page([rawCard()]));
    const results = await search('findCard', {
      boardId: 'b1',
      query: 'maria',
      phaseId: 'ph1',
      contactId: 'ct1',
    });
    expect(calls[0]).toContain('filters[title][$containsi]=maria');
    expect(calls[0]).toContain('filters[currentPhase][documentId][$eq]=ph1');
    expect(calls[0]).toContain('filters[contact][documentId][$eq]=ct1');
    expect(calls[0]).toContain('sort=updatedAt:desc');
    expect(calls[0]).toContain('stats=false');
    expect(results[0]).toMatchObject({ id: 'card1', boardId: 'b1' });
    scope.done();
  });

  it('returns an empty list when nothing matches', async () => {
    api().get(route('/api/boards/b1/cards', [])).reply(200, page([]));
    expect(await search('findCard', { boardId: 'b1' })).toEqual([]);
  });
});

describe('search-or-create', () => {
  it('pairs Find Contact with Create or Update Contact', () => {
    expect(App.searchOrCreates.findContact).toMatchObject({
      key: 'findContact',
      search: 'findContact',
      create: 'upsertContact',
    });
  });
});
