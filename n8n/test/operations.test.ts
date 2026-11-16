import { describe, expect, it } from 'vitest';

import { CARD_POPULATE } from '../nodes/Perpetuus/shared/constants';
import {
	addCardTags,
	cardFieldDefinitions,
	createCard,
	createTask,
	findCards,
	findContacts,
	getBoardStructure,
	moveCard,
	paginate,
	PerpetuusInputError,
	upsertContact,
} from '../nodes/Perpetuus/shared/operations';
import { PerpetuusApiError } from '../nodes/Perpetuus/shared/transport';
import { mockClient, rawCard } from './helpers';

describe('upsertContact', () => {
	it('sends snake_case data and matchBy to POST /contacts/upsert', async () => {
		const { client, calls } = mockClient(() => ({
			data: { documentId: 'ct1', name: 'Ana', email: 'ana@acme.com' },
			meta: { created: true, matchedBy: null },
		}));
		const result = await upsertContact(client, {
			email: ' ana@acme.com ',
			name: 'Ana',
			contactType: 'company',
			postalCode: '01000-000',
			matchBy: ['email'],
			customFields: { origem: 'n8n' },
			city: '',
		});
		expect(calls).toEqual([
			{
				method: 'POST',
				path: '/contacts/upsert',
				query: undefined,
				body: {
					data: { name: 'Ana', email: 'ana@acme.com', contact_type: 'empresa', postal_code: '01000-000', customFields: { origem: 'n8n' } },
					matchBy: ['email'],
				},
			},
		]);
		expect(result).toMatchObject({ id: 'ct1', created: true, matchedBy: null });
	});

	it('requires an email or a phone before calling the API', async () => {
		const { client, calls } = mockClient(() => ({}));
		await expect(upsertContact(client, { name: 'Ana' })).rejects.toBeInstanceOf(PerpetuusInputError);
		expect(calls).toHaveLength(0);
	});
});

describe('findContacts', () => {
	it('uses an exact email filter sorted by oldest first', async () => {
		const { client, calls } = mockClient(() => ({ data: [{ documentId: 'ct1', name: 'Ana' }], meta: { pagination: { pageCount: 1 } } }));
		const contacts = await findContacts(client, { searchBy: 'email', value: 'Ana@Acme.com', limit: 10 });
		expect(contacts.map((c) => c.id)).toEqual(['ct1']);
		expect(calls[0].query).toEqual({
			filters: { email: { $eqi: 'Ana@Acme.com' } },
			sort: 'createdAt:asc',
			pagination: { page: 1, pageSize: 10 },
		});
	});

	it('searches phones by digits without the country code', async () => {
		const { client, calls } = mockClient(() => ({ data: [] }));
		await findContacts(client, { searchBy: 'phone', value: '+55 (11) 99999-9999', limit: 5 });
		expect(calls[0].query).toMatchObject({ quickSearch: '11999999999', sort: 'createdAt:asc' });
	});

	it('uses quickSearch for text', async () => {
		const { client, calls } = mockClient(() => ({ data: [] }));
		await findContacts(client, { searchBy: 'text', value: 'acme' });
		expect(calls[0].query).toMatchObject({ quickSearch: 'acme', sort: 'updatedAt:desc', pagination: { page: 1, pageSize: 100 } });
	});
});

describe('paginate', () => {
	it('reads pages until the page count and respects the limit', async () => {
		const page = (n: number, size: number) => Array.from({ length: size }, (_, i) => ({ documentId: `p${n}-${i}` }));
		const { client, calls } = mockClient((call) => {
			const { page: p, pageSize } = (call.query?.pagination ?? {}) as { page: number; pageSize: number };
			return { data: page(p, p === 3 ? 20 : pageSize), meta: { pagination: { page: p, pageSize, pageCount: 3 } } };
		});
		expect(await paginate(client, '/contacts', {})).toHaveLength(220);
		expect(calls).toHaveLength(3);
		const limited = mockClient(() => ({ data: page(1, 100), meta: { pagination: { pageCount: 9 } } }));
		expect(await paginate(limited.client, '/contacts', {}, 150)).toHaveLength(150);
		expect(limited.calls.map((c) => (c.query?.pagination as { pageSize: number }).pageSize)).toEqual([100, 50]);
	});
});

