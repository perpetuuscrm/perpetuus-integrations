'use strict';

const DEFAULT_BASE_URL = 'https://api.perpetuus.com.br/api';

/** The API caps every page at 100 items. */
const MAX_PAGE_SIZE = 100;

/** Default and maximum number of results read by a search (docs/v1-contract.md §7). */
const SEARCH_LIMIT = 50;

/** Page size of the hidden triggers that feed dynamic dropdowns. */
const DROPDOWN_PAGE_SIZE = 50;

/** Populate used for every card read, so every card output has the same shape. */
const CARD_POPULATE = {
  contact: true,
  currentPhase: true,
  tags: true,
  fieldData: { populate: ['field'] },
};

/** Field types that are display-only on the board form and never carry a value. */
const NON_VALUE_FIELD_TYPES = ['statement', 'whatsapp_link'];

/** Prefix of the dynamic custom-field inputs of Create Card (`fields__<slug>`). */
const CUSTOM_FIELD_PREFIX = 'fields__';

module.exports = {
  DEFAULT_BASE_URL,
  MAX_PAGE_SIZE,
  SEARCH_LIMIT,
  DROPDOWN_PAGE_SIZE,
  CARD_POPULATE,
  NON_VALUE_FIELD_TYPES,
  CUSTOM_FIELD_PREFIX,
};
