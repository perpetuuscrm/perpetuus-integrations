import { describe, expect, it, vi } from 'vitest';

// Instances that installed community packages under n8n 1.x can have an old
// n8n-workflow in ~/.n8n/nodes/node_modules, which the community package then
// resolves instead of n8n's own copy. Those versions have no NodeConnectionTypes,
// so the node constructors must not read it (n8n reports "Class could not be found").
vi.mock('n8n-workflow', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	const legacy = { ...actual };
	delete legacy.NodeConnectionTypes;
	return legacy;
});

describe('loading against an n8n-workflow without NodeConnectionTypes', () => {
	it('constructs the Perpetuus, Perpetuus Trigger (v1 and v2) and Perpetuus Polling Trigger nodes', async () => {
		const { Perpetuus } = await import('../nodes/Perpetuus/Perpetuus.node');
		const { PerpetuusTrigger } = await import('../nodes/PerpetuusTrigger/PerpetuusTrigger.node');
		const { PerpetuusPollingTrigger } = await import(
			'../nodes/PerpetuusPollingTrigger/PerpetuusPollingTrigger.node'
		);
		expect(new Perpetuus().description.outputs).toEqual(['main']);
		expect(new Perpetuus().description.inputs).toEqual(['main']);
		const trigger = new PerpetuusTrigger();
		expect(trigger.getNodeType(1).description.outputs).toEqual(['main']);
		expect(trigger.getNodeType(2).description.outputs).toEqual(['main']);
		expect(new PerpetuusPollingTrigger().description.outputs).toEqual(['main']);
	});
});
