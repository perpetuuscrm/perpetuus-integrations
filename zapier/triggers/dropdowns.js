'use strict';

/**
 * Hidden triggers that feed the dynamic dropdowns (docs/v1-contract.md §8).
 * Each result has `id` plus the label key used in `dynamic: '<key>.id.<label>'`.
 */
const { createClient } = require('../lib/client');
const { DROPDOWN_PAGE_SIZE, MAX_PAGE_SIZE } = require('../lib/constants');
const { unwrapList } = require('../lib/mappers');
const { getBoardStructure, listBoardMembers } = require('../lib/operations');

const enc = encodeURIComponent;

function currentPage(bundle) {
  const page = Number(bundle.meta?.page ?? 0);
  return Number.isFinite(page) && page > 0 ? page : 0;
}

function boardIdOf(bundle) {
  const value = String(bundle.inputData?.boardId ?? '').trim();
  // A board mapped from a previous step is not known while the Zap is being edited.
  return value && !value.includes('{{') ? value : '';
}

const hidden = (key, noun, description, perform, sample, extra = {}) => ({
  key,
  noun,
  display: { label: `List ${noun}s`, description, hidden: true },
  operation: { type: 'polling', perform, sample, ...extra },
});

// GET /boards?sort=name:asc, 100 per page
const boardList = hidden(
  'boardList',
  'Board',
  'Triggers when a board is added. Lists the boards for dropdowns.',
  async (z, bundle) => {
    const response = await createClient(z).request('GET', '/boards', {
      query: {
        sort: 'name:asc',
        pagination: { page: currentPage(bundle) + 1, pageSize: MAX_PAGE_SIZE },
      },
    });
    return unwrapList(response)
      .map((board) => ({ id: String(board.documentId ?? ''), name: String(board.name ?? board.documentId) }))
      .filter((board) => board.id);
  },
  { id: 'bd1a2b3c4d5e6f7a8b9c0d', name: 'Sales' },
  { canPaginate: true },
);

// GET /boards/{boardId}/structure?include=phases, ordered by phase order
const phaseList = hidden(
  'phaseList',
  'Phase',
  'Triggers when a phase is added to a board. Lists the phases for dropdowns.',
  async (z, bundle) => {
    const boardId = boardIdOf(bundle);
    if (!boardId || currentPage(bundle) > 0) return [];
    const structure = await getBoardStructure(createClient(z), boardId, ['phases']);
    return structure.phases.map((phase) => ({
      id: phase.id,
      name: phase.order === 0 ? `${phase.name} (form)` : phase.name,
      order: phase.order,
    }));
  },
  { id: 'ph9z8y7x6w5v4u3t2s1r0q', name: 'Proposal', order: 2 },
);

// GET /boards/{boardId}/structure?include=tags
const tagList = hidden(
  'tagList',
  'Tag',
  'Triggers when a tag is added to a board. Lists the tags for dropdowns.',
  async (z, bundle) => {
    const boardId = boardIdOf(bundle);
    if (!boardId || currentPage(bundle) > 0) return [];
    const structure = await getBoardStructure(createClient(z), boardId, ['tags']);
    return structure.tags.map((tag) => ({ id: tag.value, name: tag.name }));
  },
  { id: 'tg5e4d3c2b1a0f9e8d7c6b', name: 'Hot lead' },
);

// GET /boards/{boardId}/members
const memberList = hidden(
  'memberList',
  'Member',
  'Triggers when a member joins a board. Lists the board members for dropdowns.',
  async (z, bundle) => {
    const boardId = boardIdOf(bundle);
    if (!boardId || currentPage(bundle) > 0) return [];
    return listBoardMembers(createClient(z), boardId);
  },
  { id: 'mb6y5t4r3e2w1q0p9o8i7u', name: 'João Souza', email: 'joao.souza@example.com' },
);

// GET /contacts?sort=updatedAt:desc, 50 per page
const contactList = hidden(
  'contactList',
  'Contact',
  'Triggers when a contact is updated. Lists recent contacts for dropdowns.',
  async (z, bundle) => {
    const response = await createClient(z).request('GET', '/contacts', {
      query: {
        sort: 'updatedAt:desc',
        pagination: { page: currentPage(bundle) + 1, pageSize: DROPDOWN_PAGE_SIZE },
      },
    });
    return unwrapList(response)
      .map((contact) => {
        const name = String(contact.name ?? contact.documentId);
        return {
          id: String(contact.documentId ?? ''),
          name: contact.email ? `${name} (${String(contact.email)})` : name,
          email: contact.email ? String(contact.email) : null,
        };
      })
      .filter((contact) => contact.id);
  },
  { id: 'ct7h2k9q4w1e8r5t3y6u0i', name: 'Maria Silva (maria.silva@example.com)', email: 'maria.silva@example.com' },
  { canPaginate: true },
);

// GET /boards/{boardId}/cards?sort=updatedAt:desc, 50 per page
const cardList = hidden(
  'cardList',
  'Card',
  'Triggers when a card is updated. Lists recent cards of a board for dropdowns.',
  async (z, bundle) => {
    const boardId = boardIdOf(bundle);
    if (!boardId) return [];
    const response = await createClient(z).request('GET', `/boards/${enc(boardId)}/cards`, {
      query: {
        sort: 'updatedAt:desc',
        stats: 'false',
        populate: { currentPhase: true },
        pagination: { page: currentPage(bundle) + 1, pageSize: DROPDOWN_PAGE_SIZE },
      },
    });
    return unwrapList(response)
      .map((card) => ({
        id: String(card.documentId ?? ''),
        title: String(card.title ?? card.documentId),
        phaseName: card.currentPhase?.name ? String(card.currentPhase.name) : null,
      }))
      .filter((card) => card.id);
  },
  { id: 'cd3f8a1b6c9d2e7f4a0b5c', title: 'Maria Silva - Website', phaseName: 'Proposal' },
  { canPaginate: true },
);

module.exports = { boardList, phaseList, tagList, memberList, contactList, cardList };
