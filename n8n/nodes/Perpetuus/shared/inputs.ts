/** Normalizes n8n parameter values into the plain JSON the Perpetuus API expects. */

type MappedFields = {
	value?: Record<string, unknown> | null;
	schema?: Array<{ id: string; type?: string; removed?: boolean }>;
};

function hasToIso(value: unknown): value is { toISO: () => string } {
	return Boolean(value) && typeof (value as { toISO?: unknown }).toISO === 'function';
}

/** dateTime parameters may arrive as ISO strings, Date objects or Luxon DateTimes. */
export function toDateString(value: unknown): string | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	if (hasToIso(value)) return value.toISO();
	if (value instanceof Date) return value.toISOString();
	return String(value);
}

/** multiOptions / expressions may give an array, a comma-separated string or a single id. */
export function toStringList(value: unknown): string[] | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	const list = Array.isArray(value) ? value : String(value).split(',');
	const out = list.map((entry) => String(entry).trim()).filter(Boolean);
	return out.length ? out : undefined;
}

function toArray(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	const text = String(value).trim();
	if (text.startsWith('[')) {
		try {
			const parsed = JSON.parse(text) as unknown;
			if (Array.isArray(parsed)) return parsed;
		} catch {
			// Not JSON: fall back to a comma-separated list below.
		}
	}
	return text.split(',').map((entry) => entry.trim()).filter(Boolean);
}

/**
 * Converts the resourceMapper value (`{ value: { slug: x }, schema: [...] }`) into the
 * `fields` object of the card API, using the field type for numbers, dates, lists and booleans.
 */
export function normalizeMappedFields(mapped: unknown): Record<string, unknown> {
	const { value, schema } = (mapped ?? {}) as MappedFields;
	if (!value || typeof value !== 'object') return {};
	const types = new Map((schema ?? []).filter((f) => !f.removed).map((f) => [f.id, f.type]));
	const out: Record<string, unknown> = {};
	for (const [slug, raw] of Object.entries(value)) {
		if (raw === undefined || raw === null || raw === '') continue;
		const type = types.get(slug);
		if (type === 'number') {
			const parsed = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
			out[slug] = Number.isFinite(parsed) ? parsed : raw;
		} else if (type === 'boolean') {
			out[slug] = typeof raw === 'boolean' ? raw : ['true', '1', 'yes', 'sim'].includes(String(raw).toLowerCase());
		} else if (type === 'dateTime') {
			out[slug] = toDateString(raw);
		} else if (type === 'array') {
			out[slug] = toArray(raw).map((entry) => String(entry));
		} else {
			out[slug] = hasToIso(raw) ? raw.toISO() : raw;
		}
	}
	return out;
}
