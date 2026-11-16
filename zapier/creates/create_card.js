'use strict';

const { createClient } = require('../lib/client');
const { CUSTOM_FIELD_PREFIX } = require('../lib/constants');
const {
  assigneesField,
  boardField,
  contactField,
  descriptionField,
  dueDateField,
  phaseField,
  tagsField,
} = require('../lib/fields');
const { cardFieldDefinitions, createCard, getBoardStructure } = require('../lib/operations');
const samples = require('../lib/samples');

/** Board field type → Zapier input field shape. */
function zapierFieldShape(field) {
  const choices = field.options.map((option) => ({
    value: option.value,
    label: option.name,
    sample: option.value,
  }));
  switch (field.type) {
    case 'number':
    case 'currency':
      return { type: 'number' };
    case 'date':
    case 'datetime':
      return { type: 'datetime' };
    case 'switch':
    case 'checkbox':
      return { type: 'boolean' };
    case 'select':
    case 'radio':
      return choices.length ? { type: 'string', choices } : { type: 'string' };
    case 'multiselect':
      return choices.length ? { type: 'string', list: true, choices } : { type: 'string', list: true };
    case 'text_list':
    case 'url_list':
    case 'file':
      return { type: 'string', list: true };
    case 'textarea':
    case 'long_text':
      return { type: 'text' };
    default:
      return { type: 'string' };
  }
}

/** Dynamic inputs: one `fields__<slug>` input per custom field of the selected board. */
const customFields = async (z, bundle) => {
  const boardId = String(bundle.inputData.boardId ?? '').trim();
  if (!boardId || boardId.includes('{{')) return [];
  let structure;
  try {
    structure = await getBoardStructure(createClient(z), boardId, ['phases', 'fields']);
  } catch (error) {
    // A board mapped from a previous step or deleted meanwhile: no dynamic fields.
    if (String(error.message).includes('"status":404')) return [];
    throw error;
  }
  return cardFieldDefinitions(structure).map((field) => ({
    key: `${CUSTOM_FIELD_PREFIX}${field.slug}`,
    label: field.label,
    required: field.requiredOnCreate,
    helpText: `Custom field \`${field.slug}\` of the phase "${field.phaseName}".`,
    ...zapierFieldShape(field),
  }));
};

/** Collects `fields` (dict) and the `fields__<slug>` inputs into one slug → value map. */
function collectFields(inputData) {
  const fields = {};
  if (inputData.fields && typeof inputData.fields === 'object' && !Array.isArray(inputData.fields)) {
    Object.assign(fields, inputData.fields);
  }
  for (const [key, value] of Object.entries(inputData)) {
    if (key.startsWith(CUSTOM_FIELD_PREFIX)) fields[key.slice(CUSTOM_FIELD_PREFIX.length)] = value;
  }
  return fields;
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

const perform = (z, bundle) => {
  const input = bundle.inputData;
  return createCard(createClient(z), {
    boardId: input.boardId,
    title: input.title,
    phaseId: input.phaseId,
    contactId: input.contactId,
    tagIds: input.tagIds,
    value: toNumber(input.value),
    dueDate: input.dueDate,
    description: input.description,
    assigneeIds: input.assigneeIds,
    fields: collectFields(input),
  });
};

module.exports = {
  key: 'createCard',
  noun: 'Card',
  display: {
    label: 'Create Card',
    description: 'Creates a new card in a board, optionally linked to a contact.',
  },
  operation: {
    inputFields: [
      boardField({ altersDynamicFields: true, helpText: 'The board to create the card in.' }),
      {
        key: 'title',
        label: 'Title',
        type: 'string',
        required: true,
        helpText: 'Card title. It is saved as the `name` field of the board form.',
      },
      phaseField({
        helpText:
          'Phase to place the card in. Cards start in the first workflow phase; when another phase is chosen, the card is moved right after it is created.',
      }),
      contactField({ helpText: 'Contact to link to the card.' }),
      tagsField(),
      {
        key: 'value',
        label: 'Value',
        type: 'number',
        required: false,
        helpText: 'Deal value of the card, such as 1500.50.',
      },
      dueDateField(),
      descriptionField(),
      assigneesField(),
      {
        key: 'fields',
        label: 'Other Custom Fields',
        dict: true,
        required: false,
        helpText:
          'Custom fields by slug, for fields not listed above (for example when the board comes from a previous step).',
      },
      customFields,
    ],
    perform,
    sample: samples.card,
    outputFields: [...samples.cardOutputFields, { key: 'warning', label: 'Warning' }],
  },
};
