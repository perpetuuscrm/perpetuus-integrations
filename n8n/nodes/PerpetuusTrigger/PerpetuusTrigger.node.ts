import type { INodeTypeBaseDescription, IVersionedNodeType } from 'n8n-workflow';
import { VersionedNodeType } from 'n8n-workflow';

import { ICON } from './PollingTrigger';
import { PerpetuusTriggerV1 } from './PerpetuusTriggerV1.node';
import { PerpetuusTriggerV2 } from './PerpetuusTriggerV2.node';

/**
 * Perpetuus Trigger.
 * - v2 (default for new nodes): instant, on the Perpetuus webhooks.
 * - v1: polling, kept for workflows created with 0.1.x (n8n keeps each node on its version).
 */
export class PerpetuusTrigger extends VersionedNodeType {
	constructor() {
		const baseDescription: INodeTypeBaseDescription = {
			displayName: 'Perpetuus Trigger',
			name: 'perpetuusTrigger',
			icon: ICON,
			group: ['trigger'],
			description: 'Starts the workflow when cards, contacts or messages change in Perpetuus CRM',
			defaultVersion: 2,
		};

		const nodeVersions: IVersionedNodeType['nodeVersions'] = {
			1: new PerpetuusTriggerV1(),
			2: new PerpetuusTriggerV2(),
		};

		super(nodeVersions, baseDescription);
	}
}
