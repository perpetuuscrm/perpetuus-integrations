/**
 * Perpetuus operations of the v1 contract, independent of n8n so they can be unit tested
 * with a mocked HTTP client. Each function documents the REST calls it makes.
 */
import { CARD_POPULATE, MAX_PAGE_SIZE, NON_VALUE_FIELD_TYPES } from './constants';
import {
	compact,
	contactTypeToApi,
	pageCountOf,
	phoneSearchDigits,
	relationId,
	toCard,
	toContact,
	toTask,
	toUpsertedContact,
	unwrapList,
	unwrapOne,
	type Card,
	type Contact,
	type Task,
	type UpsertedContact,
} from './mappers';
import type { Query } from './query';
import type { ApiClient } from './transport';

const enc = encodeURIComponent;

export class PerpetuusInputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PerpetuusInputError';
	}
}

// ─── Pagination ──────────────────────────────────────────────────────────────

/**
 * Reads `{ data, meta.pagination }` pages until `limit` items (or every item when `limit`
 * is undefined) were collected.
 */
export async function paginate(
	client: ApiClient,
	path: string,
	query: Query,
	limit?: number,
): Promise<Array<Record<string, unknown>>> {
	const out: Array<Record<string, unknown>> = [];
	for (let page = 1; ; page++) {
		const remaining = limit === undefined ? MAX_PAGE_SIZE : limit - out.length;
		if (remaining <= 0) break;
		const pageSize = Math.min(MAX_PAGE_SIZE, remaining);
		const response = await client.request('GET', path, {
			query: { ...query, pagination: { page, pageSize } },
		});
		const items = unwrapList(response);
		out.push(...items);
		const pageCount = pageCountOf(response);
		if (items.length < pageSize) break;
		if (pageCount !== undefined && page >= pageCount) break;
	}
	return limit === undefined ? out : out.slice(0, limit);
}

// ─── Contacts ────────────────────────────────────────────────────────────────

export interface UpsertContactInput {
	email?: string;
	phone?: string;
	name?: string;
	matchBy?: Array<'email' | 'phone'>;
	contactType?: 'person' | 'company';
	cpf?: string;
	cnpj?: string;
	address?: string;
	city?: string;
	state?: string;
	country?: string;
	postalCode?: string;
	customFields?: Record<string, unknown>;
}

/** POST /contacts/upsert */
export async function upsertContact(
	client: ApiClient,
	input: UpsertContactInput,
): Promise<UpsertedContact> {
	const email = input.email?.trim();
	const phone = input.phone?.trim();
	if (!email && !phone) {
		throw new PerpetuusInputError('Provide an email or a phone to find or create the contact.');
	}
	const customFields =
		input.customFields && Object.keys(input.customFields).length ? input.customFields : undefined;
	const data = compact({
		name: input.name?.trim(),
		email,
		phone,
		contact_type: contactTypeToApi(input.contactType),
		cpf: input.cpf,
		cnpj: input.cnpj,
		address: input.address,
		city: input.city,
		state: input.state,
		country: input.country,
		postal_code: input.postalCode,
		customFields,
	});
	const body: Record<string, unknown> = { data };
	if (input.matchBy?.length) body.matchBy = input.matchBy;
	const response = await client.request('POST', '/contacts/upsert', { body });
	return toUpsertedContact(response);
}

export interface FindContactsInput {
	searchBy: 'email' | 'phone' | 'text';
	value: string;
	/** undefined = every match */
	limit?: number;
}

/** GET /contacts with an exact email filter, a phone quickSearch or a text quickSearch. */
export async function findContacts(client: ApiClient, input: FindContactsInput): Promise<Contact[]> {
	const value = String(input.value ?? '').trim();
	if (!value) throw new PerpetuusInputError('Provide the value to search for.');
	let query: Query;
	if (input.searchBy === 'email') {
		query = { filters: { email: { $eqi: value } }, sort: 'createdAt:asc' };
	} else if (input.searchBy === 'phone') {
		const digits = phoneSearchDigits(value);
		if (!digits) throw new PerpetuusInputError('The phone must contain digits.');
		query = { quickSearch: digits, sort: 'createdAt:asc' };
	} else {
		query = { quickSearch: value, sort: 'updatedAt:desc' };
	}
	const items = await paginate(client, '/contacts', query, input.limit);
	return items.map(toContact);
}

// ─── Cards ───────────────────────────────────────────────────────────────────

