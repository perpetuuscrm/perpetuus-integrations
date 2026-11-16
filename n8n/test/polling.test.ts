import { describe, expect, it } from 'vitest';

import {
	createTriggerSource,
	paramsKey,
	runPollCycle,
	selectNewEvents,
	type PollEvent,
	type TriggerSource,
} from '../nodes/Perpetuus/shared/polling';
import { mockClient, rawCard } from './helpers';

const ev = (eventId: string, eventAt: string): PollEvent => ({ eventId, eventAt, item: { eventId, eventAt } });

describe('selectNewEvents', () => {
	it('drops events before the cursor and boundary events already seen, oldest first', () => {
		const result = selectNewEvents(
			[ev('c', '2026-11-16T10:00:02.000Z'), ev('a', '2026-11-16T10:00:00.000Z'), ev('b', '2026-11-16T10:00:01.000Z'), ev('old', '2026-11-16T09:00:00.000Z')],
			{ cursor: '2026-11-16T10:00:00.000Z', seen: ['a'] },
		);
		expect(result.emitted.map((e) => e.eventId)).toEqual(['b', 'c']);
		expect(result.cursor).toBe('2026-11-16T10:00:02.000Z');
		expect(result.seen).toEqual(['c']);
	});

	it('keeps the previous boundary ids when the cursor does not move', () => {
		const result = selectNewEvents([ev('a', '2026-11-16T10:00:00.000Z'), ev('b', '2026-11-16T10:00:00.000Z')], {
			cursor: '2026-11-16T10:00:00.000Z',
			seen: ['a'],
		});
		expect(result.emitted.map((e) => e.eventId)).toEqual(['b']);
		expect(result.seen.sort()).toEqual(['a', 'b']);
	});

	it('returns the same state when nothing is new', () => {
		const state = { cursor: '2026-11-16T10:00:00.000Z', seen: ['a'] };
		expect(selectNewEvents([ev('a', '2026-11-16T10:00:00.000Z')], state)).toEqual({ emitted: [], ...state });
	});
});

describe('runPollCycle', () => {
	function fakeSource(latest: PollEvent | undefined, since: PollEvent[]): TriggerSource & { sinceCalls: Array<string | null> } {
		const sinceCalls: Array<string | null> = [];
		return {
			sinceCalls,
			fetchLatest: async () => latest,
			fetchSince: async (cursor) => {
				sinceCalls.push(cursor);
				return since;
			},
		};
	}

	it('only marks the cursor on the first run', async () => {
		const source = fakeSource(ev('x', '2026-11-16T10:00:00.000Z'), [ev('y', '2026-11-16T11:00:00.000Z')]);
		const first = await runPollCycle(source, {}, 'k');
		expect(first.emitted).toEqual([]);
		expect(first.state).toEqual({ initialized: true, key: 'k', cursor: '2026-11-16T10:00:00.000Z', seen: ['x'] });
		expect(source.sinceCalls).toEqual([]);

		const second = await runPollCycle(source, first.state, 'k');
		expect(second.emitted.map((e) => e.eventId)).toEqual(['y']);
		expect(source.sinceCalls).toEqual(['2026-11-16T10:00:00.000Z']);
		expect(second.state.cursor).toBe('2026-11-16T11:00:00.000Z');
	});

	it('uses a null cursor when there was no record yet, so the first record fires', async () => {
		const source = fakeSource(undefined, [ev('first', '2026-11-16T12:00:00.000Z')]);
		const first = await runPollCycle(source, {}, 'k');
		expect(first.state.cursor).toBeNull();
		const second = await runPollCycle(source, first.state, 'k');
		expect(source.sinceCalls).toEqual([null]);
		expect(second.emitted.map((e) => e.eventId)).toEqual(['first']);
	});

	it('starts over when the trigger parameters change', async () => {
		const source = fakeSource(ev('z', '2026-11-16T13:00:00.000Z'), [ev('y', '2026-11-16T14:00:00.000Z')]);
		const state = { initialized: true, key: 'old', cursor: '2026-11-16T10:00:00.000Z', seen: [] };
		const result = await runPollCycle(source, state, 'new');
		expect(result.emitted).toEqual([]);
		expect(result.state).toMatchObject({ key: 'new', cursor: '2026-11-16T13:00:00.000Z' });
		expect(paramsKey({ event: 'cardEnteredPhase', boardId: 'b', phaseId: 'p' })).toBe('cardEnteredPhase|b|p');
	});
});

