/**
 * Cursor-based polling shared by every trigger (docs/v1-contract.md §5.1).
 *
 * State: the highest event timestamp already seen (`cursor`) plus the event ids that carry
 * exactly that timestamp (`seen`), so events sharing the boundary timestamp are neither lost
 * nor emitted twice. Items are read in ascending order, so a backlog bigger than one cycle is
 * drained on the next cycles without gaps.
 */
import { CARD_POPULATE, MAX_PAGE_SIZE, POLL_MAX_PAGES } from './constants';
import { toCard, toContact, toTask, unwrapList, type Card, type Contact, type Task } from './mappers';
import type { Query } from './query';
import type { ApiClient } from './transport';

export interface PollState {
	initialized?: boolean;
	cursor?: string | null;
	seen?: string[];
	key?: string;
}

export interface PollEvent {
	eventId: string;
	eventAt: string;
	item: Record<string, unknown>;
}

export type TriggerEvent = 'newCard' | 'cardEnteredPhase' | 'newContact' | 'taskCompleted';

export interface TriggerParams {
	event: TriggerEvent;
	boardId?: string;
	phaseId?: string;
}

export interface TriggerSource {
	/** The most recent event, or undefined when there is none. */
	fetchLatest(): Promise<PollEvent | undefined>;
	/** Events with eventAt >= cursor (every event when cursor is null), oldest first. */
	fetchSince(cursor: string | null): Promise<PollEvent[]>;
}

function time(value: string): number {
	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? 0 : parsed;
}

/** Keeps events after the cursor (and boundary events not seen yet), oldest first. */
export function selectNewEvents(
	events: PollEvent[],
	state: { cursor: string | null; seen: string[] },
): { emitted: PollEvent[]; cursor: string | null; seen: string[] } {
	const cursorTime = state.cursor ? time(state.cursor) : undefined;
	const seen = new Set(state.seen);
	const unique = new Map<string, PollEvent>();
	for (const event of events) {
		if (!event.eventAt || !event.eventId) continue;
		const at = time(event.eventAt);
		if (cursorTime !== undefined && at < cursorTime) continue;
		if (cursorTime !== undefined && at === cursorTime && seen.has(event.eventId)) continue;
		unique.set(event.eventId, event);
	}
	const emitted = [...unique.values()].sort((a, b) => time(a.eventAt) - time(b.eventAt));

	if (!emitted.length) return { emitted, cursor: state.cursor, seen: state.seen };

	const last = emitted[emitted.length - 1];
	const lastTime = time(last.eventAt);
	const boundary = emitted.filter((event) => time(event.eventAt) === lastTime).map((e) => e.eventId);
	const nextSeen = cursorTime === lastTime ? [...new Set([...state.seen, ...boundary])] : boundary;
	return { emitted, cursor: last.eventAt, seen: nextSeen };
}

export function paramsKey(params: TriggerParams): string {
	return [params.event, params.boardId ?? '', params.phaseId ?? ''].join('|');
}

/**
 * One polling cycle. The first cycle (or a cycle after the parameters changed) only stores
 * the cursor and emits nothing, so the history is never replayed.
 */
export async function runPollCycle(
	source: TriggerSource,
	state: PollState,
	key: string,
): Promise<{ emitted: PollEvent[]; state: PollState }> {
	if (!state.initialized || state.key !== key) {
		const latest = await source.fetchLatest();
		return {
			emitted: [],
			state: {
				initialized: true,
				key,
				cursor: latest?.eventAt ?? null,
				seen: latest ? [latest.eventId] : [],
			},
		};
	}
	const cursor = state.cursor ?? null;
	const events = await source.fetchSince(cursor);
	const result = selectNewEvents(events, { cursor, seen: state.seen ?? [] });
	return {
		emitted: result.emitted,
		state: { initialized: true, key, cursor: result.cursor, seen: result.seen },
	};
}

// ─── Sources for each trigger ────────────────────────────────────────────────

const enc = encodeURIComponent;

function withEvent(item: Record<string, unknown>, eventId: string, eventAt: string): PollEvent {
	return { eventId, eventAt, item: { ...item, eventId, eventAt } };
}

export function cardEvent(card: Card, event: 'newCard' | 'cardEnteredPhase'): PollEvent | undefined {
	if (event === 'newCard') {
		return card.createdAt ? withEvent(card, card.id, card.createdAt) : undefined;
	}
	if (!card.phaseEnteredAt) return undefined;
	return withEvent(card, `${card.id}:${card.phaseId ?? ''}:${card.phaseEnteredAt}`, card.phaseEnteredAt);
}

export function contactEvent(contact: Contact): PollEvent | undefined {
	return contact.createdAt ? withEvent(contact, contact.id, contact.createdAt) : undefined;
}

export function taskEvent(task: Task): PollEvent | undefined {
	return task.completedAt
		? withEvent(task, `${task.id}:${task.completedAt}`, task.completedAt)
		: undefined;
}

