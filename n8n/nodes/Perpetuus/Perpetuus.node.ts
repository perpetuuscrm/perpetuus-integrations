import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { cardFields, cardOperations } from './descriptions/CardDescription';
import { contactFields, contactOperations } from './descriptions/ContactDescription';
import { taskFields, taskOperations } from './descriptions/TaskDescription';
import { getApiClient, toNodeError } from './GenericFunctions';
import {
	getCardFields,
	getMembers,
	getPhases,
	getTags,
	searchBoards,
	searchCards,
	searchContacts,
} from './methods';
import { normalizeMappedFields, toDateString, toStringList } from './shared/inputs';
import {
	addCardTags,
	createCard,
	createTask,
	findCards,
	findContacts,
	moveCard,
	upsertContact,
	type UpsertContactInput,
} from './shared/operations';
import type { ApiClient } from './shared/transport';

/**
 * Programmatic style: several operations need more than one dependent API call (create card
 * then move it, read tags then merge them, then re-read the card for a stable output), and
 * the retry / Retry-After policy is shared with the trigger node.
 */
export class Perpetuus implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Perpetuus',
		name: 'perpetuus',
		icon: { light: 'file:../../icons/perpetuus.svg', dark: 'file:../../icons/perpetuus.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Manage contacts, cards and tasks in Perpetuus CRM',
		defaults: { name: 'Perpetuus' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'perpetuusApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Card', value: 'card' },
					{ name: 'Contact', value: 'contact' },
					{ name: 'Task', value: 'task' },
				],
				default: 'contact',
			},
			...contactOperations,
			...contactFields,
			...cardOperations,
			...cardFields,
			...taskOperations,
			...taskFields,
		],
	};

	methods = {
		listSearch: { searchBoards, searchCards, searchContacts },
		loadOptions: { getPhases, getTags, getMembers },
		resourceMapping: { getCardFields },
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		let client: ApiClient | undefined;

		for (let i = 0; i < items.length; i++) {
			try {
				client ??= await getApiClient(this);
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const results = await runOperation(this, client, resource, operation, i);
				for (const json of results) {
					returnData.push({ json: json as IDataObject, pairedItem: { item: i } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw toNodeError(this.getNode(), error, i);
			}
		}

		return [returnData];
	}
}

function locatorValue(context: IExecuteFunctions, name: string, i: number): string {
	const value = context.getNodeParameter(name, i, '', { extractValue: true });
	return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function limitOf(context: IExecuteFunctions, i: number): number | undefined {
	const returnAll = context.getNodeParameter('returnAll', i, false) as boolean;
	return returnAll ? undefined : (context.getNodeParameter('limit', i, 50) as number);
}

async function runOperation(
	context: IExecuteFunctions,
	client: ApiClient,
	resource: string,
	operation: string,
	i: number,
): Promise<Array<Record<string, unknown>>> {
	if (resource === 'contact' && operation === 'upsert') {
		const extra = context.getNodeParameter('additionalFields', i, {}) as IDataObject;
		const custom = (extra.customFields as IDataObject | undefined)?.field as
			| Array<{ key?: string; value?: string }>
			| undefined;
		const customFields: Record<string, unknown> = {};
		for (const entry of custom ?? []) {
			if (entry.key?.trim()) customFields[entry.key.trim()] = entry.value ?? '';
		}
		const input: UpsertContactInput = {
			email: context.getNodeParameter('email', i, '') as string,
			phone: context.getNodeParameter('phone', i, '') as string,
			name: context.getNodeParameter('name', i, '') as string,
			matchBy: extra.matchBy as UpsertContactInput['matchBy'],
			contactType: extra.contactType as UpsertContactInput['contactType'],
			cpf: extra.cpf as string | undefined,
			cnpj: extra.cnpj as string | undefined,
			address: extra.address as string | undefined,
			city: extra.city as string | undefined,
			state: extra.state as string | undefined,
			country: extra.country as string | undefined,
			postalCode: extra.postalCode as string | undefined,
			customFields,
		};
		return [await upsertContact(client, input)];
	}

	if (resource === 'contact' && operation === 'search') {
		return await findContacts(client, {
			searchBy: context.getNodeParameter('searchBy', i) as 'email' | 'phone' | 'text',
			value: context.getNodeParameter('value', i) as string,
			limit: limitOf(context, i),
		});
	}

	if (resource === 'card') {
		const boardId = locatorValue(context, 'boardId', i);

		if (operation === 'create') {
			const extra = context.getNodeParameter('additionalFields', i, {}) as IDataObject;
			const mapped = context.getNodeParameter('fields', i, {}) as IDataObject;
			const value = extra.value === undefined || extra.value === '' ? undefined : Number(extra.value);
			return [
				await createCard(client, {
					boardId,
					title: context.getNodeParameter('title', i) as string,
					contactId: locatorValue(context, 'contactId', i) || undefined,
					phaseId: (extra.phaseId as string) || undefined,
					tagIds: toStringList(extra.tagIds),
					assigneeIds: toStringList(extra.assigneeIds),
					value: value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined,
					dueDate: toDateString(extra.dueDate),
					description: (extra.description as string) || undefined,
					fields: normalizeMappedFields(mapped),
				}),
			];
		}

		if (operation === 'move') {
			const options = context.getNodeParameter('moveOptions', i, {}) as IDataObject;
			return [
				await moveCard(client, {
					boardId,
					cardId: locatorValue(context, 'cardId', i),
					phaseId: context.getNodeParameter('phaseId', i) as string,
					reason: (options.reason as string) || undefined,
				}),
			];
		}

		if (operation === 'addTags') {
			return [
				await addCardTags(client, {
					boardId,
					cardId: locatorValue(context, 'cardId', i),
					tagIds: toStringList(context.getNodeParameter('tagIds', i, [])) ?? [],
				}),
			];
		}

		if (operation === 'search') {
			const filters = context.getNodeParameter('filters', i, {}) as IDataObject;
			return await findCards(client, {
				boardId,
				query: (filters.query as string) || undefined,
				phaseId: (filters.phaseId as string) || undefined,
				contactId: (filters.contactId as string) || undefined,
				limit: limitOf(context, i),
			});
		}
	}

	if (resource === 'task' && operation === 'create') {
		const extra = context.getNodeParameter('additionalFields', i, {}) as IDataObject;
		return [
			await createTask(client, {
				name: context.getNodeParameter('name', i) as string,
				boardId: locatorValue(context, 'boardId', i) || undefined,
				cardId: locatorValue(context, 'cardId', i) || undefined,
				description: (extra.description as string) || undefined,
				dueDate: toDateString(extra.dueDate),
				type: (extra.type as string) || 'follow-up',
				priority: (extra.priority as string) || 'medium',
				status: (extra.status as string) || undefined,
				assigneeIds: toStringList(extra.assigneeIds),
			}),
		];
	}

	throw new NodeOperationError(
		context.getNode(),
		`The operation "${operation}" is not supported for the resource "${resource}".`,
		{ itemIndex: i },
	);
}