/** GET /boards/{boardId}/cards/{cardId} with the standard card populate. */
export async function getCard(client: ApiClient, boardId: string, cardId: string): Promise<Card> {
	const response = await client.request('GET', `/boards/${enc(boardId)}/cards/${enc(cardId)}`, {
		query: { populate: CARD_POPULATE },
	});
	const raw = unwrapOne(response);
	if (!raw) throw new PerpetuusInputError(`Card ${cardId} was not returned by Perpetuus.`);
	return toCard(raw, boardId);
}

export interface CreateCardInput {
	boardId: string;
	title: string;
	phaseId?: string;
	contactId?: string;
	tagIds?: string[];
	value?: number;
	dueDate?: string;
	description?: string;
	assigneeIds?: string[];
	fields?: Record<string, unknown>;
}

export type CreatedCard = Card & { warning?: string };

/**
 * POST /boards/{boardId}/cards, then PUT currentPhase when `phaseId` differs from the
 * initial phase (the API always creates cards in the first workflow phase), then GET.
 */
export async function createCard(client: ApiClient, input: CreateCardInput): Promise<CreatedCard> {
	const boardId = input.boardId;
	const title = String(input.title ?? '').trim();
	if (!boardId) throw new PerpetuusInputError('Choose the board of the card.');
	if (!title) throw new PerpetuusInputError('The card title is required.');

	const fields: Record<string, unknown> = {};
	for (const [slug, value] of Object.entries(input.fields ?? {})) {
		if (value === undefined || value === null || value === '') continue;
		fields[slug] = value;
	}
	fields.name = title;

	const data = compact({
		fields,
		contact: input.contactId,
		tags: input.tagIds,
		assignees: input.assigneeIds,
		value: input.value,
		dueDate: input.dueDate,
		description: input.description,
	});

	const created = unwrapOne(
		await client.request('POST', `/boards/${enc(boardId)}/cards`, { body: { data } }),
	);
	const cardId = created ? relationId(created.documentId) : null;
	if (!created || !cardId) {
		throw new PerpetuusInputError('Perpetuus did not return the created card.');
	}

	let warning: string | undefined;
	const initialPhaseId = relationId(created.currentPhase);
	if (input.phaseId && input.phaseId !== initialPhaseId) {
		try {
			await client.request('PUT', `/boards/${enc(boardId)}/cards/${enc(cardId)}`, {
				body: { data: { currentPhase: input.phaseId } },
			});
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			warning = `Card created in the initial phase, but moving it to phase ${input.phaseId} failed: ${reason}`;
		}
	}

	const card = await getCard(client, boardId, cardId);
	return warning ? { ...card, warning } : card;
}

export interface MoveCardInput {
	boardId: string;
	cardId: string;
	phaseId: string;
	reason?: string;
}

/** PUT /boards/{boardId}/cards/{cardId} with `currentPhase`, then GET. */
export async function moveCard(client: ApiClient, input: MoveCardInput): Promise<Card> {
	if (!input.phaseId) throw new PerpetuusInputError('Choose the phase to move the card to.');
	const data = compact({ currentPhase: input.phaseId, reason: input.reason?.trim() });
	await client.request('PUT', `/boards/${enc(input.boardId)}/cards/${enc(input.cardId)}`, {
		body: { data },
	});
	return getCard(client, input.boardId, input.cardId);
}

export interface AddCardTagsInput {
	boardId: string;
	cardId: string;
	tagIds: string[];
}

/**
 * The API replaces `tags` on PUT, so: GET the current tags, merge, PUT the union, GET.
 */
export async function addCardTags(client: ApiClient, input: AddCardTagsInput): Promise<Card> {
	const wanted = (input.tagIds ?? []).map((id) => String(id).trim()).filter(Boolean);
	if (!wanted.length) throw new PerpetuusInputError('Choose at least one tag to add.');
	const path = `/boards/${enc(input.boardId)}/cards/${enc(input.cardId)}`;
	const current = unwrapOne(await client.request('GET', path, { query: { populate: ['tags'] } }));
	const existing = unwrapList({ data: current?.tags })
		.map((tag) => relationId(tag.documentId))
		.filter((id): id is string => Boolean(id));
	const merged = [...existing];
	for (const id of wanted) if (!merged.includes(id)) merged.push(id);
	if (merged.length !== existing.length) {
		await client.request('PUT', path, { body: { data: { tags: merged } } });
	}
	return getCard(client, input.boardId, input.cardId);
}

