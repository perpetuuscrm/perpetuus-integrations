import type { INodeProperties } from 'n8n-workflow';

import { boardLocator, cardLocator } from './common';

const show = (operation: string[]) => ({ show: { resource: ['task'], operation } });

export const taskOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['task'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a task in a board, optionally attached to a card',
				action: 'Create a task',
			},
		],
		default: 'create',
	},
];

export const taskFields: INodeProperties[] = [
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. Send the onboarding kit',
		description: 'What has to be done',
		displayOptions: show(['create']),
	},
	boardLocator(show(['create']), {
		description: 'Board of the task. When a card is chosen, the task goes to the card board.',
	}),
	cardLocator(show(['create']), false),
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
					'People responsible for the task (defaults to the API key owner). Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
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
				displayName: 'Priority',
				name: 'priority',
				type: 'options',
				options: [
					{ name: 'Low', value: 'low' },
					{ name: 'Medium', value: 'medium' },
					{ name: 'High', value: 'high' },
					{ name: 'Urgent', value: 'urgent' },
				],
				default: 'medium',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'string',
				default: '',
				placeholder: 'e.g. pending',
				description: 'Task status configured in the board. Empty uses the first status of the board.',
			},
			{
				displayName: 'Type',
				name: 'type',
				type: 'options',
				options: [
					{ name: 'Action', value: 'action' },
					{ name: 'Follow-Up', value: 'follow-up' },
					{ name: 'Other', value: 'other' },
					{ name: 'Reminder', value: 'reminder' },
				],
				default: 'follow-up',
			},
		],
	},
];
