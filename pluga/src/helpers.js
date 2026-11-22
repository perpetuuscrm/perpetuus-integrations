'use strict';

/**
 * GET /helpers/{helper_id}: options of dynamic dropdowns (docs/v1-contract.md §8).
 * Board-dependent helpers read the board from the query string (`boardId`, or `board_id`).
 */
const ops = require('./perpetuus/operations');
const { unwrapList } = require('./perpetuus/mappers');
const { AdapterError } = require('./errors');

const same = (text) => ({ pt_BR: text, en: text });
const option = (label, value) => ({ label: same(String(label)), value: String(value) });

function boardIdFrom(query) {
  const value = query.boardId ?? query.board_id ?? query['configuration.boardId'];
  const id = String(Array.isArray(value) ? value[0] : value ?? '').trim();
  if (!id) throw new AdapterError(400, 'Choose the Board first (boardId is missing).');
  return id;
}

async function listBoards(client) {
  const boards = await ops.paginate(client, '/boards', { sort: 'name:asc' }, 300);
  return boards.filter((b) => b.documentId).map((b) => option(b.name ?? b.documentId, b.documentId));
}

const HELPERS = {
  boards_list: (client) => listBoards(client),

  phases_list: async (client, query) => {
    const { phases } = await ops.getBoardStructure(client, boardIdFrom(query), ['phases']);
    return phases.map((p) => option(p.name, p.id));
  },

  tags_list: async (client, query) => {
    const { tags } = await ops.getBoardStructure(client, boardIdFrom(query), ['tags']);
    return tags.map((tag) => option(tag.name, tag.value));
  },

  members_list: async (client, query) => {
    const members = await ops.listBoardMembers(client, boardIdFrom(query));
    return members.map((m) => option(m.email && m.email !== m.name ? `${m.name} (${m.email})` : m.name, m.id));
  },

  cards_list: async (client, query) => {
    const boardId = boardIdFrom(query);
    const response = await client.request('GET', `/boards/${encodeURIComponent(boardId)}/cards`, {
      query: { sort: 'updatedAt:desc', stats: 'false', pagination: { page: 1, pageSize: 100 } },
    });
    return unwrapList(response)
      .filter((c) => c.documentId)
      .map((c) => option(c.title ?? c.documentId, c.documentId));
  },
};

async function runHelper(id, client, query) {
  const helper = HELPERS[id];
  if (!helper) return null;
  return helper(client, query || {});
}

module.exports = { HELPERS, runHelper, boardIdFrom };
