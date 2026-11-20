/**
 * Maps raw Perpetuus (Strapi) payloads to the flat, stable output objects of the v1 contract
 * (docs/v1-contract.md §4). Every key is always present; missing values become null.
 */

type Raw = Record<string, unknown>;

export interface Contact {
	[key: string]: unknown;
	id: string;
	name: string | null;
	email: string | null;
	phone: string | null;
	contactType: 'person' | 'company' | null;
	cpf: string | null;
	cnpj: string | null;
	address: string | null;
	city: string | null;
	state: string | null;
	country: string | null;
	postalCode: string | null;
	customFields: Record<string, unknown>;
	createdAt: string | null;
	updatedAt: string | null;
}

export interface UpsertedContact extends Contact {
	created: boolean;
	matchedBy: string | null;
	otherMatchIds: string[];
}

export interface Card {
	[key: string]: unknown;
	id: string;
	title: string | null;
	boardId: string | null;
	phaseId: string | null;
	phaseName: string | null;
	phaseEnteredAt: string | null;
	contactId: string | null;
	contactName: string | null;
	contactEmail: string | null;
	contactPhone: string | null;
	value: number | null;
	dueDate: string | null;
	description: string | null;
	tagIds: string[];
	tagNames: string[];
	fields: Record<string, unknown>;
	createdAt: string | null;
	updatedAt: string | null;
}

export interface Task {
	[key: string]: unknown;
	id: string;
	name: string | null;
	description: string | null;
	type: string | null;
	priority: string | null;
	status: string | null;
	dueDate: string | null;
	completedAt: string | null;
	cardId: string | null;
	cardTitle: string | null;
	assigneeIds: string[];
	createdAt: string | null;
	updatedAt: string | null;
}

function isObject(value: unknown): value is Raw {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** `{ data: {...} }` or the object itself. */
export function unwrapOne(payload: unknown): Raw | null {
	if (!isObject(payload)) return null;
	if (isObject(payload.data)) {
		const inner = payload.data;
		// Some routes double-wrap: { data: { data: {...} } }
		if (isObject(inner.data) && !('documentId' in inner)) return inner.data;
		return inner;
	}
	return payload;
}

/** `{ data: [...] }`, a plain array, or `{ data: { data: [...] } }`. */
export function unwrapList(payload: unknown): Raw[] {
	if (Array.isArray(payload)) return payload.filter(isObject);
	if (isObject(payload)) {
		if (Array.isArray(payload.data)) return payload.data.filter(isObject);
		if (isObject(payload.data) && Array.isArray(payload.data.data)) {
			return payload.data.data.filter(isObject);
		}
	}
	return [];
}

export function pageCountOf(payload: unknown): number | undefined {
	if (!isObject(payload) || !isObject(payload.meta) || !isObject(payload.meta.pagination)) {
		return undefined;
	}
	const value = Number(payload.meta.pagination.pageCount);
	return Number.isFinite(value) ? value : undefined;
}

function str(value: unknown): string | null {
	if (value === undefined || value === null || value === '') return null;
	return String(value);
}

function num(value: unknown): number | null {
	if (value === undefined || value === null || value === '') return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

/** documentId of a relation that may come populated (`{ documentId }`) or as a bare id. */
export function relationId(value: unknown): string | null {
	if (isObject(value)) return str(value.documentId);
	if (typeof value === 'string' && value) return value;
	return null;
}

function relationList(value: unknown): Raw[] {
	if (Array.isArray(value)) return value.filter(isObject);
	if (isObject(value) && Array.isArray(value.data)) return value.data.filter(isObject);
	return [];
}

export function contactTypeFromApi(value: unknown): 'person' | 'company' | null {
	// The REST API stores pessoa/empresa; webhook samples may already use person/company.
	if (value === 'pessoa' || value === 'person') return 'person';
	if (value === 'empresa' || value === 'company') return 'company';
	return null;
}

export function contactTypeToApi(value: unknown): 'pessoa' | 'empresa' | undefined {
	if (value === 'person') return 'pessoa';
	if (value === 'company') return 'empresa';
	return undefined;
}

function plainObject(value: unknown): Record<string, unknown> {
	return isObject(value) ? { ...value } : {};
}

export function toContact(raw: Raw): Contact {
	return {
		id: String(raw.documentId ?? ''),
		name: str(raw.name),
		email: str(raw.email),
		phone: str(raw.phone),
		contactType: contactTypeFromApi(raw.contact_type),
		cpf: str(raw.cpf),
		cnpj: str(raw.cnpj),
		address: str(raw.address),
		city: str(raw.city),
		state: str(raw.state),
		country: str(raw.country),
		postalCode: str(raw.postal_code),
		customFields: plainObject(raw.customFields),
		createdAt: str(raw.createdAt),
		updatedAt: str(raw.updatedAt),
	};
}

export function toUpsertedContact(payload: unknown): UpsertedContact {
	const contact = toContact(unwrapOne(payload) ?? {});
	const meta = isObject(payload) && isObject(payload.meta) ? payload.meta : {};
	const otherMatches = Array.isArray(meta.otherMatches) ? meta.otherMatches : [];
	return {
		...contact,
		created: meta.created === true,
		matchedBy: str(meta.matchedBy),
		otherMatchIds: otherMatches
			.map((entry) => relationId(entry))
			.filter((id): id is string => Boolean(id)),
	};
}

/** Field values are stored as `{ val: x }`; unwrap them. */
function unwrapFieldValue(value: unknown): unknown {
	if (isObject(value) && 'val' in value) return value.val;
	return value ?? null;
}

/** Builds the slug → value map from `fieldData[]` when the API did not send `fields`. */
export function flattenFieldData(fieldData: unknown): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const entry of relationList(fieldData)) {
		const field = entry.field;
		const slug = isObject(field) ? str(field.slug) : str(field);
		if (!slug) continue;
		out[slug] = unwrapFieldValue(entry.value);
	}
	return out;
}

