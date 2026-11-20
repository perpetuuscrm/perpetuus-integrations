'use strict';

const authentication = require('./authentication');
const { befores, afters } = require('./lib/middleware');

const newCard = require('./triggers/new_card');
const cardEnteredPhase = require('./triggers/card_entered_phase');
const newContact = require('./triggers/new_contact');
const taskCompleted = require('./triggers/task_completed');
const dropdowns = require('./triggers/dropdowns');
const instant = require('./triggers/instant');

const upsertContact = require('./creates/upsert_contact');
const createCard = require('./creates/create_card');
const moveCard = require('./creates/move_card');
const addCardTags = require('./creates/add_card_tags');
const createTask = require('./creates/create_task');

const findContact = require('./searches/find_contact');
const findCard = require('./searches/find_card');

const byKey = (...operations) =>
  Object.fromEntries(operations.map((operation) => [operation.key, operation]));

module.exports = {
  version: require('./package.json').version,
  platformVersion: require('zapier-platform-core').version,

  // cleanInputData: false keeps inputs as typed; the operations drop empty values themselves.
  flags: { throwForThrottlingEarly: false, cleanInputData: false },

  authentication,
  beforeRequest: [...befores],
  afterResponse: [...afters],

  triggers: byKey(
    instant.newCardInstant,
    instant.cardEnteredPhaseInstant,
    instant.newContactInstant,
    instant.newMessage,
    newCard,
    cardEnteredPhase,
    newContact,
    taskCompleted,
    ...Object.values(dropdowns),
  ),

  creates: byKey(upsertContact, createCard, moveCard, addCardTags, createTask),

  searches: byKey(findContact, findCard),

  searchOrCreates: {
    [findContact.key]: {
      key: findContact.key,
      display: {
        label: 'Find or Create Contact',
        description: 'Finds a contact, or creates or updates it when it is not found.',
      },
      search: findContact.key,
      create: upsertContact.key,
    },
  },
};
