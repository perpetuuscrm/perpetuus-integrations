import type { INodeType, INodeTypeDescription, IPollFunctions } from 'n8n-workflow';

import { getPhasesWithAny, searchBoards } from '../Perpetuus/methods';
import { MAIN, pollingTriggerProperties, pollTrigger } from '../PerpetuusTrigger/PollingTrigger';

/**
 * Polling fallback of the instant Perpetuus Trigger: Task Completed (no webhook event yet) and
 * n8n instances that Perpetuus cannot reach over HTTPS (localhost, private networks).
 */
export class PerpetuusPollingTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Perpetuus Polling Trigger',
		name: 'perpetuusPollingTrigger',
		icon: { light: 'file:../../icons/perpetuus.svg', dark: 'file:../../icons/perpetuus.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Starts the workflow when cards, contacts or tasks change in Perpetuus CRM',
		polling: true,
		inputs: [],
		outputs: [MAIN],
		credentials: [{ name: 'perpetuusApi', required: true }],
		defaults: { name: 'Perpetuus Polling Trigger' },
		properties: pollingTriggerProperties(
			'This trigger checks for changes on every poll. The first poll only marks the starting point; earlier records are not replayed. For instant cards, contacts and messages, use Perpetuus Trigger.',
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