describe('createCard', () => {
	it('creates with fields.name = title, moves to the chosen phase and returns the populated card', async () => {
		const { client, calls } = mockClient((call) => {
			if (call.method === 'POST') return { data: { documentId: 'card1', currentPhase: { documentId: 'ph1' } } };
			if (call.method === 'PUT') return { data: {} };
			return { data: rawCard() };
		});
		const card = await createCard(client, {
			boardId: 'board1',
			title: 'ACME deal',
			phaseId: 'ph2',
			contactId: 'ct1',
			tagIds: ['tg1'],
			value: 1500.5,
			fields: { origem: 'Site', vazio: '' },
		});
		expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
			'POST /boards/board1/cards',
			'PUT /boards/board1/cards/card1',
			'GET /boards/board1/cards/card1',
		]);
		expect(calls[0].body).toEqual({
			data: { fields: { origem: 'Site', name: 'ACME deal' }, contact: 'ct1', tags: ['tg1'], value: 1500.5 },
		});
		expect(calls[1].body).toEqual({ data: { currentPhase: 'ph2' } });
		expect(calls[2].query).toEqual({ populate: CARD_POPULATE });
		expect(card).toMatchObject({ id: 'card1', phaseId: 'ph2', boardId: 'board1' });
		expect(card.warning).toBeUndefined();
	});

	it('skips the move when the card is already in the phase', async () => {
		const { client, calls } = mockClient((call) =>
			call.method === 'POST' ? { data: { documentId: 'card1', currentPhase: 'ph1' } } : { data: rawCard() },
		);
		await createCard(client, { boardId: 'board1', title: 'X', phaseId: 'ph1' });
		expect(calls.map((c) => c.method)).toEqual(['POST', 'GET']);
	});

	it('returns the created card with a warning when the move fails, without creating again', async () => {
		const { client, calls } = mockClient((call) => {
			if (call.method === 'POST') return { data: { documentId: 'card1', currentPhase: { documentId: 'ph1' } } };
			if (call.method === 'PUT') return new PerpetuusApiError('Perpetuus rejected the request: campo obrigatório', { httpCode: 400 });
			return { data: rawCard({ currentPhase: { documentId: 'ph1', name: 'Lead' } }) };
		});
		const card = await createCard(client, { boardId: 'board1', title: 'X', phaseId: 'ph9' });
		expect(card.warning).toContain('moving it to phase ph9 failed');
		expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
	});
});

describe('moveCard and addCardTags', () => {
	it('moves with currentPhase and reason', async () => {
		const { client, calls } = mockClient((call) => (call.method === 'GET' ? { data: rawCard() } : { data: {} }));
		await moveCard(client, { boardId: 'b', cardId: 'card1', phaseId: 'ph3', reason: 'Won' });
		expect(calls[0]).toMatchObject({ method: 'PUT', path: '/boards/b/cards/card1', body: { data: { currentPhase: 'ph3', reason: 'Won' } } });
	});

	it('merges new tags with the existing ones', async () => {
		let getCount = 0;
		const { client, calls } = mockClient((call) => {
			if (call.method === 'GET') {
				getCount++;
				return getCount === 1 ? { data: { documentId: 'card1', tags: [{ documentId: 'tg1' }] } } : { data: rawCard() };
			}
			return { data: {} };
		});
		await addCardTags(client, { boardId: 'b', cardId: 'card1', tagIds: ['tg1', 'tg2'] });
		expect(calls[0].query).toEqual({ populate: ['tags'] });
		expect(calls[1]).toMatchObject({ method: 'PUT', body: { data: { tags: ['tg1', 'tg2'] } } });
	});

	it('does not write when every tag is already on the card', async () => {
		const { client, calls } = mockClient(() => ({ data: { documentId: 'card1', tags: [{ documentId: 'tg1' }] } }));
		await addCardTags(client, { boardId: 'b', cardId: 'card1', tagIds: ['tg1'] });
		expect(calls.map((c) => c.method)).toEqual(['GET', 'GET']);
	});
});

