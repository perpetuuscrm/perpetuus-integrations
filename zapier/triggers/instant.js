'use strict';

/**
 * Instant (REST Hook) versions of the card, phase and contact triggers, plus New Message.
 *
 * New keys, because Zapier treats a polling → hook change of an existing trigger as breaking:
 * Zaps built on the polling keys (`newCard`, `cardEnteredPhase`, `newContact`) keep working
 * on those (now hidden) triggers, and new Zaps use these. Same inputs and the same result
 * shape as the polling triggers (docs/v1-contract.md §5.7).
 */
const { createClient } = require('../lib/client');
const { boardField, phaseField } = require('../lib/fields');
const { pollCards, pollContacts } = require('../lib/polling');
const samples = require('../lib/samples');
const {
  WEBHOOK_EVENTS,
  fetchSamples,
  parseEnvelope,
  subscribe,
  toWebhookResult,
  unsubscribe,
  verifySignature,
} = require('../lib/webhooks');

function zapDescription(bundle, key) {
  const zap = bundle.meta && bundle.meta.zap;
  const name = zap && (zap.name || zap.id) ? ` ${zap.name || zap.id}` : '';
  return `Zapier${name ? `:${name}` : ''} (${key})`;
}

/** Fictional deliveries from `/webhook-subscriptions/samples`, mapped like real ones. */
async function samplesFor(client, event) {
  const results = [];
  for (const type of WEBHOOK_EVENTS[event]) {
    for (const data of await fetchSamples(client, type)) {
      const envelope = { id: `evt_sample_${type}`, type, timestamp: null, data };
      // Samples are fictional: ignore the board/phase filters so the user always sees fields.
      const result = toWebhookResult(event, envelope, {});
      if (result) results.push(result);
    }
  }
  return results.slice(0, 3);
}

function hookTrigger({ key, event, noun, label, description, inputFields, sample, outputFields, poll }) {
  const performSubscribe = async (z, bundle) => {
    const subscription = await subscribe(createClient(z), {
      url: bundle.targetUrl,
      event,
      boardId: bundle.inputData.boardId,
      origin: 'zapier',
      description: zapDescription(bundle, key),
    });
    // Zapier stores this object as bundle.subscribeData (id for unsubscribe, secret for HMAC).
    return { id: subscription.id, secret: subscription.secret, events: subscription.events, boardId: subscription.boardId };
  };

  const performUnsubscribe = async (z, bundle) =>
    unsubscribe(createClient(z), bundle.subscribeData && bundle.subscribeData.id);

  const perform = async (z, bundle) => {
    const secret = bundle.subscribeData && bundle.subscribeData.secret;
    const raw = bundle.rawRequest;
    if (secret && raw && typeof raw.content === 'string' && raw.content) {
      const check = verifySignature(secret, raw.headers || {}, raw.content);
      if (!check.ok) {
        z.console.log(`Perpetuus webhook ignored: ${check.reason}`);
        return [];
      }
    }
    const envelope = parseEnvelope(bundle.cleanedRequest);
    if (!envelope) return [];
    const result = toWebhookResult(event, envelope, bundle.inputData);
    return result ? [result] : [];
  };

  const performList = async (z, bundle) => {
    const client = createClient(z);
    // Real recent records first (same shape as the deliveries); the samples endpoint when the
    // account has none yet or the event has no list route (New Message).
    const recent = poll ? await poll(client, bundle.inputData) : [];
    return recent.length ? recent.slice(0, 3) : samplesFor(client, event);
  };

  return {
    key,
    noun,
    display: { label, description },
    operation: {
      type: 'hook',
      inputFields,
      performSubscribe,
      performUnsubscribe,
      perform,
      performList,
      sample,
      outputFields,
    },
  };
}

const newCardInstant = hookTrigger({
  key: 'newCardInstant',
  event: 'newCard',
  noun: 'Card',
  label: 'New Card',
  description: 'Triggers when a new card is created in a board.',
  inputFields: [boardField({ helpText: 'The board to watch for new cards.' })],
  sample: { ...samples.newCardEvent, webhookEventId: samples.newMessageEvent.webhookEventId },
  outputFields: [...samples.cardEventOutputFields, samples.webhookEventIdField],
  poll: (client, input) => pollCards(client, input, 'newCard'),
});

const cardEnteredPhaseInstant = hookTrigger({
  key: 'cardEnteredPhaseInstant',
  event: 'cardEnteredPhase',
  noun: 'Card',
  label: 'Card Entered Phase',
  description:
    'Triggers when a card enters a phase of a board, including the first phase of a new card.',
  inputFields: [
    boardField({ helpText: 'The board to watch.' }),
    phaseField({ helpText: 'Only trigger for this phase. Leave empty to trigger on any phase.' }),
  ],
  sample: {
    ...samples.cardEnteredPhaseEvent,
    previousPhaseId: 'ph1a2b3c4d5e6f7a8b9c0d1e',
    previousPhaseName: 'Lead',
    webhookEventId: samples.newMessageEvent.webhookEventId,
  },
  outputFields: samples.cardPhaseEventOutputFields,
  poll: (client, input) => pollCards(client, input, 'cardEnteredPhase'),
});

const newContactInstant = hookTrigger({
  key: 'newContactInstant',
  event: 'newContact',
  noun: 'Contact',
  label: 'New Contact',
  description: 'Triggers when a new contact is created.',
  inputFields: [],
  sample: { ...samples.newContactEvent, webhookEventId: samples.newMessageEvent.webhookEventId },
  outputFields: [...samples.contactEventOutputFields, samples.webhookEventIdField],
  poll: (client) => pollContacts(client),
});

const newMessage = hookTrigger({
  key: 'newMessage',
  event: 'newMessage',
  noun: 'Message',
  label: 'New Message',
  description:
    'Triggers when a customer sends a message in a conversation. The API key needs the chat:read scope.',
  inputFields: [
    boardField({
      required: false,
      helpText: 'Only messages of conversations linked to a card of this board. Leave empty for every message.',
    }),
  ],
  sample: samples.newMessageEvent,
  outputFields: samples.messageEventOutputFields,
});

module.exports = { newCardInstant, cardEnteredPhaseInstant, newContactInstant, newMessage, hookTrigger };
