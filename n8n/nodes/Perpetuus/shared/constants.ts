export const DEFAULT_BASE_URL = 'https://api.perpetuus.com.br/api';

/** The API caps every page at 100 items. */
export const MAX_PAGE_SIZE = 100;

/** Pages read per polling cycle (5 x 100 = 500 events). Larger backlogs drain on the next polls. */
export const POLL_MAX_PAGES = 5;

/** Longest Retry-After (seconds) the connector waits for before giving up on a 429. */
export const MAX_RATE_LIMIT_WAIT_SECONDS = 60;

/** How many times a 429 is retried after waiting for Retry-After. */
export const MAX_RATE_LIMIT_RETRIES = 2;

/** Populate used for every card read, so every card output has the same shape. */
export const CARD_POPULATE = {
	contact: true,
	currentPhase: true,
	tags: true,
	fieldData: { populate: ['field'] },
};

/** Field types that are display-only on the board form and never carry a value. */
export const NON_VALUE_FIELD_TYPES = ['statement', 'whatsapp_link'];

export type RequiredScope = 'crm:read' | 'crm:write';
