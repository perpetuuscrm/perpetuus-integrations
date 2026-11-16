'use strict';

const { createClient } = require('../lib/client');
const { boardField, cardField, tagsField } = require('../lib/fields');
const { addCardTags } = require('../lib/operations');
const samples = require('../lib/samples');

const perform = (z, bundle) => {
  const input = bundle.inputData;
  return addCardTags(createClient(z), {
    boardId: input.boardId,
    cardId: input.cardId,
    tagIds: input.tagIds,
  });
};

module.exports = {
  key: 'addCardTags',
  noun: 'Card',
  display: {
    label: 'Add Tags to Card',
    description: 'Adds tags to an existing card, keeping the tags it already has.',
  },
  operation: {
    inputFields: [
      boardField({ helpText: 'The board of the card.' }),
      cardField({ helpText: 'The card to tag. Choose the board first, or map a card ID.' }),
      tagsField({ required: true, helpText: 'Tags to add. Tags already on the card are kept.' }),
    ],
    perform,
    sample: samples.card,
    outputFields: samples.cardOutputFields,
  },
};
