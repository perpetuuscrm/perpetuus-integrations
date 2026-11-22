'use strict';

/**
 * Pluga Actions (docs/v1-contract.md §6). Keys use the v1 input names (camelCase).
 *
 * - `configuration_fields`: chosen once when the user sets up the automation (Board, Phase…).
 * - `fields`: mapped from the trigger app on every run. Create Card adds the custom fields of
 *   the Board as `fields.<slug>` when Pluga passes the Board (`?boardId=`) to /fields.
 */
const ops = require('./perpetuus/operations');
const { t } = require('./i18n');
const { AdapterError, ApiError } = require('./errors');
const { forPluga } = require('./output');
const { CARD_ATTRIBUTES, CONTACT_ATTRIBUTES, UPSERT_EXTRA_ATTRIBUTES, TASK_ATTRIBUTES, fieldAttributes } = require('./attributes');

// ─── Field builders ─────────────────────────────────────────────────────────

const field = (key, ptBR, en, type, required = false, description) => ({
  key,
  name: t(ptBR, en),
  ...(description ? { description: t(description[0], description[1]) } : {}),
  required,
  type,
});

const dynamic = (key, ptBR, en, helperId, { required = false, multiple = false, dependsOn, description } = {}) => ({
  key,
  name: t(ptBR, en),
  ...(description ? { description: t(description[0], description[1]) } : {}),
  required,
  type: multiple ? 'dropdown_multiple' : 'dropdown',
  helper_id: helperId,
  ...(dependsOn ? { depends_on: dependsOn } : {}),
});

const staticDropdown = (key, ptBR, en, options, required = false) => ({
  key,
  name: t(ptBR, en),
  required,
  type: 'dropdown',
  options: options.map(([value, pt, enLabel]) => ({ label: t(pt, enLabel), value })),
});

const BOARD = dynamic('boardId', 'Board', 'Board', 'boards_list', {
  required: true,
  description: ['Board do Perpetuus onde o Card fica.', 'Perpetuus Board that holds the Card.'],
});

const CARD_ID = field('cardId', 'ID do Card', 'Card ID', 'string', true, [
  'documentId do Card (por exemplo, o campo "cardId" de um gatilho do Perpetuus).',
  'Card documentId (for example the "cardId" attribute of a Perpetuus trigger).',
]);

// ─── Custom fields of a Board (Create Card) ────────────────────────────────

const DECIMAL_TYPES = ['number', 'currency'];
const DATE_TYPES = ['date', 'datetime'];
const LIST_TYPES = ['multiselect', 'text_list', 'url_list'];
const BOOLEAN_TYPES = ['switch', 'checkbox'];

function customFieldDefinition(def) {
  const key = `fields.${def.slug}`;
  const name = { pt_BR: def.label, en: def.label };
  const description = { pt_BR: `Campo "${def.label}" (fase ${def.phaseName}).`, en: `Field "${def.label}" (phase ${def.phaseName}).` };
  const base = { key, name, description, required: def.requiredOnCreate };
  if (BOOLEAN_TYPES.includes(def.type)) {
    return { ...base, type: 'dropdown', options: [{ label: t('Sim', 'Yes'), value: 'true' }, { label: t('Não', 'No'), value: 'false' }] };
  }
  if (def.options.length && (def.type === 'multiselect' || def.type === 'select' || def.type === 'radio')) {
    return {
      ...base,
      type: def.type === 'multiselect' ? 'dropdown_multiple' : 'dropdown',
      options: def.options.map((o) => ({ label: { pt_BR: o.name, en: o.name }, value: o.value })),
    };
  }
  if (DECIMAL_TYPES.includes(def.type)) return { ...base, type: 'decimal' };
  if (DATE_TYPES.includes(def.type)) return { ...base, type: 'datetime' };
  if (def.type === 'textarea' || def.type === 'long_text') return { ...base, type: 'textarea' };
  return { ...base, type: 'string' };
}

function coerceFieldValue(def, value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (!def) return value;
  if (DECIMAL_TYPES.includes(def.type)) {
    const parsed = Number(String(value).replace(',', '.'));
    if (!Number.isFinite(parsed)) throw new AdapterError(400, `Field "${def.slug}" must be a number.`);
    return parsed;
  }
  if (BOOLEAN_TYPES.includes(def.type)) return value === true || /^(true|1|sim|yes)$/i.test(String(value));
  if (LIST_TYPES.includes(def.type)) return ops.toList(value) || undefined;
  return value;
}

async function boardFieldDefinitions(client, boardId) {
  const structure = await ops.getBoardStructure(client, boardId, ['phases', 'fields']);
  return ops.cardFieldDefinitions(structure);
}

