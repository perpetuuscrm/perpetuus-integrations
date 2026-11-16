import type { ApiClient, HttpMethod } from '../nodes/Perpetuus/shared/transport';
import type { Query } from '../nodes/Perpetuus/shared/query';

export interface RecordedCall {
	method: HttpMethod;
	path: string;
	query?: Query;
	body?: unknown;
}

/** ApiClient double: records every call and answers with `handler`. */
export function mockClient(
	handler: (call: RecordedCall) => unknown,
): { client: ApiClient; calls: RecordedCall[] } {
	const calls: RecordedCall[] = [];
	const client: ApiClient = {
		async request<T>(method: HttpMethod, path: string, options: { query?: Query; body?: unknown } = {}) {
			const call = { method, path, query: options.query, body: options.body };
			calls.push(call);
			const result = handler(call);
			if (result instanceof Error) throw result;
			return result as T;
		},
	};
	return { client, calls };
}

export function rawCard(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		documentId: 'card1',
		title: 'ACME deal',
		value: '1500.50',
		dueDate: null,
		description: null,
		currentPhaseEnteredAt: '2026-11-16T10:00:00.000Z',
		createdAt: '2026-11-16T09:00:00.000Z',
		updatedAt: '2026-11-16T10:00:00.000Z',
		currentPhase: { documentId: 'ph2', name: 'Proposal' },
		contact: { documentId: 'ct1', name: 'Ana', email: 'ana@acme.com', phone: '+5511999999999' },
		tags: [{ documentId: 'tg1', name: 'Hot' }],
		fields: { origem: 'Site', name: 'ACME deal' },
		...overrides,
	};
}
