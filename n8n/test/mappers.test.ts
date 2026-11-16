import { describe, expect, it } from 'vitest';

import {
	compact,
	phoneSearchDigits,
	toCard,
	toContact,
	toTask,
	toUpsertedContact,
	unwrapList,
	unwrapOne,
} from '../nodes/Perpetuus/shared/mappers';
import { rawCard } from './helpers';

describe('toCard', () => {
	it('flattens populated relations into the canonical card', () => {
		expect(toCard(rawCard(), 'board1')).toEqual({
			id: 'card1',
			title: 'ACME deal',
			boardId: 'board1',
			phaseId: 'ph2',
			phaseName: 'Proposal',
			phaseEnteredAt: '2026-11-16T10:00:00.000Z',
			contactId: 'ct1',
			contactName: 'Ana',
			contactEmail: 'ana@acme.com',
			contactPhone: '+5511999999999',
			value: 1500.5,
			dueDate: null,
			description: null,
			tagIds: ['tg1'],
			tagNames: ['Hot'],
			fields: { origem: 'Site', name: 'ACME deal' },
			createdAt: '2026-11-16T09:00:00.000Z',
			updatedAt: '2026-11-16T10:00:00.000Z',
		});
	});

	it('builds fields from fieldData and keeps null relations stable', () => {
		const card = toCard(
			{
				documentId: 'c2',
				title: 'No relations',
				board: { documentId: 'b9' },
				currentPhase: 'ph1',
				contact: null,
				fieldData: [
					{ field: { slug: 'origem' }, value: { val: 'Instagram' } },
					{ field: { slug: 'interesses' }, value: { val: ['a', 'b'] } },
					{ field: null, value: { val: 'ignored' } },
				],
			},
			'fallback',
		);
		expect(card.boardId).toBe('b9');
		expect(card.phaseId).toBe('ph1');
		expect(card.phaseName).toBeNull();
		expect(card.contactId).toBeNull();
		expect(card.tagIds).toEqual([]);
		expect(card.value).toBeNull();
		expect(card.fields).toEqual({ origem: 'Instagram', interesses: ['a', 'b'] });
	});
});

describe('toContact / toUpsertedContact', () => {
	it('maps snake_case and contact type to the canonical contact', () => {
		const contact = toContact({
			documentId: 'ct1',
			name: 'Ana',
			email: 'ana@acme.com',
			contact_type: 'empresa',
			postal_code: '01000-000',
			customFields: { origem: 'n8n' },
			createdAt: '2026-11-16T09:00:00.000Z',
		});
		expect(contact).toMatchObject({ id: 'ct1', contactType: 'company', postalCode: '01000-000', phone: null, customFields: { origem: 'n8n' } });
		expect(Object.keys(contact)).toHaveLength(15);
	});

	it('adds created, matchedBy and otherMatchIds from meta', () => {
		const result = toUpsertedContact({
			data: { documentId: 'ct1', name: 'Ana', contact_type: 'pessoa' },
			meta: { created: false, matchedBy: 'phone', otherMatches: [{ documentId: 'ct7' }, 'ct8'] },
		});
		expect(result).toMatchObject({ id: 'ct1', contactType: 'person', created: false, matchedBy: 'phone', otherMatchIds: ['ct7', 'ct8'] });
		expect(toUpsertedContact({ data: { documentId: 'n' }, meta: { created: true, matchedBy: null } })).toMatchObject({
			created: true,
			matchedBy: null,
			otherMatchIds: [],
		});
	});
});

describe('toTask', () => {
	it('maps taskStatus to status and the card relation', () => {
		expect(
			toTask({
				documentId: 't1',
				name: 'Onboarding',
				taskStatus: 'Concluído',
				type: 'action',
				priority: 'high',
				completedAt: '2026-11-16T11:00:00.000Z',
				card: { documentId: 'card1', title: 'ACME deal' },
				assignees: [{ documentId: 'm1' }],
			}),
		).toMatchObject({ id: 't1', status: 'Concluído', cardId: 'card1', cardTitle: 'ACME deal', assigneeIds: ['m1'] });
		expect(toTask({ documentId: 't2', name: 'x' }, 'cardX').cardId).toBe('cardX');
	});
});

describe('helpers', () => {
	it('unwraps single and list envelopes', () => {
		expect(unwrapOne({ data: { documentId: 'a' } })).toEqual({ documentId: 'a' });
		expect(unwrapOne({ documentId: 'b' })).toEqual({ documentId: 'b' });
		expect(unwrapList([{ a: 1 }])).toEqual([{ a: 1 }]);
		expect(unwrapList({ data: [{ a: 2 }], meta: {} })).toEqual([{ a: 2 }]);
		expect(unwrapList(null)).toEqual([]);
	});

	it('normalizes phones for quickSearch', () => {
		expect(phoneSearchDigits('+55 (11) 99999-9999')).toBe('11999999999');
		expect(phoneSearchDigits('(11) 99999-9999')).toBe('11999999999');
		expect(phoneSearchDigits('5511')).toBe('5511');
	});

	it('compacts optional inputs', () => {
		expect(compact({ a: '', b: undefined, c: null, d: [], e: 0, f: 'x' })).toEqual({ e: 0, f: 'x' });
	});
});