/** `{ fields: { slug: v } }` and `{ "fields.slug": v }` both arrive as a slug → value map. */
function customFieldsFrom(body) {
  const out = {};
  if (body.fields && typeof body.fields === 'object' && !Array.isArray(body.fields)) Object.assign(out, body.fields);
  for (const [key, value] of Object.entries(body)) {
    if (key.startsWith('fields.')) out[key.slice('fields.'.length)] = value;
  }
  return out;
}

function number(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(parsed)) throw new AdapterError(400, `${label} must be a number.`);
  return parsed;
}

const text = (value) => {
  if (value === undefined || value === null) return undefined;
  const out = String(value).trim();
  return out || undefined;
};

/**
 * Finds or creates the Card's contact by email/phone (POST /contacts/upsert). Without a contact
 * name, the upsert goes without `name` so an existing contact keeps its name; only when the API
 * answers that the name is required (new contact) it is retried with the Card title.
 */
async function linkContact(client, { email, phone, name, fallbackName }) {
  if (name) return ops.upsertContact(client, { email, phone, name });
  try {
    return await ops.upsertContact(client, { email, phone });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 400 || !/name/i.test(error.message)) throw error;
    return ops.upsertContact(client, { email, phone, name: fallbackName || email || phone });
  }
}

// ─── Actions ────────────────────────────────────────────────────────────────

