'use strict';

/**
 * Pluga Triggers of type `rest_hook` on Perpetuus webhooks v1 (docs/v1-contract.md §5.7–5.9).
 * Output = the same flat objects as the Zapier/Make/n8n instant triggers, with lists as text.
 */
const { t } = require('./i18n');
const { AdapterError } = require('./errors');
const { forPluga } = require('./output');
const webhooks = require('./perpetuus/webhooks');
const { unwrapList } = require('./perpetuus/mappers');
const { CARD_POPULATE } = require('./perpetuus/constants');
const relay = require('./relay');
const { CARD_ATTRIBUTES, CONTACT_ATTRIBUTES, EVENT_ATTRIBUTES, MESSAGE_ATTRIBUTES, fieldAttributes } = require('./attributes');
const { APP_NAME } = require('./manifest');

const a = (key, ptBR, en) => ({ key, name: t(ptBR, en) });

const boardField = (required) => ({
  key: 'boardId',
  name: t('Board', 'Board'),
  description: required
    ? t('Board do Perpetuus a acompanhar.', 'Perpetuus Board to watch.')
    : t('Opcional: só conversas ligadas a um Card deste Board.', 'Optional: only conversations linked to a Card of this Board.'),
  required,
  type: 'dropdown',
  helper_id: 'boards_list',
});

const WEBHOOK_CONFIGURATION = { message_type: 'object', message_filters: [] };

const TRIGGERS = {
  card_created: {
    event: 'newCard',
    boardRequired: true,
    manifest: {
      name: t('Card criado', 'Card created'),
      task_name: t(`Quando um Card for criado no ${APP_NAME}`, `When a Card is created in ${APP_NAME}`),
      type: 'rest_hook',
      configuration_fields: [boardField(true)],
      unique_keys: ['eventId'],
      webhook_configuration: WEBHOOK_CONFIGURATION,
    },
    attributes: async (client, query) => [
      ...EVENT_ATTRIBUTES,
      a('cardId', 'ID do Card', 'Card ID'),
      ...CARD_ATTRIBUTES.filter((attr) => attr.key !== 'id'),
      ...(await boardFields(client, query)),
    ],
  },

  card_entered_phase: {
    event: 'cardEnteredPhase',
    boardRequired: true,
    manifest: {
      name: t('Card entrou em uma Fase', 'Card entered a Phase'),
      task_name: t(`Quando um Card entrar em uma Fase no ${APP_NAME}`, `When a Card enters a Phase in ${APP_NAME}`),
      type: 'rest_hook',
      configuration_fields: [
        boardField(true),
        {
          key: 'phaseId',
          name: t('Fase', 'Phase'),
          description: t(
            'Opcional: só Cards que entrarem nesta Fase (movidos ou criados nela). Vazio: qualquer Fase.',
            'Optional: only Cards that enter this Phase (moved or created in it). Empty: any Phase.',
          ),
          required: false,
          type: 'dropdown',
          helper_id: 'phases_list',
          depends_on: ['boardId'],
        },
      ],
      unique_keys: ['eventId'],
      webhook_configuration: WEBHOOK_CONFIGURATION,
    },
    attributes: async (client, query) => [
      ...EVENT_ATTRIBUTES,
      a('cardId', 'ID do Card', 'Card ID'),
      ...CARD_ATTRIBUTES.filter((attr) => attr.key !== 'id'),
      a('previousPhaseId', 'ID da Fase anterior', 'Previous Phase ID'),
      a('previousPhaseName', 'Fase anterior', 'Previous Phase'),
      ...(await boardFields(client, query)),
    ],
  },

  contact_created: {
    event: 'newContact',
    boardRequired: false,
    manifest: {
      name: t('Contato criado', 'Contact created'),
      task_name: t(`Quando um contato for criado no ${APP_NAME}`, `When a contact is created in ${APP_NAME}`),
      type: 'rest_hook',
      configuration_fields: [],
      unique_keys: ['eventId'],
      webhook_configuration: WEBHOOK_CONFIGURATION,
    },
    attributes: async () => [...EVENT_ATTRIBUTES, ...CONTACT_ATTRIBUTES.map((attr) => (attr.key === 'id' ? a('contactId', 'ID do contato', 'Contact ID') : attr))],
  },

  message_received: {
    event: 'newMessage',
    boardRequired: false,
    manifest: {
      name: t('Nova mensagem recebida', 'New message received'),
      task_name: t(`Quando uma mensagem for recebida no ${APP_NAME}`, `When a message is received in ${APP_NAME}`),
      type: 'rest_hook',
      configuration_fields: [boardField(false)],
      unique_keys: ['eventId'],
      webhook_configuration: WEBHOOK_CONFIGURATION,
    },
    attributes: async () => [...EVENT_ATTRIBUTES, ...MESSAGE_ATTRIBUTES],
  },
};

