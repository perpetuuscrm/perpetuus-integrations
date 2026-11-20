'use strict';

const { createClient } = require('../lib/client');
const { boardField } = require('../lib/fields');
const { pollCards } = require('../lib/polling');
const samples = require('../lib/samples');

const perform = (z, bundle) => pollCards(createClient(z), bundle.inputData, 'newCard');

module.exports = {
  key: 'newCard',
  noun: 'Card',
  // Hidden since 1.1.0: existing Zaps keep this polling trigger; new Zaps use the instant
  // (REST Hook) trigger in triggers/instant.js.
  display: {
    label: 'New Card (Polling)',
    hidden: true,
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
