import { describe, expect, it } from 'vitest';

import { buildQueryString, joinUrl } from '../nodes/Perpetuus/shared/query';

describe('buildQueryString', () => {
	it('serializes nested Strapi filters, arrays and pagination with brackets', () => {
		const qs = buildQueryString({
			filters: { createdAt: { $gte: '2026-11-16T10:00:00.000Z' }, currentPhase: { documentId: { $eq: 'ph1' } } },
			sort: 'createdAt:asc',
			populate: { fieldData: { populate: ['field'] }, tags: true },
			pagination: { page: 2, pageSize: 100 },
		});
		expect(decodeURIComponent(qs).split('&')).toEqual([
			'filters[createdAt][$gte]=2026-11-16T10:00:00.000Z',
			'filters[currentPhase][documentId][$eq]=ph1',
			'sort=createdAt:asc',
			'populate[fieldData][populate][0]=field',
			'populate[tags]=true',
			'pagination[page]=2',
			'pagination[pageSize]=100',
		]);
	});

	it('skips undefined, null and empty values and encodes special characters', () => {
		expect(buildQueryString({ a: undefined, b: null, c: '', d: 'x y&z' })).toBe('d=x%20y%26z');
		expect(buildQueryString()).toBe('');
	});
});

describe('joinUrl', () => {
	it('removes trailing slashes from the base URL and appends the query', () => {
		expect(joinUrl('https://api.perpetuus.com.br/api/', '/contacts', { quickSearch: 'ana' })).toBe(
			'https://api.perpetuus.com.br/api/contacts?quickSearch=ana',
		);
		expect(joinUrl('https://api.perpetuus.com.br/api', 'boards')).toBe('https://api.perpetuus.com.br/api/boards');
	});
});
