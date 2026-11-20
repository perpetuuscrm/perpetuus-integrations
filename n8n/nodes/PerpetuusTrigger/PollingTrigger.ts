import type {
	IDataObject,
	INodeExecutionData,
	INodeProperties,
	IPollFunctions,
	NodeConnectionType,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { getApiClient, toNodeError } from '../Perpetuus/GenericFunctions';
import { boardLocator } from '../Perpetuus/descriptions/common';
import {
	createTriggerSource,
	paramsKey,
	runPollCycle,
	type PollState,
	type TriggerEvent,
	type TriggerParams,
} from '../Perpetuus/shared/polling';

// Literal instead of NodeConnectionTypes.Main: n8n resolves `n8n-workflow` from
// ~/.n8n/nodes/node_modules first, and instances with an older copy there (left by
// community packages installed under n8n 1.x) have no NodeConnectionTypes export,
// which makes the constructor throw and n8n report "Class could not be found".
export const MAIN = 'main' as NodeConnectionType;

export const ICON = {
	light: 'file:../../icons/perpetuus.svg',
	dark: 'file:../../icons/perpetuus.dark.svg',
} as const;

/**
 * Parameters of the polling trigger. Used by Perpetuus Trigger v1 (workflows created before
 * the webhooks, kept as they are) and by the Perpetuus Polling Trigger node.
 */
export function pollingTriggerProperties(notice: string): INodeProperties[] {
	return [
		{
			displayName: 'Trigger On',
			name: 'event',
			type: 'options',
			noDataExpression: true,
			required: true,
			default: 'newCard',
			options: [
				{
					name: 'Card Entered Phase',
					value: 'cardEnteredPhase',
					description: 'A card entered a phase (including the initial phase of a new card)',
				},
				{
					name: 'New Card',
					value: 'newCard',
					description: 'A card was created in a board',
				},
				{
					name: 'New Contact',
					value: 'newContact',
					description: 'A contact was created',
				},
				{
					name: 'Task Completed',
					value: 'taskCompleted',
					description: 'A task was marked as completed',
				},
			],
		},
		boardLocator({ show: { event: ['newCard', 'cardEnteredPhase'] } }),
		boardLocator(
			{ show: { event: ['taskCompleted'] } },
			{
				required: false,
				description: 'Only tasks of this board. Empty watches every board you can access.',
			},
		),
		{
			displayName: 'Phase Name or ID',
			name: 'phaseId',
			type: 'options',
			typeOptions: {
				loadOptionsMethod: 'getPhasesWithAny',
				loadOptionsDependsOn: ['boardId.value'],
			},
			default: '',
			description:
				'Only cards entering this phase. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			displayOptions: { show: { event: ['cardEnteredPhase'] } },
		},
		{
			displayName: notice,
			name: 'pollingNotice',
			type: 'notice',
			default: '',
		},
	];
}

export async function pollTrigger(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
	const event = this.getNodeParameter('event') as TriggerEvent;
	const params: TriggerParams = { event };
	if (event !== 'newContact') {
		const board = this.getNodeParameter('boardId', '', { extractValue: true });
		params.boardId = typeof board === 'string' ? board.trim() : undefined;
	}
	if (event === 'cardEnteredPhase') {
		params.phaseId = (this.getNodeParameter('phaseId', '') as string) || undefined;
	}
	if ((event === 'newCard' || event === 'cardEnteredPhase') && !params.boardId) {
		throw new NodeOperationError(this.getNode(), 'Choose the board to watch.');
	}

	try {
		const client = await getApiClient(this);
		const source = createTriggerSource(client, params);

		if (this.getMode() === 'manual') {
			const sample = await source.fetchLatest();
			if (!sample) {
				throw new NodeOperationError(
					this.getNode(),
					'No records found to use as a sample. Create one in Perpetuus and try again.',
				);
			}
			return [[{ json: sample.item as IDataObject }]];
		}

		const staticData = this.getWorkflowStaticData('node') as PollState & IDataObject;
		const { emitted, state } = await runPollCycle(source, staticData, paramsKey(params));
		staticData.initialized = state.initialized;
		staticData.key = state.key;
		staticData.cursor = state.cursor ?? null;
		staticData.seen = state.seen ?? [];

		if (!emitted.length) return null;
		return [emitted.map((entry) => ({ json: entry.item as IDataObject }))];
	} catch (error) {
		throw toNodeError(this.getNode(), error);
	}
}
