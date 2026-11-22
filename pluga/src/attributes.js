'use strict';

/** Attributes Pluga can map from action results and trigger events (docs/v1-contract.md §4, §5.8, §5.9). */
const { t } = require('./i18n');
const ops = require('./perpetuus/operations');

const a = (key, ptBR, en) => ({ key, name: t(ptBR, en) });

const CARD_ATTRIBUTES = [
  a('id', 'ID do Card', 'Card ID'),
  a('title', 'Título', 'Title'),
  a('boardId', 'ID do Board', 'Board ID'),
  a('phaseId', 'ID da Fase', 'Phase ID'),
  a('phaseName', 'Fase', 'Phase'),
  a('phaseEnteredAt', 'Entrou na fase em', 'Entered phase at'),
  a('contactId', 'ID do contato', 'Contact ID'),
  a('contactName', 'Nome do contato', 'Contact name'),
  a('contactEmail', 'E-mail do contato', 'Contact email'),
  a('contactPhone', 'Telefone do contato', 'Contact phone'),
  a('value', 'Valor', 'Value'),
  a('dueDate', 'Data de entrega', 'Due date'),
  a('description', 'Descrição', 'Description'),
  a('tagIds', 'IDs das tags', 'Tag IDs'),
  a('tagNames', 'Tags', 'Tags'),
  a('createdAt', 'Criado em', 'Created at'),
  a('updatedAt', 'Atualizado em', 'Updated at'),
];

const CONTACT_ATTRIBUTES = [
  a('id', 'ID do contato', 'Contact ID'),
  a('name', 'Nome', 'Name'),
  a('email', 'E-mail', 'Email'),
  a('phone', 'Telefone', 'Phone'),
  a('contactType', 'Tipo (person/company)', 'Type (person/company)'),
  a('cpf', 'CPF', 'CPF'),
  a('cnpj', 'CNPJ', 'CNPJ'),
  a('address', 'Endereço', 'Address'),
  a('city', 'Cidade', 'City'),
  a('state', 'Estado', 'State'),
  a('country', 'País', 'Country'),
  a('postalCode', 'CEP', 'Postal code'),
  a('createdAt', 'Criado em', 'Created at'),
  a('updatedAt', 'Atualizado em', 'Updated at'),
];

const UPSERT_EXTRA_ATTRIBUTES = [
  a('created', 'Contato novo (true/false)', 'New contact (true/false)'),
  a('matchedBy', 'Encontrado por (email/phone)', 'Matched by (email/phone)'),
  a('otherMatchIds', 'Outros contatos parecidos', 'Other matching contacts'),
];

const TASK_ATTRIBUTES = [
  a('id', 'ID da tarefa', 'Task ID'),
  a('name', 'Nome', 'Name'),
  a('description', 'Descrição', 'Description'),
  a('type', 'Tipo', 'Type'),
  a('priority', 'Prioridade', 'Priority'),
  a('status', 'Status', 'Status'),
  a('dueDate', 'Prazo', 'Due date'),
  a('completedAt', 'Concluída em', 'Completed at'),
  a('cardId', 'ID do Card', 'Card ID'),
  a('cardTitle', 'Título do Card', 'Card title'),
  a('assigneeIds', 'IDs dos responsáveis', 'Assignee IDs'),
  a('createdAt', 'Criada em', 'Created at'),
  a('updatedAt', 'Atualizada em', 'Updated at'),
];

const EVENT_ATTRIBUTES = [
  a('eventId', 'ID do evento', 'Event ID'),
  a('eventAt', 'Data do evento', 'Event date'),
  a('webhookEventId', 'ID da entrega (evt_)', 'Delivery ID (evt_)'),
];

const MESSAGE_ATTRIBUTES = [
  a('messageId', 'ID da mensagem', 'Message ID'),
  a('content', 'Conteúdo', 'Content'),
  a('messageType', 'Tipo da mensagem', 'Message type'),
  a('sentAt', 'Enviada em', 'Sent at'),
  a('senderId', 'ID do remetente', 'Sender ID'),
  a('senderName', 'Remetente', 'Sender'),
  a('senderType', 'Tipo do remetente', 'Sender type'),
  a('attachmentUrls', 'Anexos (URLs)', 'Attachments (URLs)'),
  a('conversationId', 'ID da conversa', 'Conversation ID'),
  a('conversationStatus', 'Status da conversa', 'Conversation status'),
  a('inboxId', 'ID da caixa de entrada', 'Inbox ID'),
  a('contactId', 'ID do contato', 'Contact ID'),
  a('contactName', 'Nome do contato', 'Contact name'),
  a('contactEmail', 'E-mail do contato', 'Contact email'),
  a('contactPhone', 'Telefone do contato', 'Contact phone'),
  a('cardId', 'ID do Card', 'Card ID'),
  a('cardTitle', 'Título do Card', 'Card title'),
  a('boardId', 'ID do Board', 'Board ID'),
  a('phaseId', 'ID da Fase', 'Phase ID'),
  a('phaseName', 'Fase', 'Phase'),
];

/** `fields.<slug>` attributes of a Board's custom fields. */
async function fieldAttributes(client, boardId) {
  const structure = await ops.getBoardStructure(client, boardId, ['phases', 'fields']);
  return ops.cardFieldDefinitions(structure).map((def) => ({
    key: `fields.${def.slug}`,
    name: { pt_BR: def.label, en: def.label },
  }));
}

module.exports = {
  CARD_ATTRIBUTES,
  CONTACT_ATTRIBUTES,
  UPSERT_EXTRA_ATTRIBUTES,
  TASK_ATTRIBUTES,
  EVENT_ATTRIBUTES,
  MESSAGE_ATTRIBUTES,
  fieldAttributes,
};
