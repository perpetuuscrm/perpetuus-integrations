import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INode,
	IPollFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

import { DEFAULT_BASE_URL } from './shared/constants';
import { PerpetuusInputError } from './shared/operations';
import { joinUrl } from './shared/query';
import {
	createApiClient,
	PerpetuusApiError,
	type ApiClient,
	type RawResponse,
} from './shared/transport';

export type PerpetuusContext = IExecuteFunctions | ILoadOptionsFunctions | IPollFunctions;

export const CREDENTIAL_NAME = 'perpetuusApi';

/**
 * The single HTTP entry point of the package: authenticates with the Perpetuus API
 * credential, serializes Strapi filters, applies the Retry-After / retry policy and maps
 * errors (see shared/transport.ts).
 */
export async function getApiClient(context: PerpetuusContext): Promise<ApiClient> {
	const credentials = await context.getCredentials(CREDENTIAL_NAME);
	const baseUrl = String(credentials.baseUrl || DEFAULT_BASE_URL);

	return createApiClient(
		async ({ method, path, query, body }): Promise<RawResponse> => {
			const options: IHttpRequestOptions = {
				method: method as IHttpRequestMethods,
				url: joinUrl(baseUrl, path, query),
				headers: { Accept: 'application/json' },
				json: true,
				returnFullResponse: true,
				ignoreHttpStatusErrors: true,
			};
			if (body !== undefined) options.body = body as IDataObject;
			const response = (await context.helpers.httpRequestWithAuthentication.call(
				context,
				CREDENTIAL_NAME,
				options,
			)) as { statusCode?: number; headers?: Record<string, unknown>; body?: unknown };
			return {
				statusCode: Number(response.statusCode ?? 0),
				headers: response.headers ?? {},
				body: response.body,
			};
		},
		{ sleep: async (ms) => await sleep(ms) },
	);
}

/** Converts connector errors into n8n errors with a clear message. */
export function toNodeError(node: INode, error: unknown, itemIndex?: number): Error {
	if (error instanceof PerpetuusApiError) {
		const payload: JsonObject = {
			message: error.message,
			description: error.description,
			httpCode: String(error.httpCode),
		};
		return new NodeApiError(node, payload, {
			message: error.message,
			description: error.description || undefined,
			httpCode: error.httpCode ? String(error.httpCode) : undefined,
			itemIndex,
		});
	}
	if (error instanceof PerpetuusInputError) {
		return new NodeOperationError(node, error.message, { itemIndex });
	}
	if (error instanceof NodeApiError || error instanceof NodeOperationError) return error;
	return new NodeOperationError(node, error as Error, { itemIndex });
}
