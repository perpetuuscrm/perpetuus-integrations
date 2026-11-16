import type {
	FieldType,
	ILoadOptionsFunctions,
	INodeListSearchResult,
	INodePropertyOptions,
	ResourceMapperField,
	ResourceMapperFields,
} from 'n8n-workflow';

import { getApiClient, toNodeError } from './GenericFunctions';
import {
	cardFieldDefinitions,
	getBoardStructure,
	listBoardMembers,
	listBoards,
	phaseOptions,
	searchCardOptions,
	searchContactOptions,
	type CardFieldDefinition,
} from './shared/operations';

function currentBoardId(context: ILoadOptionsFunctions): string {
	const value = context.getCurrentNodeParameter('boardId', { extractValue: true });
	return typeof value === 'string' ? value.trim() : '';
}

async function guard<T>(context: ILoadOptionsFunctions, run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (error) {
		throw toNodeError(context.getNode(), error);
	}
}

// ─── listSearch (resource locators) ──────────────────────────────────────────

export async function searchBoards(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	return await guard(this, async () => {
		const client = await getApiClient(this);
		const boards = await listBoards(client, filter);
		return { results: boards.map((board) => ({ name: board.name, value: board.value })) };
	});
}

export async function searchCards(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const boardId = currentBoardId(this);
	if (!boardId) return { results: [] };
	return await guard(this, async () => {
		const client = await getApiClient(this);
		const cards = await searchCardOptions(client, boardId, filter);
		return { results: cards.map((card) => ({ name: card.name, value: card.value })) };
	});
}

export async function searchContacts(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	return await guard(this, async () => {
		const client = await getApiClient(this);
		const contacts = await searchContactOptions(client, filter);
		return { results: contacts.map((contact) => ({ name: contact.name, value: contact.value })) };
	});
}

// ─── loadOptions (dropdowns) ─────────────────────────────────────────────────

export async function getPhases(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const boardId = currentBoardId(this);
	if (!boardId) return [];
	return await guard(this, async () => {
		const client = await getApiClient(this);
		return phaseOptions(await getBoardStructure(client, boardId, ['phases']));
	});
}

export async function getPhasesWithAny(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const phases = await getPhases.call(this);
	return [{ name: 'Any Phase', value: '' }, ...phases];
}

export async function getTags(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const boardId = currentBoardId(this);
	if (!boardId) return [];
	return await guard(this, async () => {
		const client = await getApiClient(this);
		return (await getBoardStructure(client, boardId, ['tags'])).tags;
	});
}

export async function getMembers(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const boardId = currentBoardId(this);
	if (!boardId) return [];
	return await guard(this, async () => {
		const client = await getApiClient(this);
		return await listBoardMembers(client, boardId);
	});
}

// ─── resourceMapper (custom card fields) ─────────────────────────────────────

const FIELD_TYPES: Record<string, FieldType> = {
	number: 'number',
	currency: 'number',
	date: 'dateTime',
	datetime: 'dateTime',
	select: 'options',
	radio: 'options',
	multiselect: 'array',
	text_list: 'array',
	url_list: 'array',
	file: 'array',
	switch: 'boolean',
	checkbox: 'boolean',
};

export function toResourceMapperField(field: CardFieldDefinition): ResourceMapperField {
	const type = FIELD_TYPES[field.type] ?? 'string';
	return {
		id: field.slug,
		displayName: `${field.label} (${field.phaseName})`,
		required: field.requiredOnCreate,
		defaultMatch: false,
		display: true,
		type,
		canBeUsedToMatch: false,
		...(type === 'options' && field.options.length ? { options: field.options } : {}),
	};
}

export async function getCardFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
	const boardId = currentBoardId(this);
	if (!boardId) return { fields: [], emptyFieldsNotice: 'Choose a board first' };
	return await guard(this, async () => {
		const client = await getApiClient(this);
		const structure = await getBoardStructure(client, boardId, ['phases', 'fields']);
		const fields = cardFieldDefinitions(structure).map(toResourceMapperField);
		return {
			fields,
			emptyFieldsNotice: fields.length ? undefined : 'This board has no custom fields',
		};
	});
}
