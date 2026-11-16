'use strict';

const { createClient } = require('../lib/client');
const { boardField, cardField, phaseField } = require('../lib/fields');
const { moveCard } = require('../lib/operations');
const samples = require('../lib/samples');

const perform = (z, bundle) => {
  const input = bundle.inputData;
  return moveCard(createClient(z), {
    boardId: input.boardId,
    cardId: input.cardId,
    phaseId: input.phaseId,
    reason: input.reason,
  });
};

module.exports = {
  key: 'moveCard',
  noun: 'Card',
  display: {
    label: 'Move Card to Phase',
    description: 'Moves an existing card to another phase of its board.',
  },
  operation: {
    inputFields: [
      boardField({ helpText: 'The board of the card.' }),
      cardField({ helpText: 'The card to move. Choose the board first, or map a card ID.' }),
      phaseField({ required: true, helpText: 'The phase to move the card to.' }),
      {
        key: 'reason',
        label: 'Reason',
        type: 'string',
        required: false,
        helpText: 'Note saved in the movement history of the card.',
      },
    ],
    perform,
    sample: samples.card,
    outputFields: samples.cardOutputFields,
  },
};
