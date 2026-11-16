import type { INodeProperties } from 'n8n-workflow';

import { returnAllAndLimit } from './common';

const show = (operation: string[]) => ({ show: { resource: ['contact'], operation } });

export const contactOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['contact'] } },
		options: [
			{
				name: 'Create or Update',
				value: 'upsert',
				description: 'Create a new record, or update the current one if it already exists (upsert)',
				action: 'Create or update a contact',
			},
			{
				name: 'Search',
				value: 'search',
				description: 'Find contacts by email, phone or text',
				action: 'Search contacts',
			},
		],
		default: 'upsert',
	},
];

export const contactFields: INodeProperties[] = [
	// ─── upsert ──────────────────────────────────────────────────────────────
	{
		displayName: 'Email',
		name: 'email',
		type: 'string',
		placeholder: 'name@email.com',
		default: '',
		description: 'Email of the contact. Provide an email, a phone or both.',
		displayOptions: show(['upsert']),
	},
	{
		displayName: 'Phone',
		name: 'phone',
		type: 'string',
		placeholder: '+55 11 99999-9999',
		default: '',
		description: 'Phone of the contact, in any Brazilian format. Provide an email, a phone or both.',
		displayOptions: show(['upsert']),
	},
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		default: '',
		description: 'Name of the contact. Required when the contact does not exist yet.',
		displayOptions: show(['upsert']),
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show(['upsert']),
		options: [
			{
				displayName: 'Address',
				name: 'address',
				type: 'string',
				default: '',
			},
			{
				displayName: 'City',
				name: 'city',
				type: 'string',
				default: '',
			},
			{
				displayName: 'CNPJ',
				name: 'cnpj',
				type: 'string',
				default: '',
				description: 'Brazilian company tax ID',
			},
			{
				displayName: 'Contact Type',
				name: 'contactType',
				type: 'options',
				options: [
					{ name: 'Person', value: 'person' },
					{ name: 'Company', value: 'company' },
				],
				default: 'person',
			},
			{
				displayName: 'Country',
				name: 'country',
				type: 'string',
				default: '',
			},
			{
				displayName: 'CPF',
				name: 'cpf',
				type: 'string',
				default: '',
				description: 'Brazilian individual tax ID',
			},
			{
				displayName: 'Custom Fields',
				name: 'customFields',
				type: 'fixedCollection',
				placeholder: 'Add Custom Field',
				typeOptions: { multipleValues: true },
				default: {},
				options: [
					{
						displayName: 'Field',
						name: 'field',
						values: [
							{
								displayName: 'Key',
								name: 'key',
								type: 'string',
								default: '',
								description: 'Key of the contact custom field, as configured in Perpetuus',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
							},
						],
					},
				],
			},
			{
				displayName: 'Match By',
				name: 'matchBy',
				type: 'multiOptions',
				options: [
					{ name: 'Email', value: 'email' },
					{ name: 'Phone', value: 'phone' },
				],
				default: ['email', 'phone'],
				description:
					'Keys used to find an existing contact, in this order. If several contacts match, the oldest is updated.',
			},
			{
				displayName: 'Postal Code',
				name: 'postalCode',
				type: 'string',
				default: '',
			},
			{
				displayName: 'State',
				name: 'state',
				type: 'string',
				default: '',
			},
		],
	},

	// ─── search ──────────────────────────────────────────────────────────────
	{
		displayName: 'Search By',
		name: 'searchBy',
		type: 'options',
		options: [
			{ name: 'Email', value: 'email', description: 'Exact email (case-insensitive)' },
			{ name: 'Phone', value: 'phone', description: 'Phone digits contained in the saved phone' },
			{
				name: 'Text',
				value: 'text',
				description: 'Text contained in the name, email, phone, CPF or CNPJ',
			},
		],
		default: 'email',
		displayOptions: show(['search']),
	},
	{
		displayName: 'Value',
		name: 'value',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'name@email.com',
		description: 'What to search for',
		displayOptions: show(['search']),
	},
	...returnAllAndLimit(show(['search'])),
];
