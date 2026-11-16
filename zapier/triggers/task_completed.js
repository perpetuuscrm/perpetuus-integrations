'use strict';

const { createClient } = require('../lib/client');
const { boardField } = require('../lib/fields');
const { pollCompletedTasks } = require('../lib/polling');
const samples = require('../lib/samples');

const perform = (z, bundle) => pollCompletedTasks(createClient(z), bundle.inputData);

module.exports = {
  key: 'taskCompleted',
  noun: 'Task',
  display: {
    label: 'Task Completed',
    description:
      'Triggers when a task is completed for the first time. Reopening and completing it again does not trigger.',
  },
  operation: {
    type: 'polling',
    inputFields: [
      boardField({
        required: false,
        helpText: 'Only tasks of this board. Leave empty to include every board you can access.',
      }),
    ],
    perform,
    sample: samples.taskCompletedEvent,
    outputFields: samples.taskEventOutputFields,
  },
};
