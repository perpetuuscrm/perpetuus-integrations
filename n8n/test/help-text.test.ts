import { describe, expect, it } from 'vitest';

import { PerpetuusApi } from '../credentials/PerpetuusApi.credentials';
import { toPerpetuusError } from '../nodes/Perpetuus/shared/transport';

/** The path to create an API key; the README uses the same text (Credentials, step 1). */
const KEY_PATH =
	'Settings → API Tokens and MCP ("API Tokens e MCP") → Connect your AI (MCP) → Connect editor → Connect new editor';

describe('API key help text', () => {
	it('is the same English path in the credential and the 401 error', () => {
		const apiKey = new PerpetuusApi().properties.find((p) => p.name === 'apiKey');
		expect(apiKey?.description).toContain(KEY_PATH);
		expect(toPerpetuusError(401, {}).message).toContain(KEY_PATH);
	});
});
