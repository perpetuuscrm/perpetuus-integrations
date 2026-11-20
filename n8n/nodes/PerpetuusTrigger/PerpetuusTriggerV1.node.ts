import type { INodeType, INodeTypeDescription, IPollFunctions } from 'n8n-workflow';

import { getPhasesWithAny, searchBoards } from '../Perpetuus/methods';
import { MAIN, pollingTriggerProperties, pollTrigger } from './PollingTrigger';

/**
 * Perpetuus Trigger v1 (polling). Kept unchanged for workflows created before the webhooks:
 * same parameters, same output and the same polling state.
 */
export class PerpetuusTriggerV1 implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Perpetuus Trigger',
		name: 'perpetuusTrigger',
		icon: { light: 'file:../../icons/perpetuus.svg', dark: 'file:../../icons/perpetuus.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Starts the workflow when cards, contacts or tasks change in Perpetuus CRM',
		polling: true,
		inputs: [],
		outputs: [MAIN],
		credentials: [{ name: 'perpetuusApi', required: true }],
		defaults: { name: 'Perpetuus Trigger' },
		properties: pollingTriggerProperties(
			'This version checks for changes on every poll. New Perpetuus Trigger nodes are instant (webhooks); use the Perpetuus Polling Trigger node for Task Completed or when Perpetuus cannot reach your n8n.',
		),
	};

	methods = {
		listSearch: { searchBoards },
		loadOptions: { getPhasesWithAny },
	};

	async poll(this: IPollFunctions) {
		return await pollTrigger.call(this);
	}
}
