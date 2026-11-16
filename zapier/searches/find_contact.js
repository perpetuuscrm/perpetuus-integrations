'use strict';

const { createClient } = require('../lib/client');
const { SEARCH_LIMIT } = require('../lib/constants');
const { findContacts } = require('../lib/operations');
const samples = require('../lib/samples');

const perform = (z, bundle) =>
  findContacts(createClient(z), {
    searchBy: bundle.inputData.searchBy || 'email',
    value: bundle.inputData.value,
    limit: SEARCH_LIMIT,
  });

module.exports = {
  key: 'findContact',
  noun: 'Contact',
  display: {
    label: 'Find Contact',
    description: 'Finds a contact by email, phone or text.',
  },
  operation: {
    inputFields: [
      {
        key: 'searchBy',
        label: 'Search By',
        required: true,
        default: 'email',
        choices: [
          { value: 'email', label: 'Email (exact match)', sample: 'email' },
          { value: 'phone', label: 'Phone', sample: 'phone' },
          { value: 'text', label: 'Text (name, email, phone, CPF or CNPJ)', sample: 'text' },
        ],
        helpText:
          'Email and phone return the oldest matching contact, the same one Create or Update Contact would update. Phone matches the digits as stored (DDD plus number).',
      },
      {
        key: 'value',
        label: 'Search Value',
        type: 'string',
        required: true,
        helpText: 'The email, phone or text to look for.',
      },
    ],
    perform,
    sample: samples.contact,
    outputFields: samples.contactOutputFields,
  },
};