export interface FindCardsInput {
	boardId: string;
	query?: string;
	phaseId?: string;
	contactId?: string;
	limit?: number;
}

/** GET /boards/{boardId}/cards filtered by title, phase and contact, newest update first. */
export async function findCards(client: ApiClient, input: FindCardsInput): Promise<Card[]> {
	if (!input.boardId) throw new PerpetuusInputError('Choose the board to search in.');
	const filters: Query = {};
	if (input.query?.trim()) filters.title = { $containsi: input.query.trim() };
	if (input.phaseId) filters.currentPhase = { documentId: { $eq: input.phaseId } };
	if (input.contactId) filters.contact = { documentId: { $eq: input.contactId } };
	const items = await paginate(
		client,
		`/boards/${enc(input.boardId)}/cards`,
		{ filters, sort: 'updatedAt:desc', stats: 'false', populate: CARD_POPULATE },
		input.limit,
	);
	return items.map((raw) => toCard(raw, input.boardId));
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export interface CreateTaskInput {
	name: string;
	boardId?: string;
	cardId?: string;
	description?: string;
	dueDate?: string;
	type?: string;
	priority?: string;
	status?: string;
	assigneeIds?: string[];
}

/** POST /tasks (the API takes the board from the card when a card is given). */
export async function createTask(client: ApiClient, input: CreateTaskInput): Promise<Task> {
	const name = String(input.name ?? '').trim();
	if (!name) throw new PerpetuusInputError('The task name is required.');
	if (!input.boardId && !input.cardId) {
		throw new PerpetuusInputError('Choose a board or a card for the task.');
	}
	const data = compact({
		name,
		card: input.cardId,
		board: input.cardId ? undefined : input.boardId,
		description: input.description,
		dueDate: input.dueDate,
		type: input.type,
		priority: input.priority,
		taskStatus: input.status,
		assignees: input.assigneeIds,
	});
	const response = await client.request('POST', '/tasks', { body: { data } });
	return toTask(unwrapOne(response) ?? {}, input.cardId);
}

// ─── Lookups for dropdowns ───────────────────────────────────────────────────

export interface NamedOption {
	name: string;
	value: string;
	description?: string;
}

/** GET /boards (sorted by name, optional name filter). */
export async function listBoards(client: ApiClient, filter?: string): Promise<NamedOption[]> {
	const query: Query = { sort: 'name:asc' };
	if (filter?.trim()) query.filters = { name: { $containsi: filter.trim() } };
	const items = await paginate(client, '/boards', query, 200);
	return items
		.map((board) => ({ name: String(board.name ?? board.documentId), value: String(board.documentId ?? '') }))
		.filter((option) => option.value);
}

export interface BoardPhase {
	id: string;
	name: string;
	order: number;
	kind: string | null;
	fields: BoardField[];
}

export interface BoardField {
	id: string;
	slug: string;
	label: string;
	type: string;
	required: boolean;
	options: Array<{ name: string; value: string }>;
}

export interface BoardStructure {
	phases: BoardPhase[];
	tags: NamedOption[];
}

function toOptions(raw: unknown): Array<{ name: string; value: string }> {
	if (!Array.isArray(raw)) return [];
	return raw
		.map((option) => {
			if (option && typeof option === 'object') {
				const entry = option as Record<string, unknown>;
				const value = entry.value ?? entry.label ?? entry.name;
				const name = entry.label ?? entry.name ?? entry.value;
				return value === undefined || value === null
					? null
					: { name: String(name), value: String(value) };
			}
			return option === undefined || option === null
				? null
				: { name: String(option), value: String(option) };
		})
		.filter((option): option is { name: string; value: string } => option !== null);
}

/** GET /boards/{boardId}/structure?include=phases,fields,tags */
export async function getBoardStructure(
	client: ApiClient,
	boardId: string,
	include: Array<'phases' | 'fields' | 'tags'> = ['phases', 'fields', 'tags'],
): Promise<BoardStructure> {
	const response = await client.request('GET', `/boards/${enc(boardId)}/structure`, {
		query: { include: include.join(',') },
	});
	const structure = unwrapOne(response) ?? {};
	const phases = unwrapList({ data: structure.phases })
		.map((phase) => ({
			id: String(phase.documentId ?? ''),
			name: String(phase.name ?? phase.documentId ?? ''),
			order: Number(phase.order ?? 0),
			kind: phase.kind === undefined || phase.kind === null ? null : String(phase.kind),
			fields: unwrapList({ data: phase.fields }).map((field) => ({
				id: String(field.documentId ?? ''),
				slug: String(field.slug ?? ''),
				label: String(field.label ?? field.slug ?? ''),
				type: String(field.type ?? 'text'),
				required: field.required === true,
				options: toOptions(field.options),
			})),
		}))
		.filter((phase) => phase.id)
		.sort((a, b) => a.order - b.order);
	const tags = unwrapList({ data: structure.tags })
		.map((tag) => ({ name: String(tag.name ?? tag.slug ?? tag.documentId), value: String(tag.documentId ?? '') }))
		.filter((tag) => tag.value);
	return { phases, tags };
}

export interface CardFieldDefinition extends BoardField {
	phaseName: string;
	/** Only fields of the form phase (order 0) are required on card creation. */
	requiredOnCreate: boolean;
}

/**
 * Custom fields a card can receive: every phase field with a value, except the title
 * (`name`, exposed as its own input). Duplicated slugs keep the first phase.
 */
export function cardFieldDefinitions(structure: BoardStructure): CardFieldDefinition[] {
	const seen = new Set<string>(['name']);
	const out: CardFieldDefinition[] = [];
	for (const phase of structure.phases) {
		for (const field of phase.fields) {
			if (!field.slug || seen.has(field.slug)) continue;
			if (NON_VALUE_FIELD_TYPES.includes(field.type)) continue;
			seen.add(field.slug);
			out.push({
				...field,
				phaseName: phase.name,
				requiredOnCreate: phase.order === 0 && field.required && field.type !== 'hidden',
			});
		}
	}
	return out;
}

/** Phase options; the form phase (order 0) is labeled so users know cards start after it. */
export function phaseOptions(structure: BoardStructure): NamedOption[] {
	return structure.phases.map((phase) => ({
		name: phase.order === 0 ? `${phase.name} (form)` : phase.name,
		value: phase.id,
	}));
}

/** GET /boards/{boardId}/members */
export async function listBoardMembers(client: ApiClient, boardId: string): Promise<NamedOption[]> {
	const response = (await client.request('GET', `/boards/${enc(boardId)}/members`)) as unknown;
	const list =
		response && typeof response === 'object' && Array.isArray((response as Record<string, unknown>).members)
			? ((response as Record<string, unknown>).members as Array<Record<string, unknown>>)
			: unwrapList(response);
	return list
		.map((member) => {
			const user = (member.user && typeof member.user === 'object' ? member.user : {}) as Record<string, unknown>;
			const label = member.displayName ?? user.name ?? user.username ?? user.email ?? member.documentId;
			return {
				name: String(label),
				value: String(member.documentId ?? ''),
				description: user.email ? String(user.email) : undefined,
			};
		})
		.filter((option) => option.value);
}

/** Cards of a board for a searchable list (title contains `filter`). */
export async function searchCardOptions(
	client: ApiClient,
	boardId: string,
	filter?: string,
): Promise<NamedOption[]> {
	const filters: Query = {};
	if (filter?.trim()) filters.title = { $containsi: filter.trim() };
	const response = await client.request('GET', `/boards/${enc(boardId)}/cards`, {
		query: {
			filters,
			sort: 'updatedAt:desc',
			stats: 'false',
			populate: { currentPhase: true },
			pagination: { page: 1, pageSize: 50 },
		},
	});
	return unwrapList(response).map((card) => {
		const phase = card.currentPhase as Record<string, unknown> | undefined;
		return {
			name: String(card.title ?? card.documentId),
			value: String(card.documentId ?? ''),
			description: phase?.name ? String(phase.name) : undefined,
		};
	});
}

/** Contacts for a searchable list (quickSearch over name, email, phone, CPF, CNPJ). */
export async function searchContactOptions(client: ApiClient, filter?: string): Promise<NamedOption[]> {
	const response = await client.request('GET', '/contacts', {
		query: {
			quickSearch: filter?.trim() || undefined,
			sort: 'updatedAt:desc',
			pagination: { page: 1, pageSize: 50 },
		},
	});
	return unwrapList(response).map((contact) => {
		const name = String(contact.name ?? contact.documentId);
		return {
			name: contact.email ? `${name} (${String(contact.email)})` : name,
			value: String(contact.documentId ?? ''),
		};
	});
}
