'use strict';

const { createClient } = require('../lib/client');
const { pollContacts } = require('../lib/polling');
const samples = require('../lib/samples');

const perform = (z) => pollContacts(createClient(z));

module.exports = {
  key: 'newContact',
  noun: 'Contact',
  display: {
    label: 'New Contact',
    description:
      'Triggers when a new contact is created. Only contacts visible to the owner of the API key are included.',
  },
  operation: {
    type: 'polling',
    inputFields: [],
    perform,
    sample: samples.newContactEvent,
    outputFields: samples.contactEventOutputFields,
  },
};