const ACTIONS = {
  create_card: {
    manifest: {
      name: t('Criar Card', 'Create Card'),
      task_name: t('criar um Card no Perpetuus', 'create a Card in Perpetuus'),
      configuration_fields: [
        BOARD,
        dynamic('phaseId', 'Fase', 'Phase', 'phases_list', {
          dependsOn: ['boardId'],
          description: [
            'Opcional. Sem fase, o Card fica na fase inicial do Board. Com fase, o Card é criado e movido em seguida.',
            'Optional. Without a Phase the Card stays in the first Phase of the Board. With a Phase, the Card is created and then moved.',
          ],
        }),
      ],
    },
    fields: async (client, query) => {
      const base = [
        field('title', 'Título', 'Title', 'string', true),
        field('contactEmail', 'E-mail do contato', 'Contact email', 'string', false, [
          'Com e-mail ou telefone, o contato é encontrado ou criado e vinculado ao Card.',
          'With an email or phone, the contact is found or created and linked to the Card.',
        ]),
        field('contactPhone', 'Telefone do contato', 'Contact phone', 'string'),
        field('contactName', 'Nome do contato', 'Contact name', 'string'),
        field('contactId', 'ID do contato', 'Contact ID', 'string'),
        field('value', 'Valor', 'Value', 'decimal'),
        field('dueDate', 'Data de entrega', 'Due date', 'datetime'),
        field('description', 'Descrição', 'Description', 'textarea'),
        dynamic('tagIds', 'Tags', 'Tags', 'tags_list', { multiple: true, dependsOn: ['boardId'] }),
        dynamic('assigneeIds', 'Responsáveis', 'Assignees', 'members_list', { multiple: true, dependsOn: ['boardId'] }),
      ];
      const boardId = text(query.boardId ?? query.board_id);
      if (!boardId || !client) return base;
      const defs = await boardFieldDefinitions(client, boardId);
      return [...base, ...defs.map(customFieldDefinition)];
    },
    attributes: async (client, query) => {
      const boardId = text(query.boardId ?? query.board_id);
      return [...CARD_ATTRIBUTES, ...(boardId && client ? await fieldAttributes(client, boardId) : [])];
    },
    perform: async (client, body) => {
      const boardId = text(body.boardId);
      if (!boardId) throw new AdapterError(400, 'Choose the Board of the Card.');
      const raw = customFieldsFrom(body);
      let fields = {};
      if (Object.keys(raw).length) {
        const defs = await boardFieldDefinitions(client, boardId);
        const bySlug = new Map(defs.map((d) => [d.slug, d]));
        for (const [slug, value] of Object.entries(raw)) {
          const coerced = coerceFieldValue(bySlug.get(slug), value);
          if (coerced !== undefined) fields[slug] = coerced;
        }
      }
      let contactId = text(body.contactId);
      const email = text(body.contactEmail);
      const phone = text(body.contactPhone);
      if (!contactId && (email || phone)) {
        contactId = (await linkContact(client, { email, phone, name: text(body.contactName), fallbackName: text(body.title) })).id;
      }
      const card = await ops.createCard(client, {
        boardId,
        title: body.title,
        phaseId: body.phaseId,
        contactId,
        tagIds: body.tagIds,
        assigneeIds: body.assigneeIds,
        value: number(body.value, 'Value'),
        dueDate: body.dueDate,
        description: body.description,
        fields,
      });
      return card;
    },
  },

  move_card: {
    manifest: {
      name: t('Mover Card de Fase', 'Move Card to Phase'),
      task_name: t('mover um Card de Fase no Perpetuus', 'move a Card to another Phase in Perpetuus'),
      configuration_fields: [
        BOARD,
        dynamic('phaseId', 'Fase de destino', 'Target Phase', 'phases_list', { required: true, dependsOn: ['boardId'] }),
      ],
    },
    fields: async () => [CARD_ID, field('reason', 'Motivo', 'Reason', 'textarea')],
    attributes: async () => CARD_ATTRIBUTES,
    perform: (client, body) => ops.moveCard(client, body),
  },

  add_card_tags: {
    manifest: {
      name: t('Adicionar Tags ao Card', 'Add Tags to Card'),
      task_name: t('adicionar tags a um Card no Perpetuus', 'add tags to a Card in Perpetuus'),
      configuration_fields: [
        BOARD,
        dynamic('tagIds', 'Tags', 'Tags', 'tags_list', { required: true, multiple: true, dependsOn: ['boardId'] }),
      ],
    },
    fields: async () => [CARD_ID],
    attributes: async () => CARD_ATTRIBUTES,
    perform: (client, body) => ops.addCardTags(client, body),
  },

  upsert_contact: {
    manifest: {
      name: t('Criar ou atualizar Contato', 'Create or Update Contact'),
      task_name: t('criar ou atualizar um contato no Perpetuus', 'create or update a contact in Perpetuus'),
      configuration_fields: [],
    },
    fields: async () => [
      field('name', 'Nome', 'Name', 'string', false, ['Obrigatório quando o contato é novo.', 'Required when the contact is new.']),
      field('email', 'E-mail', 'Email', 'string', false, [
        'Informe e-mail ou telefone. O contato existente com o mesmo e-mail ou telefone é atualizado.',
        'Provide an email or a phone. An existing contact with the same email or phone is updated.',
      ]),
      field('phone', 'Telefone', 'Phone', 'string'),
      staticDropdown('contactType', 'Tipo', 'Type', [
        ['person', 'Pessoa', 'Person'],
        ['company', 'Empresa', 'Company'],
      ]),
      field('cpf', 'CPF', 'CPF', 'string'),
      field('cnpj', 'CNPJ', 'CNPJ', 'string'),
      field('address', 'Endereço', 'Address', 'string'),
      field('city', 'Cidade', 'City', 'string'),
      field('state', 'Estado', 'State', 'string'),
      field('country', 'País', 'Country', 'string'),
      field('postalCode', 'CEP', 'Postal code', 'string'),
    ],
    attributes: async () => [...CONTACT_ATTRIBUTES, ...UPSERT_EXTRA_ATTRIBUTES],
    perform: (client, body) => ops.upsertContact(client, body),
  },

  create_task: {
    manifest: {
      name: t('Criar Tarefa', 'Create Task'),
      task_name: t('criar uma tarefa no Perpetuus', 'create a task in Perpetuus'),
      configuration_fields: [
        dynamic('boardId', 'Board', 'Board', 'boards_list', {
          description: [
            'Board da tarefa quando ela não for de um Card específico.',
            'Board of the task when it is not tied to a specific Card.',
          ],
        }),
      ],
    },
    fields: async () => [
      field('name', 'Nome da tarefa', 'Task name', 'string', true),
      field('cardId', 'ID do Card', 'Card ID', 'string', false, [
        'Card da tarefa. Informe o Card ou escolha um Board.',
        'Card of the task. Provide the Card or choose a Board.',
      ]),
      field('description', 'Descrição', 'Description', 'textarea'),
      field('dueDate', 'Prazo', 'Due date', 'datetime'),
      staticDropdown('type', 'Tipo', 'Type', [
        ['follow-up', 'Follow-up', 'Follow-up'],
        ['reminder', 'Lembrete', 'Reminder'],
        ['action', 'Ação', 'Action'],
        ['other', 'Outro', 'Other'],
      ]),
      staticDropdown('priority', 'Prioridade', 'Priority', [
        ['low', 'Baixa', 'Low'],
        ['medium', 'Média', 'Medium'],
        ['high', 'Alta', 'High'],
        ['urgent', 'Urgente', 'Urgent'],
      ]),
    ],
    attributes: async () => TASK_ATTRIBUTES,
    perform: (client, body) => ops.createTask(client, body),
  },
};

async function performAction(id, client, body) {
  const action = ACTIONS[id];
  const result = await action.perform(client, body || {});
  return forPluga(result);
}

module.exports = { ACTIONS, performAction, customFieldDefinition, coerceFieldValue, customFieldsFrom };