async function boardFields(client, query) {
  const boardId = String(query.boardId ?? query.board_id ?? '').trim();
  return boardId && client ? fieldAttributes(client, boardId) : [];
}

const text = (value) => {
  const out = String(value ?? '').trim();
  return out || undefined;
};

/** Flat Pluga object for one delivery, or undefined when the event does not match. */
function mapEvent(triggerId, envelope, { boardId, phaseId } = {}) {
  const trigger = TRIGGERS[triggerId];
  if (!trigger) return undefined;
  const result = webhooks.toWebhookResult(trigger.event, envelope, { boardId, phaseId });
  if (!result) return undefined;
  if (trigger.event === 'newContact') delete result.id;
  if (Array.isArray(result.attachments)) {
    result.attachmentUrls = result.attachments.map((entry) => entry.url).filter(Boolean);
  }
  const out = forPluga(result);
  // `id` is the eventId in the Zapier shape; Pluga dedupes on `eventId` (unique_keys).
  delete out.id;
  return out;
}

// ─── Sample (real data first, API samples as fallback) ─────────────────────

async function sample(triggerId, client, query) {
  const trigger = TRIGGERS[triggerId];
  const now = new Date().toISOString();
  let boardId = text(query.boardId ?? query.board_id);
  const phaseId = text(query.phaseId ?? query.phase_id);
  let envelope;

  if (trigger.event === 'newCard' || trigger.event === 'cardEnteredPhase') {
    if (!boardId) {
      const boards = unwrapList(await client.request('GET', '/boards', { query: { sort: 'name:asc', pagination: { page: 1, pageSize: 1 } } }));
      boardId = boards[0] ? String(boards[0].documentId) : undefined;
    }
    if (boardId) {
      const filters = phaseId && trigger.event === 'cardEnteredPhase' ? { currentPhase: { documentId: { $eq: phaseId } } } : {};
      const cards = unwrapList(
        await client.request('GET', `/boards/${encodeURIComponent(boardId)}/cards`, {
          query: { filters, sort: 'createdAt:desc', stats: 'false', populate: CARD_POPULATE, pagination: { page: 1, pageSize: 1 } },
        }),
      );
      if (cards[0]) envelope = { id: null, type: 'card.created', timestamp: now, data: { board: { documentId: boardId }, ...cards[0] } };
    }
  } else if (trigger.event === 'newContact') {
    const contacts = unwrapList(await client.request('GET', '/contacts', { query: { sort: 'createdAt:desc', pagination: { page: 1, pageSize: 1 } } }));
    if (contacts[0]) envelope = { id: null, type: 'contact.created', timestamp: now, data: contacts[0] };
  }

  if (!envelope) {
    const type = { newCard: 'card.created', cardEnteredPhase: 'card.phase_changed', newContact: 'contact.created', newMessage: 'message.received' }[trigger.event];
    const samples = await webhooks.fetchSamples(client, type);
    envelope = { id: 'evt_sample', type, timestamp: now, data: samples[0] || {} };
    return mapEvent(triggerId, envelope, {}) || {};
  }
  return mapEvent(triggerId, envelope, { boardId }) || {};
}

