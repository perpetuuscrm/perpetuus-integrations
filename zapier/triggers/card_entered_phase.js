'use strict';

const { createClient } = require('../lib/client');
const { boardField, phaseField } = require('../lib/fields');
const { pollCards } = require('../lib/polling');
const samples = require('../lib/samples');

const perform = (z, bundle) => pollCards(createClient(z), bundle.inputData, 'cardEnteredPhase');

module.exports = {
  key: 'cardEnteredPhase',
  noun: 'Card',
  display: {
    label: 'Card Entered Phase',
    description:
      'Triggers when a card enters a phase of a board, including the first phase of a new card.',
  },
  operation: {
    type: 'polling',
    inputFields: [
      boardField({ helpText: 'The board to watch.' }),
      phaseField({
        helpText:
          'Only trigger for this phase. Leave empty to trigger on any phase. If a card passes through several phases between two checks, only its current phase is seen.',
      }),
    ],
    perform,
    sample: samples.cardEnteredPhaseEvent,
    outputFields: samples.cardEventOutputFields,
  },
};
