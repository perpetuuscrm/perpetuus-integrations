'use strict';

const { createClient } = require('./lib/client');
const { DEFAULT_BASE_URL } = require('./lib/constants');
const { unwrapOne } = require('./lib/mappers');

// GET /auth/token-info: accepted with any scope; returns credential, user and organization.
const test = async (z) => {
  const response = await createClient(z).request('GET', '/auth/token-info');
  return unwrapOne(response) ?? {};
};

// "<organization name> (<user email>)", from the test result.
const connectionLabel = (z, bundle) => {
  const organization = bundle.inputData?.organization?.name;
  const email = bundle.inputData?.user?.email;
  if (organization && email) return `${organization} (${email})`;
  return organization || email || '';
};

module.exports = {
  type: 'custom',
  fields: [
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      required: true,
      helpText:
        'Your Perpetuus API key, starting with `ppt_`. In Perpetuus, open **Settings → API Tokens e MCP → Conectar sua IA (MCP) → Conectar editor → Conectar novo editor**, name the key, choose its validity and check the `crm:read` and `crm:write` scopes. The key is shown only once. [Learn more](https://docs.perpetuus.com.br/docs/api/autenticacao).',
    },
    {
      key: 'baseUrl',
      label: 'API Base URL',
      type: 'string',
      required: false,
      default: DEFAULT_BASE_URL,
      helpText:
        'Keep the default unless Perpetuus support gave you another HTTPS address. Only HTTPS addresses are accepted. [Learn more](https://docs.perpetuus.com.br/docs/api/autenticacao).',
    },
  ],
  test,
  connectionLabel,
};