describe('findCards', () => {
	it('filters by title, phase and contact inside the board', async () => {
		const { client, calls } = mockClient(() => ({ data: [rawCard()], meta: { pagination: { pageCount: 1 } } }));
		const cards = await findCards(client, { boardId: 'b', query: 'acme', phaseId: 'ph2', contactId: 'ct1', limit: 10 });
		expect(cards[0].boardId).toBe('b');
		expect(calls[0]).toMatchObject({
			path: '/boards/b/cards',
			query: {
				filters: {
					title: { $containsi: 'acme' },
					currentPhase: { documentId: { $eq: 'ph2' } },
					contact: { documentId: { $eq: 'ct1' } },
				},
				sort: 'updatedAt:desc',
				stats: 'false',
			},
		});
	});
});

describe('createTask', () => {
	it('sends the card (and not the board) when a card is given', async () => {
		const { client, calls } = mockClient(() => ({ documentId: 't1', name: 'Kickoff', taskStatus: 'pending' }));
		const task = await createTask(client, { name: 'Kickoff', boardId: 'b', cardId: 'card1', type: 'action', priority: 'high' });
		expect(calls[0].body).toEqual({ data: { name: 'Kickoff', card: 'card1', type: 'action', priority: 'high' } });
		expect(task).toMatchObject({ id: 't1', status: 'pending', cardId: 'card1' });
	});

	it('sends the board when there is no card and requires one of them', async () => {
		const { client, calls } = mockClient(() => ({ data: { documentId: 't2' } }));
		await createTask(client, { name: 'Call', boardId: 'b' });
		expect(calls[0].body).toEqual({ data: { name: 'Call', board: 'b' } });
		await expect(createTask(client, { name: 'Call' })).rejects.toBeInstanceOf(PerpetuusInputError);
	});
});

describe('board structure', () => {
	it('orders phases, exposes tags and lists card fields without the title and display-only fields', async () => {
		const { client, calls } = mockClient(() => ({
			data: {
				board: { documentId: 'b' },
				phases: [
					{ documentId: 'ph2', name: 'Proposal', order: 1, fields: [{ documentId: 'f3', slug: 'valor', label: 'Valor', type: 'currency', required: true }] },
					{
						documentId: 'ph0',
						name: 'Form',
						order: 0,
						fields: [
							{ documentId: 'f0', slug: 'name', label: 'Nome', type: 'text', required: true },
							{ documentId: 'f1', slug: 'origem', label: 'Origem', type: 'select', required: true, options: [{ value: 'site', label: 'Site' }, 'Instagram'] },
							{ documentId: 'f2', slug: 'aviso', label: 'Aviso', type: 'statement', required: false },
						],
					},
				],
				tags: [{ documentId: 'tg1', name: 'Hot' }],
			},
		}));
		const structure = await getBoardStructure(client, 'b');
		expect(calls[0].query).toEqual({ include: 'phases,fields,tags' });
		expect(structure.phases.map((p) => p.id)).toEqual(['ph0', 'ph2']);
		expect(structure.tags).toEqual([{ name: 'Hot', value: 'tg1' }]);
		const fields = cardFieldDefinitions(structure);
		expect(fields.map((f) => [f.slug, f.requiredOnCreate])).toEqual([
			['origem', true],
			['valor', false],
		]);
		expect(fields[0].options).toEqual([
			{ name: 'Site', value: 'site' },
			{ name: 'Instagram', value: 'Instagram' },
		]);
	});
});
