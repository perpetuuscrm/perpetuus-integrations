import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { getApiClient, toNodeError } from '../Perpetuus/GenericFunctions';
import { boardLocator } from '../Perpetuus/descriptions/common';
import { getPhasesWithAny, searchBoards } from '../Perpetuus/methods';
import {
	WEBHOOK_EVENTS,
	findSubscription,
	parseEnvelope,
	subscribe,
	toWebhookItem,
	unsubscribe,
	verifySignature,
	type WebhookTriggerEvent,
} from '../Perpetuus/shared/webhooks';
import { MAIN } from './PollingTrigger';

interface WebhookState extends IDataObject {
	webhookId?: string;
	webhookSecret?: string;
}

function boardParam(context: IHookFunctions | IWebhookFunctions): string | undefined {
	const event = context.getNodeParameter('event') as WebhookTriggerEvent;
	if (event === 'newContact') return undefined;
	const board = context.getNodeParameter('boardId', '', { extractValue: true });
	const value = typeof board === 'string' ? board.trim() : '';
	return value || undefined;
}

function sameEvents(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((event) => b.includes(event));
}

/**
 * Perpetuus Trigger v2: instant, on the Perpetuus webhooks. n8n subscribes when the workflow
 * is activated (or while listening for a test event) and deletes the subscription when it stops.
 */
export class PerpetuusTriggerV2 implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Perpetuus Trigger',
		name: 'perpetuusTrigger',
		icon: { light: 'file:../../icons/perpetuus.svg', dark: 'file:../../icons/perpetuus.dark.svg' },
		group: ['trigger'],
		description: 'Starts the workflow when cards, contacts or messages change in Perpetuus CRM',
		version: 2,
		subtitle: '={{$parameter["event"]}}',
		defaults: { name: 'Perpetuus Trigger' },
		inputs: [],
		outputs: [MAIN],
		credentials: [{ name: 'perpetuusApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
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
						name: 'New Message',
						value: 'newMessage',
						description:
							'A customer sent a message in a conversation (the API key needs the chat:read scope)',
					},
				],
			},
			boardLocator({ show: { event: ['newCard', 'cardEnteredPhase'] } }),
			boardLocator(
				{ show: { event: ['newMessage'] } },
				{
					required: false,
					description:
						'Only messages of conversations linked to a card of this board. Empty receives every message.',
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
				displayName:
					'Instant: Perpetuus sends each event to this workflow as it happens, signed with HMAC-SHA256. n8n must be reachable from the internet over HTTPS. For Task Completed, or an n8n that Perpetuus cannot reach, use the Perpetuus Polling Trigger node.',
				name: 'webhookNotice',
				type: 'notice',
				default: '',
			},
		],
	};

	methods = {
		listSearch: { searchBoards },
		loadOptions: { getPhasesWithAny },
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const state = this.getWorkflowStaticData('node') as WebhookState;
				if (!state.webhookId) return false;
				try {
					const client = await getApiClient(this);
					const subscription = await findSubscription(client, state.webhookId);
					const event = this.getNodeParameter('event') as WebhookTriggerEvent;
					const matches =
						subscription !== undefined &&
						subscription.url === this.getNodeWebhookUrl('default') &&
						sameEvents(subscription.events, WEBHOOK_EVENTS[event]) &&
						(subscription.boardId ?? undefined) === boardParam(this) &&
						subscription.status !== 'paused' &&
						Boolean(state.webhookSecret);
					if (matches) return true;
					// Parameters changed (or the subscription was paused): replace it.
					if (subscription) await unsubscribe(client, state.webhookId);
				} catch (error) {
					throw toNodeError(this.getNode(), error);
				}
				delete state.webhookId;
				delete state.webhookSecret;
				return false;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const event = this.getNodeParameter('event') as WebhookTriggerEvent;
				const boardId = boardParam(this);
				if ((event === 'newCard' || event === 'cardEnteredPhase') && !boardId) {
					throw new NodeOperationError(this.getNode(), 'Choose the board to watch.');
				}
				const url = this.getNodeWebhookUrl('default');
				if (!url)
					throw new NodeOperationError(this.getNode(), 'n8n did not provide a webhook URL.');
				try {
					const client = await getApiClient(this);
					const workflowName = String(this.getWorkflow().name ?? '').trim();
					const subscription = await subscribe(client, {
						url,
						event,
						boardId,
						origin: 'n8n',
						description: `n8n${workflowName ? `: ${workflowName}` : ''} (${event})`,
					});
					if (!subscription.secret) {
						// Without the signing secret no delivery could be verified: do not keep it.
						await unsubscribe(client, subscription.id).catch(() => undefined);
						throw new NodeOperationError(
							this.getNode(),
							'Perpetuus did not return the webhook signing secret.',
						);
					}
					const state = this.getWorkflowStaticData('node') as WebhookState;
					state.webhookId = subscription.id;
					state.webhookSecret = subscription.secret;
					return true;
				} catch (error) {
					throw toNodeError(this.getNode(), error);
				}
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const state = this.getWorkflowStaticData('node') as WebhookState;
				if (state.webhookId) {
					try {
						const client = await getApiClient(this);
						await unsubscribe(client, state.webhookId);
					} catch (error) {
						this.logger.warn(
							`Perpetuus Trigger: could not delete webhook subscription ${state.webhookId}: ${(error as Error).message}`,
						);
						return false;
					}
				}
				delete state.webhookId;
				delete state.webhookSecret;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const request = this.getRequestObject();
		const body = this.getBodyData();
		const state = this.getWorkflowStaticData('node') as WebhookState;

		// Every Perpetuus delivery is signed with the subscription secret. Without a stored secret
		// (or with an invalid signature) the request is rejected and the workflow does not start.
		const check = state.webhookSecret
			? verifySignature(
					state.webhookSecret,
					this.getHeaderData() as IDataObject,
					request.rawBody ? request.rawBody.toString('utf8') : JSON.stringify(body),
				)
			: ({
					ok: false,
					reason: 'no signing secret stored; deactivate and reactivate the workflow',
				} as const);
		if (!check.ok) {
			this.getResponseObject()
				.status(401)
				.json({ error: `Invalid Perpetuus signature: ${check.reason}` });
			return { noWebhookResponse: true };
		}

		const envelope = parseEnvelope(body);
		if (!envelope) return { webhookResponse: 'ignored' };
		const event = this.getNodeParameter('event') as WebhookTriggerEvent;
		const item = toWebhookItem(event, envelope, {
			boardId: boardParam(this),
			phaseId:
				event === 'cardEnteredPhase'
					? (this.getNodeParameter('phaseId', '') as string) || undefined
					: undefined,
		});
		// Pings, other events and other phases are acknowledged without starting the workflow.
		if (!item) return { webhookResponse: 'OK' };
		return { workflowData: [this.helpers.returnJsonArray([item as IDataObject])] };
	}
}
