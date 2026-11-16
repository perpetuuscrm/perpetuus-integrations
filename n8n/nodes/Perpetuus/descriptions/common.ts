import type { IDisplayOptions, INodeProperties } from 'n8n-workflow';

const ID_REGEX = '^[A-Za-z0-9_-]+$';

const idMode = (placeholder: string) => ({
	displayName: 'ID',
	name: 'id',
	type: 'string' as const,
	placeholder,
	validation: [
		{
			type: 'regex' as const,
			properties: { regex: ID_REGEX, errorMessage: 'Not a valid Perpetuus ID (documentId)' },
		},
	],
});

export function boardLocator(
	displayOptions: IDisplayOptions,
	options: { required?: boolean; description?: string } = {},
): INodeProperties {
	return {
		displayName: 'Board',
		name: 'boardId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: options.required ?? true,
		description: options.description ?? 'The board (pipeline) to use',
		displayOptions,
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: 'Select a board...',
				typeOptions: { searchListMethod: 'searchBoards', searchable: true },
			},
			idMode('e.g. k3j4h5g6f7d8s9a0b1c2d3e4'),
			{
				displayName: 'By URL',
				name: 'url',
				type: 'string',
				placeholder: 'https://app.perpetuus.com.br/boards/k3j4h5g6f7d8s9a0b1c2d3e4',
				extractValue: { type: 'regex', regex: 'boards/([A-Za-z0-9_-]+)' },
				validation: [
					{
						type: 'regex',
						properties: {
							regex: '.*boards/[A-Za-z0-9_-]+.*',
							errorMessage: 'Not a valid Perpetuus board URL',
						},
					},
				],
			},
		],
	};
}

export function cardLocator(displayOptions: IDisplayOptions, required = true): INodeProperties {
	return {
		displayName: 'Card',
		name: 'cardId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required,
		description: required ? 'The card to use' : 'Optional card to attach the task to',
		displayOptions,
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: 'Select a card...',
				typeOptions: { searchListMethod: 'searchCards', searchable: true },
			},
			idMode('e.g. c9d8e7f6a5b4c3d2e1f0a9b8'),
		],
	};
}

export function contactLocator(
	displayOptions: IDisplayOptions,
	options: { name?: string; displayName?: string; description?: string } = {},
): INodeProperties {
	return {
		displayName: options.displayName ?? 'Contact',
		name: options.name ?? 'contactId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		description: options.description ?? 'Contact to link',
		displayOptions,
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: 'Select a contact...',
				typeOptions: { searchListMethod: 'searchContacts', searchable: true },
			},
			idMode('e.g. ct1a2b3c4d5e6f7a8b9c0d1e'),
		],
	};
}

export function returnAllAndLimit(displayOptions: IDisplayOptions): INodeProperties[] {
	return [
		{
			displayName: 'Return All',
			name: 'returnAll',
			type: 'boolean',
			default: false,
			description: 'Whether to return all results or only up to a given limit',
			displayOptions,
		},
		{
			displayName: 'Limit',
			name: 'limit',
			type: 'number',
			default: 50,
			typeOptions: { minValue: 1, maxValue: 100 },
			description: 'Max number of results to return',
			displayOptions: { show: { ...displayOptions.show, returnAll: [false] } },
		},
	];
}
