'use strict';

/** GET /manifest.json: the app as Pluga lists it. */
const { t } = require('./i18n');

const APP_NAME = 'Perpetuus';
const APP_VERSION = '1.0.0';

function appManifest(config) {
  return {
    version: APP_VERSION,
    name: APP_NAME,
    color: '#0A6C3D',
    description: t(
      'CRM brasileiro para pequenas e médias empresas: organize vendas e atendimento em Boards com Fases e Cards, contatos, tarefas e uma caixa de entrada compartilhada com o WhatsApp oficial.',
      'Brazilian CRM for small and mid-sized businesses: organize sales and service in Boards with Phases and Cards, contacts, tasks and a shared inbox with official WhatsApp.',
    ),
    website: 'https://www.perpetuus.com.br',
    signup_url: 'https://app.perpetuus.com.br/sign-up',
    base_url: config.publicBaseUrl,
    authentication: {
      access_token_label: t('Chave de API do Perpetuus (ppt_…)', 'Perpetuus API key (ppt_…)'),
      access_token_tutorial: [
        {
          content: t(
            'No Perpetuus, abra Configurações → API Tokens e MCP → Conectar sua IA (MCP) → Conectar editor → Conectar novo editor.',
            'In Perpetuus, open Settings → API Tokens e MCP → Conectar sua IA (MCP) → Conectar editor → Conectar novo editor.',
          ),
        },
        {
          content: t(
            'Dê o nome "Pluga", escolha a validade (até 365 dias) e marque o escopo crm:write (ele inclui crm:read). Para o gatilho de nova mensagem, marque também chat:read.',
            'Name it "Pluga", choose how long it is valid (up to 365 days) and tick the crm:write scope (it includes crm:read). For the new message trigger, also tick chat:read.',
          ),
        },
        {
          content: t(
            'Copie a chave que começa com ppt_ (ela aparece uma vez só) e cole aqui.',
            'Copy the key that starts with ppt_ (it is shown only once) and paste it here.',
          ),
        },
      ],
    },
  };
}

module.exports = { APP_NAME, APP_VERSION, appManifest };
