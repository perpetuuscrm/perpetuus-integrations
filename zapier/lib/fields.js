'use strict';

/** Input fields shared by several operations. Keys follow docs/v1-contract.md. */

const boardField = (overrides = {}) => ({
  key: 'boardId',
  label: 'Board',
  required: true,
  dynamic: 'boardList.id.name',
  helpText: 'The Perpetuus board (pipeline) to use.',
  ...overrides,
});

const phaseField = (overrides = {}) => ({
  key: 'phaseId',
  label: 'Phase',
  required: false,
  dynamic: 'phaseList.id.name',
  helpText: 'A phase of the selected board. Choose the board first.',
  ...overrides,
});

const cardField = (overrides = {}) => ({
  key: 'cardId',
  label: 'Card',
  required: true,
  dynamic: 'cardList.id.title',
  search: 'findCard.id',
  helpText: 'The card to update. Choose the board first, or map a card ID from a previous step.',
  ...overrides,
});

const contactField = (overrides = {}) => ({
  key: 'contactId',
  label: 'Contact',
  required: false,
  dynamic: 'contactList.id.name',
  search: 'findContact.id',
  helpText: 'A Perpetuus contact. Pick one from the list or map a contact ID from a previous step.',
  ...overrides,
});

const tagsField = (overrides = {}) => ({
  key: 'tagIds',
  label: 'Tags',
  required: false,
  list: true,
  dynamic: 'tagList.id.name',
  helpText: 'Tags of the selected board. Tag IDs or slugs are accepted when mapped.',
  ...overrides,
});

const assigneesField = (overrides = {}) => ({
  key: 'assigneeIds',
  label: 'Assignees',
  required: false,
  list: true,
  dynamic: 'memberList.id.name',
  helpText: 'Board members responsible for it. Choose the board first.',
  ...overrides,
});

const dueDateField = (overrides = {}) => ({
  key: 'dueDate',
  label: 'Due Date',
  type: 'datetime',
  required: false,
  helpText: 'Date and time in ISO 8601 (for example 2026-11-30T18:00:00-03:00).',
  ...overrides,
});

const descriptionField = (overrides = {}) => ({
  key: 'description',
  label: 'Description',
  type: 'text',
  required: false,
  helpText: 'Free text shown in Perpetuus.',
  ...overrides,
});

module.exports = {
  boardField,
  phaseField,
  cardField,
  contactField,
  tagsField,
  assigneesField,
  dueDateField,
  descriptionField,
};
