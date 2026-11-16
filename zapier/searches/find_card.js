'use strict';

const { createClient } = require('../lib/client');
const { SEARCH_LIMIT } = require('../lib/constants');
const { boardField, phaseField } = require('../lib/fields');
const { findCards } = require('../lib/operations');
const samples = require('../lib/samples');

const perform = (z, bundle) => {
  const input = bundle.inputData;
  return findCards(createClient(z), {
    boardId: input.boardId,
    query: input.query,
    phaseId: input.phaseId,
    contactId: input.contactId,
    limit: SEARCH_LIMIT,
  });
};

module.exports = {
  key: 'findCard',
  noun: 'Card',
  display: {
    label: 'Find Card',
    description: 'Finds a card in a board by title, phase or contact.',
  },
  operation: {
    inputFields: [
      boardField({ helpText: 'The board to search in. Cards are always searched within one board.' }),
      {
        key: 'query',
        label: 'Title Contains',
        type: 'string',
        required: false,
        helpText: 'Text contained in the card title (not case sensitive).',
      },
      phaseField({ helpText: 'Only cards currently in this phase.' }),
      {
        key: 'contactId',
        label: 'Contact',
        required: false,
        dynamic: 'contactList.id.name',
        helpText:
          'Only cards linked to this contact. To search by email, use Find Contact first and map its ID here.',
      },
    ],
    perform,
    sample: samples.card,
    outputFields: samples.cardOutputFields,
  },
};
