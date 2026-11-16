export type QueryValue =
	| string
	| number
	| boolean
	| null
	| undefined
	| QueryValue[]
	| { [key: string]: QueryValue };

export type Query = Record<string, QueryValue>;

function append(params: string[], key: string, value: QueryValue): void {
	if (value === undefined || value === null || value === '') return;
	if (Array.isArray(value)) {
		value.forEach((entry, index) => append(params, `${key}[${index}]`, entry));
		return;
	}
	if (typeof value === 'object') {
		for (const [childKey, childValue] of Object.entries(value)) {
			append(params, `${key}[${childKey}]`, childValue);
		}
		return;
	}
	params.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
}

/**
 * Serializes nested objects with the bracket syntax Strapi expects:
 * `{ filters: { createdAt: { $gte: 'x' } } }` -> `filters%5BcreatedAt%5D%5B%24gte%5D=x`.
 * Empty values (undefined, null, '') are skipped.
 */
export function buildQueryString(query?: Query): string {
	if (!query) return '';
	const params: string[] = [];
	for (const [key, value] of Object.entries(query)) append(params, key, value);
	return params.join('&');
}

export function joinUrl(baseUrl: string, path: string, query?: Query): string {
	const base = baseUrl.trim().replace(/\/+$/, '');
	const cleanPath = path.startsWith('/') ? path : `/${path}`;
	const qs = buildQueryString(query);
	return qs ? `${base}${cleanPath}?${qs}` : `${base}${cleanPath}`;
}
