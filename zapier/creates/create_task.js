'use strict';

const { createClient } = require('../lib/client');
const {
  assigneesField,
  boardField,
  cardField,
  descriptionField,
  dueDateField,
} = require('../lib/fields');
const { createTask } = require('../lib/operations');
const samples = require('../lib/samples');

const perform = (z, bundle) => {
  const input = bundle.inputData;
  return createTask(createClient(z), {
    name: input.name,
    boardId: input.boardId,
    cardId: input.cardId,
    description: input.description,
    dueDate: input.dueDate,
    type: input.type,
    priority: input.priority,
    status: input.status,
    assigneeIds: input.assigneeIds,
  });
};

module.exports = {
  key: 'createTask',
  noun: 'Task',
  display: {
    label: 'Create Task',
    description: 'Creates a new task in a board or linked to a card.',
  },
  operation: {
    inputFields: [
      { key: 'name', label: 'Name', type: 'string', required: true, helpText: 'What needs to be done.' },
      boardField({
        required: false,
        helpText: 'Board of the task. Provide a board, a card, or both.',
      }),
      cardField({
        required: false,
        helpText: 'Card the task belongs to. When set, the board comes from the card.',
      }),
      descriptionField(),
      dueDateField(),
      {
        key: 'type',
        label: 'Type',
        required: false,
        choices: [
          { value: 'reminder', label: 'Reminder', sample: 'reminder' },
          { value: 'follow-up', label: 'Follow-up', sample: 'follow-up' },
          { value: 'action', label: 'Action', sample: 'action' },
          { value: 'other', label: 'Other', sample: 'other' },
        ],
        helpText: 'Kind of task. Perpetuus uses Follow-up when empty.',
      },
      {
        key: 'priority',
        label: 'Priority',
        required: false,
        choices: [
          { value: 'low', label: 'Low', sample: 'low' },
          { value: 'medium', label: 'Medium', sample: 'medium' },
          { value: 'high', label: 'High', sample: 'high' },
          { value: 'urgent', label: 'Urgent', sample: 'urgent' },
        ],
        helpText: 'Perpetuus uses Medium when empty.',
      },
      {
        key: 'status',
        label: 'Status',
        type: 'string',
        required: false,
        helpText: 'Task status exactly as configured in the board. Empty uses the first status.',
      },
      assigneesField({ helpText: 'Board members responsible for the task. Empty assigns the key owner.' }),
    ],
    perform,
    sample: samples.task,
    outputFields: samples.taskOutputFields,
  },
};