function isEvent(event: PollEvent | undefined): event is PollEvent {
	return event !== undefined;
}

/** Reads `{ data, meta.pagination }` pages in ascending order, up to POLL_MAX_PAGES. */
async function readPages(client: ApiClient, path: string, query: Query) {
	const items: Array<Record<string, unknown>> = [];
	for (let page = 1; page <= POLL_MAX_PAGES; page++) {
		const response = await client.request('GET', path, {
			query: { ...query, pagination: { page, pageSize: MAX_PAGE_SIZE } },
		});
		const batch = unwrapList(response);
		items.push(...batch);
		if (batch.length < MAX_PAGE_SIZE) break;
	}
	return items;
}

function cardSource(
	client: ApiClient,
	boardId: string,
	event: 'newCard' | 'cardEnteredPhase',
	phaseId?: string,
): TriggerSource {
	const field = event === 'newCard' ? 'createdAt' : 'currentPhaseEnteredAt';
	const path = `/boards/${enc(boardId)}/cards`;
	const baseFilters = (): Query => {
		const filters: Query = {};
		if (event === 'cardEnteredPhase') {
			filters.currentPhaseEnteredAt = { $notNull: true };
			if (phaseId) filters.currentPhase = { documentId: { $eq: phaseId } };
		}
		return filters;
	};
	const toEvents = (items: Array<Record<string, unknown>>) =>
		items.map((raw) => cardEvent(toCard(raw, boardId), event)).filter(isEvent);
	return {
		async fetchLatest() {
			const response = await client.request('GET', path, {
				query: {
					filters: baseFilters(),
					sort: `${field}:desc`,
					stats: 'false',
					populate: CARD_POPULATE,
					pagination: { page: 1, pageSize: 1 },
				},
			});
			return toEvents(unwrapList(response))[0];
		},
		async fetchSince(cursor) {
			const filters = baseFilters();
			if (cursor) filters[field] = { ...((filters[field] as object) ?? {}), $gte: cursor };
			const items = await readPages(client, path, {
				filters,
				sort: `${field}:asc`,
				stats: 'false',
				populate: CARD_POPULATE,
			});
			return toEvents(items);
		},
	};
}

function contactSource(client: ApiClient): TriggerSource {
	const toEvents = (items: Array<Record<string, unknown>>) =>
		items.map((raw) => contactEvent(toContact(raw))).filter(isEvent);
	return {
		async fetchLatest() {
			const response = await client.request('GET', '/contacts', {
				query: { sort: 'createdAt:desc', pagination: { page: 1, pageSize: 1 } },
			});
			return toEvents(unwrapList(response))[0];
		},
		async fetchSince(cursor) {
			const query: Query = { sort: 'createdAt:asc' };
			if (cursor) query.filters = { createdAt: { $gte: cursor } };
			return toEvents(await readPages(client, '/contacts', query));
		},
	};
}

/** GET /tasks returns a plain array and pages with limit/offset. */
function taskSource(client: ApiClient, boardId?: string): TriggerSource {
	const baseFilters = (): Query => {
		const filters: Query = { completedAt: { $notNull: true } };
		if (boardId) filters.board = { documentId: boardId };
		return filters;
	};
	const toEvents = (items: Array<Record<string, unknown>>) =>
		items.map((raw) => taskEvent(toTask(raw))).filter(isEvent);
	return {
		async fetchLatest() {
			const response = await client.request('GET', '/tasks', {
				query: { filters: baseFilters(), sort: 'completedAt:desc', limit: 1 },
			});
			return toEvents(unwrapList(response))[0];
		},
		async fetchSince(cursor) {
			const filters = baseFilters();
			if (cursor) filters.completedAt = { $notNull: true, $gte: cursor };
			const items: Array<Record<string, unknown>> = [];
			for (let page = 0; page < POLL_MAX_PAGES; page++) {
				const response = await client.request('GET', '/tasks', {
					query: { filters, sort: 'completedAt:asc', limit: MAX_PAGE_SIZE, offset: page * MAX_PAGE_SIZE },
				});
				const batch = unwrapList(response);
				items.push(...batch);
				if (batch.length < MAX_PAGE_SIZE) break;
			}
			return toEvents(items);
		},
	};
}

export function createTriggerSource(client: ApiClient, params: TriggerParams): TriggerSource {
	switch (params.event) {
		case 'newCard':
		case 'cardEnteredPhase':
			if (!params.boardId) throw new Error('Choose the board to watch.');
			return cardSource(client, params.boardId, params.event, params.phaseId || undefined);
		case 'newContact':
			return contactSource(client);
		case 'taskCompleted':
			return taskSource(client, params.boardId || undefined);
		default:
			throw new Error(`Unknown trigger event: ${String(params.event)}`);
	}
}
