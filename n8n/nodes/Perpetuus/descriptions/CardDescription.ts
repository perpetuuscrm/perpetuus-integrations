import type { INodeProperties } from 'n8n-workflow';

import { boardLocator, cardLocator, contactLocator, returnAllAndLimit } from './common';

const show = (operation: string[]) => ({ show: { resource: ['card'], operation } });

export const cardOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['card'] } },
		options: [
			{
				name: 'Add Tags',
				value: 'addTags',
				description: 'Add tags to a card, keeping the tags it already has',
				action: 'Add tags to a card',
			},
			{
				name: 'Create',
				value: 'create',
				description: 'Create a card in a board',
				action: 'Create a card',
			},
			{
				name: 'Move to Phase',
				value: 'move',
				description: 'Move a card to another phase of its board',
				action: 'Move a card to a phase',
			},
			{
				name: 'Search',
				value: 'search',
				description: 'Find cards of a board by title, phase or contact',
				action: 'Search cards',
			},
		],
		default: 'create',
	},
];

export const cardFields: INodeProperties[] = [
	boardLocator(show(['create', 'move', 'addTags', 'search'])),

	// ─── create ──────────────────────────────────────────────────────────────
	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		required: true,
		default: '',
		description: 'Card title (the "name" field of the board form)',
		displayOptions: show(['create']),
	},
	contactLocator(show(['create']), {
		description: 'Contact to link to the card (optional)',
	}),
	{
		displayName: 'Custom Fields',
		name: 'fields',
		type: 'resourceMapper',
		noDataExpression: true,
		default: { mappingMode: 'defineBelow', value: null },
		description:
			'Values for the custom fields of the board. Required fields of the form phase must be filled.',
		typeOptions: {
			loadOptionsDependsOn: ['boardId.value'],
			resourceMapper: {
				resourceMapperMethod: 'getCardFields',
				mode: 'add',
				fieldWords: { singular: 'field', plural: 'fields' },
				addAllFields: false,
				multiKeyMatch: false,
				supportAutoMap: false,
			},
		},
		displayOptions: show(['create']),
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show(['create']),
		options: [
			{
				displayName: 'Assignee Names or IDs',
				name: 'assigneeIds',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getMembers', loadOptionsDependsOn: ['boardId.value'] },
				default: [],
				description:
					'People responsible for the card. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Description',
				name: 'description',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
			},
			{
				displayName: 'Due Date',
				name: 'dueDate',
				type: 'dateTime',
				default: '',
			},
			{
				displayName: 'Phase Name or ID',
				name: 'phaseId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getPhases', loadOptionsDependsOn: ['boardId.value'] },
				default: '',
				description:
					'Phase to place the card in. Cards start in the first workflow phase; when another phase is chosen, the card is moved right after creation. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Tag Names or IDs',
				name: 'tagIds',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getTags', loadOptionsDependsOn: ['boardId.value'] },
				default: [],
				description:
					'Tags of the board to apply. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Value',
				name: 'value',
				type: 'number',
				typeOptions: { minValue: 0, numberPrecision: 2 },
				default: 0,
				description: 'Deal value of the card',
			},
		],
	},

	// ─── move / addTags ──────────────────────────────────────────────────────
	cardLocator(show(['move', 'addTags'])),
	{
		displayName: 'Phase Name or ID',
		name: 'phaseId',
		type: 'options',
		required: true,
		typeOptions: { loadOptionsMethod: 'getPhases', loadOptionsDependsOn: ['boardId.value'] },
		default: '',
		description:
			'Phase to move the card to. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: show(['move']),
	},
	{
		displayName: 'Options',
		name: 'moveOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: show(['move']),
		options: [
			{
				displayName: 'Reason',
				name: 'reason',
				type: 'string',
				default: '',
				description: 'Reason saved in the card movement history',
			},
		],
	},
	{
		displayName: 'Tag Names or IDs',
		name: 'tagIds',
		type: 'multiOptions',
		required: true,
		typeOptions: { loadOptionsMethod: 'getTags', loadOptionsDependsOn: ['boardId.value'] },
		default: [],
		description:
			'Tags to add. Tags already on the card are kept. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: show(['addTags']),
	},

	// ─── search ──────────────────────────────────────────────────────────────
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: show(['search']),
		options: [
			{
				displayName: 'Contact ID',
				name: 'contactId',
				type: 'string',
				default: '',
				description: 'Only cards linked to this contact (documentId, e.g. from Contact → Search)',
			},
			{
				displayName: 'Phase Name or ID',
				name: 'phaseId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getPhases', loadOptionsDependsOn: ['boardId.value'] },
				default: '',
				description:
					'Only cards currently in this phase. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Title Contains',
				name: 'query',
				type: 'string',
				default: '',
				description: 'Text contained in the card title (case-insensitive)',
			},
		],
	},
	...returnAllAndLimit(show(['search'])),
];
