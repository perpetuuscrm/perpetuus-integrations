'use strict';

const { createClient } = require('../lib/client');
const { boardField } = require('../lib/fields');
const { pollCards } = require('../lib/polling');
const samples = require('../lib/samples');

const perform = (z, bundle) => pollCards(createClient(z), bundle.inputData, 'newCard');

module.exports = {
  key: 'newCard',
  noun: 'Card',
  display: {
    label: 'New Card',
    description: 'Triggers when a new card is created in a board.',
  },
  operation: {
    type: 'polling',
    inputFields: [boardField({ helpText: 'The board to watch for new cards.' })],
    perform,
    sample: samples.newCardEvent,
    outputFields: samples.cardEventOutputFields,
  },
};
