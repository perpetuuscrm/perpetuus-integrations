import { describe, expect, it } from 'vitest';

import { normalizeMappedFields, toDateString, toStringList } from '../nodes/Perpetuus/shared/inputs';
import { toResourceMapperField } from '../nodes/Perpetuus/methods';

describe('normalizeMappedFields', () => {
	it('converts values according to the resource mapper schema', () => {
		const out = normalizeMappedFields({
			value: { valor: '1500,50', ativo: 'true', data: { toISO: () => '2026-11-20T00:00:00.000Z' }, tags: '["a","b"]', lista: 'x, y', origem: 'Site', vazio: '' },
			schema: [
				{ id: 'valor', type: 'number' },
				{ id: 'ativo', type: 'boolean' },
				{ id: 'data', type: 'dateTime' },
				{ id: 'tags', type: 'array' },
				{ id: 'lista', type: 'array' },
				{ id: 'origem', type: 'options' },
			],
		});
		expect(out).toEqual({ valor: 1500.5, ativo: true, data: '2026-11-20T00:00:00.000Z', tags: ['a', 'b'], lista: ['x', 'y'], origem: 'Site' });
		expect(normalizeMappedFields(undefined)).toEqual({});
	});
});

describe('input helpers', () => {
	it('normalizes dates and id lists', () => {
		expect(toDateString('')).toBeUndefined();
		expect(toDateString(new Date('2026-11-16T00:00:00.000Z'))).toBe('2026-11-16T00:00:00.000Z');
		expect(toStringList('a, b,,c')).toEqual(['a', 'b', 'c']);
		expect(toStringList([])).toBeUndefined();
	});

	it('maps Perpetuus field types to resource mapper fields', () => {
		const field = toResourceMapperField({
			id: 'f1',
			slug: 'origem',
			label: 'Origem',
			type: 'select',
			required: true,
			requiredOnCreate: true,
			phaseName: 'Form',
			options: [{ name: 'Site', value: 'site' }],
		});
		expect(field).toMatchObject({ id: 'origem', displayName: 'Origem (Form)', required: true, type: 'options', options: [{ name: 'Site', value: 'site' }] });
	});
});
