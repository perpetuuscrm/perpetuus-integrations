'use strict';

const { createClient } = require('../lib/client');
const { pollContacts } = require('../lib/polling');
const samples = require('../lib/samples');

const perform = (z) => pollContacts(createClient(z));

module.exports = {
  key: 'newContact',
  noun: 'Contact',
  // Hidden since 1.1.0: existing Zaps keep this polling trigger; new Zaps use the instant
  // (REST Hook) trigger in triggers/instant.js.
  display: {
    label: 'New Contact (Polling)',
    hidden: true,
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
