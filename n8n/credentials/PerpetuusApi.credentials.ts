import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class PerpetuusApi implements ICredentialType {
	name = 'perpetuusApi';

	displayName = 'Perpetuus API';

	icon: Icon = { light: 'file:../icons/perpetuus.svg', dark: 'file:../icons/perpetuus.dark.svg' };

	documentationUrl = 'https://docs.perpetuus.com.br/docs/api/autenticacao';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: 'ppt_...',
			description:
				'Perpetuus API key (starts with ppt_). Create it in Settings → API Tokens e MCP → Conectar sua IA (MCP) → Conectar novo editor, with the crm:write scope.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			required: true,
			default: 'https://api.perpetuus.com.br/api',
			description: 'Perpetuus API base URL. Change it only for a staging or self-hosted environment.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl.replace(/\\/+$/, "")}}',
			url: '/auth/token-info',
			method: 'GET',
		},
	};
}