export function toCard(raw: Raw, fallbackBoardId?: string): Card {
	const phase = isObject(raw.currentPhase) ? raw.currentPhase : undefined;
	const contact = isObject(raw.contact) ? raw.contact : undefined;
	const tags = relationList(raw.tags);
	const fields = isObject(raw.fields) ? { ...raw.fields } : flattenFieldData(raw.fieldData);
	return {
		id: String(raw.documentId ?? ''),
		title: str(raw.title),
		boardId: relationId(raw.board) ?? fallbackBoardId ?? null,
		phaseId: relationId(raw.currentPhase),
		phaseName: phase ? str(phase.name) : null,
		phaseEnteredAt: str(raw.currentPhaseEnteredAt),
		contactId: relationId(raw.contact),
		contactName: contact ? str(contact.name) : null,
		contactEmail: contact ? str(contact.email) : null,
		contactPhone: contact ? str(contact.phone) : null,
		value: num(raw.value),
		dueDate: str(raw.dueDate),
		description: str(raw.description),
		tagIds: tags.map((tag) => str(tag.documentId)).filter((id): id is string => Boolean(id)),
		tagNames: tags.map((tag) => str(tag.name)).filter((name): name is string => Boolean(name)),
		fields,
		createdAt: str(raw.createdAt),
		updatedAt: str(raw.updatedAt),
	};
}

export function toTask(raw: Raw, fallbackCardId?: string): Task {
	const card = isObject(raw.card) ? raw.card : undefined;
	return {
		id: String(raw.documentId ?? ''),
		name: str(raw.name),
		description: str(raw.description),
		type: str(raw.type),
		priority: str(raw.priority),
		status: str(raw.taskStatus),
		dueDate: str(raw.dueDate),
		completedAt: str(raw.completedAt),
		cardId: relationId(raw.card) ?? fallbackCardId ?? null,
		cardTitle: card ? str(card.title) : null,
		assigneeIds: relationList(raw.assignees)
			.map((member) => str(member.documentId))
			.filter((id): id is string => Boolean(id)),
		createdAt: str(raw.createdAt),
		updatedAt: str(raw.updatedAt),
	};
}

/**
 * Digits used to search a contact by phone with `quickSearch` (a `contains` match):
 * keeps only numbers and drops the 55 country code when the number has 12+ digits,
 * so `+55 (11) 99999-9999` matches a phone stored as `+5511999999999`.
 */
export function phoneSearchDigits(phone: string): string {
	const digits = phone.replace(/\D+/g, '');
	if (digits.length >= 12 && digits.startsWith('55')) return digits.slice(2);
	return digits;
}

/** Drops undefined, null, '' and empty arrays so optional inputs are never sent. */
export function compact<T extends Record<string, unknown>>(input: T): Partial<T> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input)) {
		if (value === undefined || value === null || value === '') continue;
		if (Array.isArray(value) && value.length === 0) continue;
		out[key] = value;
	}
	return out as Partial<T>;
}
