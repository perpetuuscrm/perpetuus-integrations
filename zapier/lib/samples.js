'use strict';

/**
 * Static samples and output field labels of the canonical objects (docs/v1-contract.md §4).
 * All data is fictional.
 */

const contact = {
  id: 'ct7h2k9q4w1e8r5t3y6u0i',
  name: 'Maria Silva',
  email: 'maria.silva@example.com',
  phone: '+5511999990000',
  contactType: 'person',
  cpf: null,
  cnpj: null,
  address: 'Rua Exemplo, 100',
  city: 'São Paulo',
  state: 'SP',
  country: 'Brasil',
  postalCode: '01000-000',
  customFields: { origem: 'Website' },
  createdAt: '2026-11-16T12:00:00.000Z',
  updatedAt: '2026-11-16T12:30:00.000Z',
};

const upsertedContact = {
  ...contact,
  created: true,
  matchedBy: null,
  otherMatchIds: [],
};

const card = {
  id: 'cd3f8a1b6c9d2e7f4a0b5c',
  title: 'Maria Silva - Website',
  boardId: 'bd1a2b3c4d5e6f7a8b9c0d',
  phaseId: 'ph9z8y7x6w5v4u3t2s1r0q',
  phaseName: 'Proposal',
  phaseEnteredAt: '2026-11-16T13:00:00.000Z',
  contactId: 'ct7h2k9q4w1e8r5t3y6u0i',
  contactName: 'Maria Silva',
  contactEmail: 'maria.silva@example.com',
  contactPhone: '+5511999990000',
  value: 1500.5,
  dueDate: '2026-11-30T18:00:00.000Z',
  description: 'Lead from the website form.',
  tagIds: ['tg5e4d3c2b1a0f9e8d7c6b'],
  tagNames: ['Hot lead'],
  fields: { origem: 'Website', valor_proposta: 1500 },
  createdAt: '2026-11-16T12:45:00.000Z',
  updatedAt: '2026-11-16T13:00:00.000Z',
};

const task = {
  id: 'tk2w4e6r8t0y1u3i5o7p9a',
  name: 'Send the proposal',
  description: 'Email the signed proposal to the client.',
  type: 'follow-up',
  priority: 'high',
  status: 'Done',
  dueDate: '2026-11-17T15:00:00.000Z',
  completedAt: '2026-11-16T14:00:00.000Z',
  cardId: 'cd3f8a1b6c9d2e7f4a0b5c',
  cardTitle: 'Maria Silva - Website',
  assigneeIds: ['mb6y5t4r3e2w1q0p9o8i7u'],
  createdAt: '2026-11-16T12:50:00.000Z',
  updatedAt: '2026-11-16T14:00:00.000Z',
};

const newCardEvent = { ...card, cardId: card.id, eventId: card.id, eventAt: card.createdAt };
const cardEnteredPhaseEvent = {
  ...card,
  cardId: card.id,
  eventId: `${card.id}:${card.phaseId}:${card.phaseEnteredAt}`,
  eventAt: card.phaseEnteredAt,
};
cardEnteredPhaseEvent.id = cardEnteredPhaseEvent.eventId;
const newContactEvent = {
  ...contact,
  contactId: contact.id,
  eventId: contact.id,
  eventAt: contact.createdAt,
};
const taskCompletedEvent = {
  ...task,
  id: `${task.id}:${task.completedAt}`,
  taskId: task.id,
  eventId: `${task.id}:${task.completedAt}`,
  eventAt: task.completedAt,
};

const contactOutputFields = [
  { key: 'id', label: 'Contact ID', type: 'string' },
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'contactType', label: 'Contact Type' },
  { key: 'cpf', label: 'CPF' },
  { key: 'cnpj', label: 'CNPJ' },
  { key: 'address', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'country', label: 'Country' },
  { key: 'postalCode', label: 'Postal Code' },
  { key: 'createdAt', label: 'Created At', type: 'datetime' },
  { key: 'updatedAt', label: 'Updated At', type: 'datetime' },
];

const upsertedContactOutputFields = [
  ...contactOutputFields,
  { key: 'created', label: 'Created', type: 'boolean' },
  { key: 'matchedBy', label: 'Matched By' },
  { key: 'otherMatchIds', label: 'Other Matching Contact IDs', list: true },
];

const cardOutputFields = [
  { key: 'id', label: 'Card ID', type: 'string' },
  { key: 'title', label: 'Title' },
  { key: 'boardId', label: 'Board ID' },
  { key: 'phaseId', label: 'Phase ID' },
  { key: 'phaseName', label: 'Phase Name' },
  { key: 'phaseEnteredAt', label: 'Phase Entered At' },
  { key: 'contactId', label: 'Contact ID' },
  { key: 'contactName', label: 'Contact Name' },
  { key: 'contactEmail', label: 'Contact Email' },
  { key: 'contactPhone', label: 'Contact Phone' },
  { key: 'value', label: 'Value', type: 'number' },
  { key: 'dueDate', label: 'Due Date' },
  { key: 'description', label: 'Description' },
  { key: 'tagIds', label: 'Tag IDs', list: true },
  { key: 'tagNames', label: 'Tag Names', list: true },
  { key: 'createdAt', label: 'Created At', type: 'datetime' },
  { key: 'updatedAt', label: 'Updated At', type: 'datetime' },
];

const taskOutputFields = [
  { key: 'id', label: 'Task ID', type: 'string' },
  { key: 'name', label: 'Name' },
  { key: 'description', label: 'Description' },
  { key: 'type', label: 'Type' },
  { key: 'priority', label: 'Priority' },
  { key: 'status', label: 'Status' },
  { key: 'dueDate', label: 'Due Date' },
  { key: 'completedAt', label: 'Completed At' },
  { key: 'cardId', label: 'Card ID' },
  { key: 'cardTitle', label: 'Card Title' },
  { key: 'assigneeIds', label: 'Assignee IDs', list: true },
  { key: 'createdAt', label: 'Created At', type: 'datetime' },
  { key: 'updatedAt', label: 'Updated At', type: 'datetime' },
];

/** Trigger results: `id` is the event id, the entity id goes in cardId/contactId/taskId. */
const eventOutputFields = (entityKey, entityLabel) => [
  { key: 'id', label: 'Event ID', type: 'string' },
  { key: entityKey, label: entityLabel, type: 'string' },
  { key: 'eventId', label: 'Event ID (Deduplication Key)', type: 'string' },
  { key: 'eventAt', label: 'Event At', type: 'datetime' },
];

const withoutId = (fields) => fields.filter((field) => field.key !== 'id');

module.exports = {
  contact,
  upsertedContact,
  card,
  task,
  newCardEvent,
  cardEnteredPhaseEvent,
  newContactEvent,
  taskCompletedEvent,
  contactOutputFields,
  upsertedContactOutputFields,
  cardOutputFields,
  taskOutputFields,
  cardEventOutputFields: [
    ...eventOutputFields('cardId', 'Card ID'),
    ...withoutId(cardOutputFields).filter((field) => field.key !== 'cardId'),
  ],
  contactEventOutputFields: [
    ...eventOutputFields('contactId', 'Contact ID'),
    ...withoutId(contactOutputFields),
  ],
  taskEventOutputFields: [
    ...eventOutputFields('taskId', 'Task ID'),
    ...withoutId(taskOutputFields),
  ],
};