describe('trigger sources', () => {
	it('new card: filters createdAt >= cursor ascending and dedupes by card id', async () => {
		const { client, calls } = mockClient(() => ({ data: [rawCard()] }));
		const source = createTriggerSource(client, { event: 'newCard', boardId: 'b' });
		const events = await source.fetchSince('2026-11-16T08:00:00.000Z');
		expect(calls[0]).toMatchObject({
			path: '/boards/b/cards',
			query: {
				filters: { createdAt: { $gte: '2026-11-16T08:00:00.000Z' } },
				sort: 'createdAt:asc',
				stats: 'false',
				pagination: { page: 1, pageSize: 100 },
			},
		});
		expect(events[0].eventId).toBe('card1');
		expect(events[0].item).toMatchObject({ id: 'card1', eventId: 'card1', eventAt: '2026-11-16T09:00:00.000Z' });
	});

	it('card entered phase: uses currentPhaseEnteredAt, the optional phase and a card:phase:time event id', async () => {
		const { client, calls } = mockClient(() => ({ data: [rawCard()] }));
		const source = createTriggerSource(client, { event: 'cardEnteredPhase', boardId: 'b', phaseId: 'ph2' });
		const latest = await source.fetchLatest();
		expect(calls[0].query).toMatchObject({
			filters: { currentPhaseEnteredAt: { $notNull: true }, currentPhase: { documentId: { $eq: 'ph2' } } },
			sort: 'currentPhaseEnteredAt:desc',
			pagination: { page: 1, pageSize: 1 },
		});
		expect(latest?.eventId).toBe('card1:ph2:2026-11-16T10:00:00.000Z');
		await source.fetchSince('2026-11-16T09:30:00.000Z');
		expect(calls[1].query).toMatchObject({
			filters: { currentPhaseEnteredAt: { $notNull: true, $gte: '2026-11-16T09:30:00.000Z' } },
			sort: 'currentPhaseEnteredAt:asc',
		});
	});

	it('new contact: reads /contacts by createdAt', async () => {
		const { client, calls } = mockClient(() => ({ data: [{ documentId: 'ct1', name: 'Ana', createdAt: '2026-11-16T09:00:00.000Z' }] }));
		const events = await createTriggerSource(client, { event: 'newContact' }).fetchSince(null);
		expect(calls[0].query).toEqual({ sort: 'createdAt:asc', pagination: { page: 1, pageSize: 100 } });
		expect(events[0]).toMatchObject({ eventId: 'ct1', eventAt: '2026-11-16T09:00:00.000Z' });
	});

	it('task completed: pages the plain array with limit/offset and dedupes by task:completedAt', async () => {
		const full = Array.from({ length: 100 }, (_, i) => ({
			documentId: `t${i}`,
			name: 'x',
			completedAt: `2026-11-16T10:00:${String(i % 60).padStart(2, '0')}.000Z`,
		}));
		const { client, calls } = mockClient((call) => (call.query?.offset === 0 ? full : [{ documentId: 'last', completedAt: '2026-11-16T11:00:00.000Z' }]));
		const events = await createTriggerSource(client, { event: 'taskCompleted', boardId: 'b' }).fetchSince('2026-11-16T09:00:00.000Z');
		expect(calls.map((c) => c.query?.offset)).toEqual([0, 100]);
		expect(calls[0].query).toMatchObject({
			filters: { completedAt: { $notNull: true, $gte: '2026-11-16T09:00:00.000Z' }, board: { documentId: 'b' } },
			sort: 'completedAt:asc',
			limit: 100,
		});
		expect(events).toHaveLength(101);
		expect(events[100].eventId).toBe('last:2026-11-16T11:00:00.000Z');
	});

	it('requires a board for card triggers', () => {
		const { client } = mockClient(() => ({}));
		expect(() => createTriggerSource(client, { event: 'newCard' })).toThrow('Choose the board to watch.');
	});
});