// ─── Subscribe / unsubscribe ───────────────────────────────────────────────

async function subscribe(triggerId, client, body, config) {
  const trigger = TRIGGERS[triggerId];
  if (!config.relayKey) throw new AdapterError(500, 'The adapter is not configured (RELAY_KEY).');
  let target;
  try {
    target = await relay.assertTargetAllowed(body.url, config.allowedTargetHosts, config.lookup);
  } catch (error) {
    throw new AdapterError(400, error.message);
  }
  const boardId = text(body.boardId ?? body.board_id);
  const phaseId = text(body.phaseId ?? body.phase_id);
  if (trigger.boardRequired && !boardId) throw new AdapterError(400, 'Choose the Board to watch (boardId is missing).');

  const context = { u: target, t: triggerId, b: boardId || null, p: phaseId || null };
  const relayUrl = (payload) => `${config.publicBaseUrl}/relay/${relay.seal(config.relayKey, payload)}`;

  // The signing secret only exists after the subscription is created, so register first
  // and then point the subscription at a token that also carries the secret.
  const subscription = await webhooks.subscribe(client, {
    url: relayUrl(context),
    event: trigger.event,
    boardId,
    description: `Pluga: ${trigger.manifest.name.en}`,
  });
  try {
    await client.request('PATCH', `/webhook-subscriptions/${encodeURIComponent(subscription.id)}`, {
      body: { url: relayUrl({ ...context, s: subscription.secret }) },
    });
  } catch (error) {
    await webhooks.unsubscribe(client, subscription.id).catch(() => null);
    throw error;
  }
  return { id: subscription.id };
}

async function unsubscribe(client, webhookId) {
  await webhooks.unsubscribe(client, webhookId);
}

// ─── Delivery from Perpetuus ────────────────────────────────────────────────

/**
 * Handles POST /relay/<token>. The status returned to Perpetuus drives its retry policy:
 * 2xx done · 410 the API deletes the subscription · 429/5xx retried · other 4xx not retried.
 */
async function deliver({ token, headers, rawBody }, config, fetchImpl = globalThis.fetch) {
  if (!config.relayKey) return { status: 503, body: { message: 'Relay not configured.' } };
  const context = relay.open(config.relayKey, token);
  if (!context || !TRIGGERS[context.t]) return { status: 404, body: { message: 'Unknown relay.' } };
  if (!context.s) return { status: 503, body: { message: 'Subscription is still being set up.' } };

  const check = webhooks.verifySignature(context.s, headers, rawBody);
  if (!check.ok) return { status: 401, body: { message: `Invalid signature: ${check.reason}.` } };

  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { message: 'Body is not JSON.' } };
  }
  const envelope = webhooks.parseEnvelope(parsed);
  if (!envelope) return { status: 400, body: { message: 'Not a Perpetuus webhook envelope.' } };

  const event = mapEvent(context.t, envelope, { boardId: context.b, phaseId: context.p });
  if (!event) return { status: 200, body: { ignored: true } };

  try {
    await relay.assertTargetAllowed(context.u, config.allowedTargetHosts, config.lookup);
  } catch {
    return { status: 410, body: { message: 'Target no longer allowed.' } };
  }
  let response;
  try {
    response = await fetchImpl(context.u, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'perpetuus-pluga-adapter/1.0' },
      body: JSON.stringify(event),
      redirect: 'manual',
      signal: AbortSignal.timeout(config.relayTimeoutMs),
    });
  } catch {
    return { status: 502, body: { message: 'Pluga did not answer.' } };
  }
  if (response.status >= 200 && response.status < 300) return { status: 200, body: { delivered: true } };
  if (response.status === 410) return { status: 410, body: { message: 'Pluga removed the webhook.' } };
  if (response.status === 429 || response.status >= 500) return { status: 502, body: { message: `Pluga answered ${response.status}.` } };
  return { status: 400, body: { message: `Pluga answered ${response.status}.` } };
}

module.exports = { TRIGGERS, mapEvent, sample, subscribe, unsubscribe, deliver };
