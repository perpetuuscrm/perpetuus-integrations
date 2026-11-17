# Contrato comum v1 dos conectores Perpetuus

Este documento é a fonte única para os conectores do Perpetuus CRM no **n8n**, no **Zapier** e no
**Make**. Cada conector expõe as mesmas operações, com os mesmos nomes de campo de entrada, a
mesma saída achatada e a mesma estratégia de deduplicação. Se um conector precisar divergir,
a divergência entra aqui primeiro.

- Versão do contrato: **v1** (2026-11-16)
- API: Perpetuus REST (Strapi 5), OpenAPI em `perpetuus-docs/public/openapi.json` do monorepo
- Implementação de referência: [`n8n/`](../n8n/); Zapier em [`zapier/`](../zapier/); Make em [`make/`](../make/)

## Sumário

1. [Convenções gerais](#1-convenções-gerais)
2. [Autenticação e teste de conexão](#2-autenticação-e-teste-de-conexão)
3. [Erros e limites](#3-erros-e-limites)
4. [Objetos de saída canônicos](#4-objetos-de-saída-canônicos)
5. [Gatilhos (polling)](#5-gatilhos-polling)
6. [Ações](#6-ações)
7. [Buscas](#7-buscas)
8. [Listas dinâmicas (dropdowns)](#8-listas-dinâmicas-dropdowns)
9. [Lacunas da API](#9-lacunas-da-api)
10. [Fora da v1](#10-fora-da-v1)

---

## 1. Convenções gerais

| Item | Regra |
|------|-------|
| Base URL | Configurável na credencial. Padrão: `https://api.perpetuus.com.br/api`. Todas as rotas abaixo são relativas a ela (ex.: `GET /boards` = `GET https://api.perpetuus.com.br/api/boards`). |
| IDs | Sempre o `documentId` (string) do Strapi. Nunca o `id` numérico. Na saída canônica ele vira `id`. |
| Nomes de campo | Chaves em **camelCase em inglês** e rótulos em inglês (exigência do n8n para nodes verificados; mantida nos três conectores). |
| Envelope de lista | `{ data: [...], meta: { pagination: { page, pageSize, pageCount, total } } }`. Exceção: `GET /tasks` devolve **array puro** e pagina com `limit`/`offset` (ver [Lacunas](#9-lacunas-da-api)). |
| Envelope de item | `{ data: {...} }` na maioria das rotas; algumas devolvem o objeto direto. O conector desembrulha os dois formatos. |
| Paginação | `pagination[page]` e `pagination[pageSize]`, com `pageSize` ≤ **100** (o backend corta acima disso). |
| Filtros | Sintaxe Strapi na query string com colchetes: `filters[createdAt][$gte]=2026-11-16T12:00:00.000Z`, `filters[currentPhase][documentId][$eq]=ph123`. |
| Ordenação | `sort=createdAt:asc` (ou `:desc`). |
| Datas | ISO 8601 em UTC na saída (`2026-11-16T12:00:00.000Z`). Na entrada, aceitar ISO 8601 com offset. |
| Valores vazios | Campo opcional não informado **não é enviado** (nunca enviar `""` ou `null` sem intenção explícita). |
| Organização | A chave de API já define a organização. O conector **não** envia `x-tenant-id`. |

Campos personalizados de card são identificados pelo **slug** do campo (ex.: `origem`,
`valor_proposta`). O título do card é o campo de slug `name`: o backend sincroniza
`title = fields.name`.

---

## 2. Autenticação e teste de conexão

| Item | Valor |
|------|-------|
| Tipo | API key (Bearer). Campos da credencial: `apiKey` (senha) e `baseUrl` (padrão de produção). |
| Header | `Authorization: Bearer ppt_…` |
| Teste | `GET /auth/token-info`, aceito com qualquer escopo |
| Rótulo da conta | `{{data.organization.name}} ({{data.user.email}})` |

Resposta do teste:

```json
{
  "data": {
    "credential": { "type": "pat", "id": "k2j3…", "name": "n8n", "scopes": ["crm:read", "crm:write"], "expiresAt": "2027-11-16T12:00:00.000Z" },
    "user": { "documentId": "us1a2b3c", "email": "voce@empresa.com", "username": "luis" },
    "organization": { "documentId": "or1a2b3c", "slug": "acme", "name": "Acme Ltda" }
  }
}
```

Como criar a chave (texto usado nos três conectores): no Perpetuus, **Configurações → API
Tokens e MCP → Conectar sua IA (MCP) → Conectar editor → Conectar novo editor**. Dê um nome,
escolha a validade (1 a 365 dias) e marque os escopos `crm:read` e `crm:write`. A chave
`ppt_…` aparece uma vez só.

Escopos usados na v1:

| Escopo | Operações |
|--------|-----------|
| `crm:read` | Todos os gatilhos, todas as buscas e todos os dropdowns |
| `crm:write` | Todas as ações (inclui `crm:read`) |

Recomendação ao usuário: criar a chave com `crm:write` (que já inclui leitura).

---

## 3. Erros e limites

### 3.1 Limites de requisição

- 120 requisições/min por chave e 600/min por organização (janela fixa de 60 s).
- Toda resposta traz `X-RateLimit-Limit`, `X-RateLimit-Remaining` e `X-RateLimit-Reset`.
- Ao estourar: **429** com `Retry-After` (segundos) e `error.details.retryAfter`.

### 3.2 Política de nova tentativa (igual nos três conectores)

| Situação | O que o conector faz |
|----------|----------------------|
| 429 com `Retry-After` ≤ 60 s | Espera `Retry-After` (+ até 1 s) e tenta de novo, no máximo **2 vezes**. Depois, falha com a mensagem de 429. |
| 429 com `Retry-After` > 60 s | Falha na hora com a mensagem de 429 (o agendador da plataforma tenta no próximo ciclo). |
| 5xx ou timeout em `GET` | Uma nova tentativa após 1 s. |
| 5xx ou timeout em `POST`/`PUT` | **Não** repete: a API não aceita chave de idempotência nessas rotas e repetir pode duplicar card ou tarefa (ver Lacunas). |
| 4xx (exceto 429) | Não repete. |

No Zapier, o 429 final vira `ThrottledError(retryAfter)`; no Make, `RateLimitError`.

**Ajuste do Zapier:** cada passo do Zapier tem cerca de 30 s de execução, então a espera
dentro da chamada só acontece com `Retry-After` ≤ **10 s** (ainda no máximo 2 vezes). Acima
disso, o conector lança `ThrottledError` na hora com o `Retry-After` (60 s quando a API não
manda) e o próprio Zapier repete o passo depois. O resto da tabela vale igual.

**Ajuste do Make:** um módulo do Make não consegue esperar nem repetir uma requisição que voltou
com erro HTTP. O 429 vira `RateLimitError` na hora (o Make pausa o cenário e tenta de novo depois,
sem contar como erro consecutivo). 5xx em leitura (gatilhos, buscas, RPCs) fica `ConnectionError`
(o Make tenta de novo no ciclo seguinte); 5xx em `POST`/`PUT` vira `RuntimeError`, para o Make não
repetir a escrita e duplicar card, tarefa ou contato. 4xx não é repetido.

### 3.3 Mensagens de erro (texto canônico em inglês)

| HTTP | Quando | Mensagem do conector |
|------|--------|----------------------|
| 400 | Validação (campo obrigatório da fase de entrada, CPF/CNPJ inválido, tag inexistente, opção de select inválida) | `Perpetuus rejected the request: <error.message>` + `error.details` como descrição |
| 401 | Chave ausente, inválida, expirada ou revogada | `Invalid or expired Perpetuus API key. Create a new key in Settings → API Tokens e MCP and update the credential.` |
| 402 | Limite de contatos do plano (só no upsert que cria) | `Your Perpetuus plan contact limit was reached: <error.message>` |
| 403 com `PAT sem escopo X` | Falta escopo na chave | `The Perpetuus API key is missing the "X" scope. Create a key with the crm:write scope (it includes crm:read).` |
| 403 outro | Papel do usuário não permite, board sem acesso, contato fora da carteira (`CONTACT_OUT_OF_SCOPE`) | `Perpetuus denied access: <error.message>` |
| 404 | Board, card, contato ou fase não existe na organização | `Not found in Perpetuus: <error.message>` |
| 429 | Limite estourado após as tentativas | `Perpetuus rate limit reached (120 requests/min per key). Try again in N seconds.` |
| 5xx | Erro do servidor | `Perpetuus server error (HTTP N). Try again later.` |

O corpo de erro da API segue `{ data: null, error: { status, name, message, details } }`.

No Zapier o erro não tem campo de descrição: `error.details` (quando existe) é anexado à
mensagem como ` Details: <json>`, e o `code` do `z.errors.Error` identifica o caso
(`InvalidData`, `AuthenticationError`, `PlanLimitReached`, `MissingScope`, `Forbidden`,
`NotFound`, `ServerError`, `InvalidInput` para validação local).

No Make a mensagem vem prefixada com o status, como o Make recomenda (`[404] Not found in
Perpetuus: …`), e `error.details` é anexado como ` Details: <json>`. Tipos de erro: 400 →
`DataError` (pode ficar como execução incompleta), 401 → `InvalidAccessTokenError` (o cenário para e
o usuário é avisado), 429 → `RateLimitError`, 5xx → ver 3.2; o resto fica `RuntimeError`. Para o
403 de escopo, o Make usa `error.details.requiredScope` ou a última palavra da mensagem
(`PAT sem escopo crm:write`).

---

## 4. Objetos de saída canônicos

A saída é **achatada e estável**: as chaves abaixo existem sempre (com `null` quando não há
valor), nunca há objetos Strapi aninhados (`currentPhase.documentId` etc.) e listas são de
strings. A única chave de objeto é `fields`/`customFields` (mapa slug → valor), que o Zapier
achata como `fields__slug` e o Make expõe como coleção.

No Make, as chaves vêm da interface tipada de cada módulo (datas como `date`, `value` como número,
listas de IDs como arrays de texto); um valor ausente fica vazio no bundle em vez de `null`, que é
como o Make trata campos sem valor.

### 4.1 Contact

| Chave | Tipo | Origem na API |
|-------|------|---------------|
| `id` | string | `documentId` |
| `name` | string | `name` |
| `email` | string \| null | `email` |
| `phone` | string \| null | `phone` (E.164 quando gravado pelo upsert) |
| `contactType` | `"person"` \| `"company"` \| null | `contact_type` (`pessoa` → `person`, `empresa` → `company`) |
| `cpf` | string \| null | `cpf` |
| `cnpj` | string \| null | `cnpj` |
| `address` | string \| null | `address` |
| `city` | string \| null | `city` |
| `state` | string \| null | `state` |
| `country` | string \| null | `country` |
| `postalCode` | string \| null | `postal_code` |
| `customFields` | object | `customFields` (mapa chave → valor) |
| `createdAt` | ISO string | `createdAt` |
| `updatedAt` | ISO string | `updatedAt` |

Saída do upsert: Contact + `created` (boolean, `meta.created`), `matchedBy`
(`"email"` \| `"phone"` \| null, `meta.matchedBy`) e `otherMatchIds` (string[], de
`meta.otherMatches`, vazio quando não há).

### 4.2 Card

| Chave | Tipo | Origem na API |
|-------|------|---------------|
| `id` | string | `documentId` |
| `title` | string | `title` |
| `boardId` | string \| null | `board.documentId` (ou o board da requisição) |
| `phaseId` | string \| null | `currentPhase.documentId` |
| `phaseName` | string \| null | `currentPhase.name` |
| `phaseEnteredAt` | ISO string \| null | `currentPhaseEnteredAt` |
| `contactId` | string \| null | `contact.documentId` |
| `contactName` | string \| null | `contact.name` |
| `contactEmail` | string \| null | `contact.email` |
| `contactPhone` | string \| null | `contact.phone` |
| `value` | number \| null | `value` (decimal → número) |
| `dueDate` | ISO string \| null | `dueDate` |
| `description` | string \| null | `description` |
| `tagIds` | string[] | `tags[].documentId` |
| `tagNames` | string[] | `tags[].name` |
| `fields` | object | `fields` (mapa slug → valor que o backend monta de `fieldData`; se vier só `fieldData`, o conector monta o mapa com `fieldData[].field.slug` → `value.val`) |
| `createdAt` | ISO string | `createdAt` |
| `updatedAt` | ISO string | `updatedAt` |

Populate usado em toda leitura de card:
`populate[contact]=true&populate[currentPhase]=true&populate[tags]=true&populate[fieldData][populate][0]=field`.

### 4.3 Task

| Chave | Tipo | Origem na API |
|-------|------|---------------|
| `id` | string | `documentId` |
| `name` | string | `name` |
| `description` | string \| null | `description` |
| `type` | `reminder` \| `follow-up` \| `action` \| `other` | `type` |
| `priority` | `low` \| `medium` \| `high` \| `urgent` | `priority` |
| `status` | string | `taskStatus` (texto livre configurado no board) |
| `dueDate` | ISO string \| null | `dueDate` |
| `completedAt` | ISO string \| null | `completedAt` |
| `cardId` | string \| null | `card.documentId` |
| `cardTitle` | string \| null | `card.title` |
| `assigneeIds` | string[] | `assignees[].documentId` (memberships) |
| `createdAt` | ISO string | `createdAt` |
| `updatedAt` | ISO string | `updatedAt` |

`boardId` não aparece na tarefa porque `task.board` é privado na API (ver Lacunas).

### 4.4 Campos extras dos gatilhos

Todo item emitido por um gatilho tem, além do objeto canônico:

| Chave | Tipo | Uso |
|-------|------|-----|
| `eventId` | string | Chave de deduplicação (seção 5). No Zapier é o campo `id` do resultado do gatilho (o objeto canônico vai com o id da entidade em `cardId`/`contactId`/`taskId`, ver 5.6). No Make é o `trigger.id`. |
| `eventAt` | ISO string | Carimbo usado como cursor (seção 5). No Make é o `trigger.date`. |

---

## 5. Gatilhos (polling)

Webhooks virão depois (ver Lacunas). Na v1 todos os gatilhos são polling com **cursor por
carimbo de tempo** e um conjunto pequeno de chaves já vistas no carimbo de fronteira.

### 5.1 Algoritmo comum

Estado persistido por gatilho (n8n: `getWorkflowStaticData('node')`; Make: estado do
módulo; Zapier: dispensável, a deduplicação é da plataforma, mas a ordenação e o filtro
`since` valem igual):

```ts
type PollState = {
  initialized: boolean;   // primeira execução já marcou o cursor
  cursor: string | null;  // maior eventAt já visto (ISO); null = ainda não havia nenhum item
  seen: string[];         // eventIds com eventAt === cursor (fronteira)
  key: string;            // assinatura dos parâmetros (board, fase...); mudou → reinicia
};
```

1. **Primeira execução** (ou parâmetros mudaram): busca só o item mais recente
   (`sort=<campo>:desc`, `pageSize=1`). Grava `cursor = eventAt` dele e `seen = [eventId]`.
   **Não emite nada.** Se não houver item, grava `cursor = null` (qualquer item futuro é
   novo; evita depender do relógio do servidor da automação).
2. **Execuções seguintes**: busca `filters[<campo>][$gte]=cursor` (sem filtro quando
   `cursor = null`) com `sort=<campo>:asc`, `pageSize=100`, até **5 páginas** (500 eventos)
   por ciclo. Descarta os `eventId` em `seen`. Emite os demais **do mais antigo para o mais
   novo**.
3. Novo cursor = maior `eventAt` lido; novo `seen` = `eventId`s com esse carimbo (somados ao
   `seen` anterior se o cursor não mudou). Como a leitura é ascendente, um volume acima de
   500 eventos é drenado nos ciclos seguintes, sem buraco.
4. **Execução manual / teste** (n8n `getMode() === 'manual'`, amostra do Zapier/Make):
   devolve o item mais recente (`sort=<campo>:desc`, `pageSize=1`) **sem mexer no estado**.
   Sem itens, o n8n mostra erro amigável pedindo para criar um registro de teste.

### 5.2 New Card (`newCard`)

| Item | Valor |
|------|-------|
| Entrada | `boardId` (obrigatório) |
| Rota | `GET /boards/{boardId}/cards` |
| Query | `filters[createdAt][$gte]=<cursor>&sort=createdAt:asc&pagination[pageSize]=100&stats=false` + populate de card |
| `eventAt` | `createdAt` |
| `eventId` | `{cardId}` |
| Saída | Card + `eventId` + `eventAt` |
| Escopo | `crm:read` |

### 5.3 Card Entered Phase (`cardEnteredPhase`)

| Item | Valor |
|------|-------|
| Entrada | `boardId` (obrigatório), `phaseId` (opcional; vazio = qualquer fase) |
| Rota | `GET /boards/{boardId}/cards` |
| Query | `filters[currentPhaseEnteredAt][$notNull]=true&filters[currentPhaseEnteredAt][$gte]=<cursor>&sort=currentPhaseEnteredAt:asc&pagination[pageSize]=100&stats=false` (+ `filters[currentPhase][documentId][$eq]=<phaseId>`) + populate de card. O `$notNull` também vale na busca do mais recente: no PostgreSQL, `NULL` vem primeiro em `desc` e cards antigos sem o carimbo apareceriam como "mais recentes". |
| `eventAt` | `currentPhaseEnteredAt` |
| `eventId` | `{cardId}:{phaseId}:{currentPhaseEnteredAt}` |
| Saída | Card + `eventId` + `eventAt` |
| Escopo | `crm:read` |

**Sem suporte direto na API:** não há evento nem histórico consultável de movimentação. O
conector detecta a entrada pela mudança de `currentPhaseEnteredAt`, que o backend grava a cada
transição de fase (`services/card/phase-transition.ts`) e na criação do card (fase inicial).
Consequências documentadas ao usuário:

- Um card criado conta como "entrou na fase inicial".
- Se o card passar por duas fases entre dois ciclos de polling, só a fase atual é vista.
- O `eventId` inclui o carimbo para que a **reentrada** na mesma fase dispare de novo
  (`{cardId}:{phaseId}` sozinho bloquearia a reentrada no Zapier, que guarda os ids vistos
  por muito tempo).

### 5.4 New Contact (`newContact`)

| Item | Valor |
|------|-------|
| Entrada | nenhuma |
| Rota | `GET /contacts` |
| Query | `filters[createdAt][$gte]=<cursor>&sort=createdAt:asc&pagination[pageSize]=100` |
| `eventAt` | `createdAt` |
| `eventId` | `{contactId}` |
| Saída | Contact + `eventId` + `eventAt` |
| Escopo | `crm:read` |

Observação: a lista respeita a carteira do usuário dono da chave (módulo de times); um
operador só vê os contatos da própria carteira.

### 5.5 Task Completed (`taskCompleted`)

| Item | Valor |
|------|-------|
| Entrada | `boardId` (opcional; vazio = todos os boards que o usuário acessa) |
| Rota | `GET /tasks` |
| Query | `filters[completedAt][$notNull]=true&filters[completedAt][$gte]=<cursor>&sort=completedAt:asc&limit=100&offset=<n>` (+ `filters[board][documentId]=<boardId>`) |
| `eventAt` | `completedAt` |
| `eventId` | `{taskId}:{completedAt}` |
| Saída | Task + `eventId` + `eventAt` |
| Escopo | `crm:read` |

**Suporte parcial na API:** `GET /tasks` devolve array puro (sem `meta.pagination`) e pagina
com `limit`/`offset`; o conector para quando a página vem com menos de `limit` itens. O
`completedAt` só é carimbado na **primeira** conclusão; reabrir e concluir de novo não muda o
carimbo e não dispara outra vez (ver Lacunas). Com `taskVisibility = assignees_only`, um
operador só vê as tarefas em que é responsável.

### 5.6 Notas por plataforma

- **n8n**: node `Perpetuus Trigger` (polling, `polling: true`), estado em
  `getWorkflowStaticData('node')`. O intervalo é o "Poll Times" do n8n.
- **Zapier**: trigger polling com `perform` usando os mesmos filtros de base (`$notNull`,
  fase, board), devolvendo do mais novo para o mais antigo (exigência do Zapier) e com
  `id = eventId`; a entidade sai em `cardId`/`contactId`/`taskId` além dos campos canônicos e
  de `eventId`/`eventAt`. O Zapier não guarda cursor para o app, então **toda** chamada usa
  `sort=<campo>:desc` com 100 itens (tarefas: `limit=100&offset=0`), sem filtro `$gte`, e a
  deduplicação por `id` fica com a plataforma. Mais de 100 eventos entre dois ciclos: os mais
  antigos não são vistos.
- **Make**: módulo trigger de polling com `trigger: { type: "date", order: "desc", id: <eventId>,
  date: <eventAt> }`. O Make recomenda ler do mais novo para o mais antigo (limite de 3200 registros
  por varredura), então a consulta usa `sort=<campo>:desc` e o filtro `$gte` com o carimbo que o
  próprio Make guarda da execução anterior (`data.lastDate`), com paginação (`pagination[page]`;
  tarefas: `offset`). O Make guarda o último carimbo e ID e descarta o que já devolveu, então não há
  estado próprio do conector. O `epoch` ("Choose where to start") oferece "From now on", "Since
  specific date", "All" e os últimos 300 itens; o `limit` (obrigatório, padrão 10) limita os
  bundles por execução e o restante sai no ciclo seguinte. Os campos `eventId`/`eventAt` também saem
  no bundle.

---

## 6. Ações

Toda ação devolve **um** objeto canônico.

### 6.1 Create or Update Contact (`upsertContact`)

| Item | Valor |
|------|-------|
| Rota | `POST /contacts/upsert` |
| Escopo | `crm:write` |

Entrada:

| Campo | Tipo | Obrigatório | Envio na API |
|-------|------|-------------|--------------|
| `email` | string | um de `email`/`phone` | `data.email` |
| `phone` | string | um de `email`/`phone` | `data.phone` (qualquer formato brasileiro) |
| `name` | string | sim ao criar | `data.name` |
| `matchBy` | (`email` \| `phone`)[] | não (padrão `["email","phone"]`) | `matchBy` |
| `contactType` | `person` \| `company` | não | `data.contact_type` (`pessoa`/`empresa`) |
| `cpf` | string | não | `data.cpf` |
| `cnpj` | string | não | `data.cnpj` |
| `address` | string | não | `data.address` |
| `city` | string | não | `data.city` |
| `state` | string | não | `data.state` |
| `country` | string | não | `data.country` |
| `postalCode` | string | não | `data.postal_code` |
| `customFields` | object (chave → texto) | não | `data.customFields` |

Corpo: `{ "data": { … }, "matchBy": ["email", "phone"] }`.
Resposta: `{ data: <contato>, meta: { created, matchedBy, otherMatches? } }` → Contact +
`created` + `matchedBy` + `otherMatchIds`.

Validação no conector antes de chamar: exigir `email` ou `phone`.

No Make não há como interromper o módulo antes da requisição; a exigência de `email` ou `phone`
fica no texto de ajuda e a API responde 400 se faltarem os dois. `customFields` é informado como
lista de pares chave/valor e enviado como objeto.

### 6.2 Create Card (`createCard`)

| Item | Valor |
|------|-------|
| Rota | `POST /boards/{boardId}/cards`; se `phaseId` diferir da fase inicial, `PUT /boards/{boardId}/cards/{cardId}` com `{ data: { currentPhase } }`; por fim `GET /boards/{boardId}/cards/{cardId}` com populate de card |
| Escopo | `crm:write` |

Entrada:

| Campo | Tipo | Obrigatório | Envio na API |
|-------|------|-------------|--------------|
| `boardId` | string | sim | caminho |
| `title` | string | sim | `data.fields.name` (o backend sincroniza `title`) |
| `phaseId` | string | não | movimento após criar (ver abaixo) |
| `contactId` | string | não | `data.contact` |
| `tagIds` | string[] | não | `data.tags` (aceita documentId ou slug) |
| `value` | number | não | `data.value` |
| `dueDate` | ISO string | não | `data.dueDate` |
| `description` | string | não | `data.description` |
| `assigneeIds` | string[] | não | `data.assignees` (membership documentIds) |
| `fields` | object (slug → valor) | depende do board | `data.fields` (mesclado com `name`) |

Valores de `fields` por tipo de campo: texto/select/radio/email/url/phone → string;
`number`/`currency` → número; `date`/`datetime` → ISO; `multiselect`/`text_list`/`url_list` →
string[]; `switch`/`checkbox` → boolean. Campos `statement` e `whatsapp_link` não recebem
valor. Os campos **obrigatórios da fase de formulário (ordem 0)** precisam ir em `fields`
(o backend responde 400 listando os faltantes).

**Sem suporte direto na API:** o card sempre nasce na fase inicial do fluxo; não há como
criá-lo direto em outra fase. O conector cria e, se `phaseId` for outra fase, move em seguida
(duas chamadas, não atômicas). Se o movimento falhar, o conector devolve o card criado com
`warning` explicando e não repete a criação.

Vincular contato: suportado (`data.contact` = documentId do contato).

No Zapier, os campos do board viram entradas dinâmicas `fields__<slug>` (carregadas da
estrutura do board escolhido) e há também o dicionário `fields` para boards mapeados de um
passo anterior; o conector junta os dois em `data.fields`.

No Make, os campos do board aparecem abaixo do campo `boardId` (RPC de campos dinâmicos, com o
`slug` como nome e o tipo do Make correspondente; obrigatórios só os da fase de formulário) e o
`fields` é uma lista de pares slug/valor para boards mapeados de um passo anterior; os dois são
juntados em `data.fields`. Um campo custom cujo slug coincide com uma entrada do módulo (`title`,
`value`, `description`…) só pode ser preenchido por `fields`. Como o Make não tem sucesso parcial,
se o movimento para `phaseId` falhar o módulo falha depois de criar o card (não há `warning`); a
mensagem de erro diz o que aconteceu e o card fica na fase inicial.

### 6.3 Move Card to Phase (`moveCard`)

| Item | Valor |
|------|-------|
| Rota | `PUT /boards/{boardId}/cards/{cardId}`, corpo `{ data: { currentPhase: phaseId, reason? } }`, depois `GET` do card com populate |
| Entrada | `boardId`, `cardId`, `phaseId` (todos obrigatórios), `reason` (opcional) |
| Saída | Card |
| Escopo | `crm:write` |

### 6.4 Add Tags to Card (`addCardTags`)

| Item | Valor |
|------|-------|
| Rota | `GET /boards/{boardId}/cards/{cardId}?populate[tags]=true`, depois `PUT /boards/{boardId}/cards/{cardId}` com `{ data: { tags: [...existentes, ...novas] } }`, depois `GET` do card com populate |
| Entrada | `boardId`, `cardId`, `tagIds` (string[], documentId ou slug; obrigatório) |
| Saída | Card |
| Escopo | `crm:write` |

**Sem suporte direto na API:** `tags` no `PUT` **substitui** a lista. O conector lê as tags
atuais, soma as novas sem repetir e grava. Há janela de corrida se outra pessoa mexer nas
tags do mesmo card entre a leitura e a escrita (ver Lacunas).

### 6.5 Create Task (`createTask`)

| Item | Valor |
|------|-------|
| Rota | `POST /tasks`, corpo `{ data: { name, card?, board?, … } }` |
| Escopo | `crm:write` |

Entrada:

| Campo | Tipo | Obrigatório | Envio na API |
|-------|------|-------------|--------------|
| `name` | string | sim | `data.name` |
| `boardId` | string | um de `boardId`/`cardId` | `data.board` (ignorado pela API quando há card) |
| `cardId` | string | um de `boardId`/`cardId` | `data.card` (o board vem do card) |
| `description` | string | não | `data.description` |
| `dueDate` | ISO string | não | `data.dueDate` |
| `type` | `reminder` \| `follow-up` \| `action` \| `other` | não (padrão `follow-up`) | `data.type` |
| `priority` | `low` \| `medium` \| `high` \| `urgent` | não (padrão `medium`) | `data.priority` |
| `status` | string | não (padrão: primeiro status do board) | `data.taskStatus` |
| `assigneeIds` | string[] | não (padrão: quem criou) | `data.assignees` |

Saída: Task. A resposta do `POST` não popula `card`; o conector preenche `cardId` com o valor
enviado quando a resposta não traz.

---

## 7. Buscas

Buscas devolvem uma **lista** de objetos canônicos (n8n: um item por resultado; Zapier: o
primeiro é usado; Make: módulo search com `limit`). Lista vazia não é erro.

### 7.1 Find Contact (`findContact`)

| Item | Valor |
|------|-------|
| Rota | `GET /contacts` |
| Entrada | `searchBy` (`email` \| `phone` \| `text`, obrigatório), `value` (obrigatório), `limit` (padrão 50, máx. 100; o linter do n8n exige 50; n8n também tem `returnAll`) |
| Escopo | `crm:read` |

| `searchBy` | Query |
|------------|-------|
| `email` | `filters[email][$eqi]=<value>&sort=createdAt:asc` |
| `phone` | `quickSearch=<dígitos>&sort=createdAt:asc`, com `<dígitos>` = só números, sem o `55` inicial quando o número tiver 12+ dígitos |
| `text` | `quickSearch=<value>&sort=updatedAt:desc` (nome, e-mail, telefone, CPF, CNPJ) |

**Suporte parcial na API para telefone:** não existe busca exata com normalização de telefone
(o upsert normaliza, a listagem não). O `quickSearch` faz `contains` no texto gravado; com
telefone gravado em E.164 (`+5511999999999`), `11999999999` encontra, mas `1199999999`
(sem o nono dígito) não. Ver Lacunas.

Ordenação por `createdAt:asc` em e-mail/telefone: o primeiro resultado é o mesmo contato que
o upsert atualizaria (o mais antigo).

### 7.2 Find Card (`findCard`)

| Item | Valor |
|------|-------|
| Rota | `GET /boards/{boardId}/cards` |
| Entrada | `boardId` (obrigatório), `query` (texto no título), `phaseId`, `contactId` (todos opcionais), `limit` (padrão 50, máx. 100; o linter do n8n exige 50; n8n também tem `returnAll`) |
| Query | `filters[title][$containsi]=<query>&filters[currentPhase][documentId][$eq]=<phaseId>&filters[contact][documentId][$eq]=<contactId>&sort=updatedAt:desc&stats=false` + populate de card |
| Saída | Card[] |
| Escopo | `crm:read` |

A busca é sempre dentro de um board (não há busca global de cards na API). Para achar o card
de um contato por e-mail: Find Contact → Find Card com `contactId`.

No Zapier as buscas não expõem `limit`: leem até 50 resultados (o padrão) e o Zapier usa o
primeiro. Find Contact + Create or Update Contact formam o "Find or Create Contact".

No Make as buscas são módulos *search* (`searchContacts`, `searchCards`) que devolvem um bundle por
resultado, com páginas de 100 (`pagination[pageSize]=100`). O `limit` segue a convenção do Make:
opcional, padrão 10, e vazio devolve o máximo do contrato (100). Na busca por telefone sem nenhum
dígito o módulo não chama a API e devolve zero resultados, em vez de listar todos os contatos.

---

## 8. Listas dinâmicas (dropdowns)

| Lista | Rota | Valor / rótulo |
|-------|------|----------------|
| Boards | `GET /boards?pagination[pageSize]=100&sort=name:asc` (+ `filters[name][$containsi]` na busca) | `documentId` / `name` |
| Fases do board | `GET /boards/{boardId}/structure?include=phases` | `phases[].documentId` / `phases[].name` (ordenadas por `order`; fase de formulário marcada) |
| Tags do board | `GET /boards/{boardId}/structure?include=tags` | `tags[].documentId` / `tags[].name` |
| Campos do board | `GET /boards/{boardId}/structure?include=phases,fields` | `fields[].slug` / `fields[].label` (+ fase); `required` só vale na fase de ordem 0; `options[]` viram opções; sem `statement`, `whatsapp_link` e `name` (o título) |
| Cards do board | `GET /boards/{boardId}/cards?filters[title][$containsi]=<q>&sort=updatedAt:desc&pagination[pageSize]=50&stats=false` | `documentId` / `title` |
| Contatos | `GET /contacts?quickSearch=<q>&sort=updatedAt:desc&pagination[pageSize]=50` | `documentId` / `name (email)` |
| Membros do board | `GET /boards/{boardId}/members` | `members[].documentId` / nome ou e-mail |

A estrutura vem em `{ data: { board, phases, tags } }` (ou sem o envelope `data`).

No Zapier cada lista é um trigger oculto (`boardList`, `phaseList`, `tagList`, `memberList`,
`contactList`, `cardList`) referenciado como `dynamic: '<key>.id.<rótulo>'`. Os dropdowns do
Zapier não mandam texto de busca, então contatos e cards são listados por `updatedAt:desc`
com paginação do próprio Zapier (`bundle.meta.page`); para achar um registro específico há os
campos ligados às buscas (`search: 'findContact.id'` / `'findCard.id'`).

No Make cada lista é um RPC (`listBoards`, `listPhases`, `listTags`, `listMembers`, `listCards`,
`listContacts`) com até 300 itens (3 páginas de 100), e os campos do board são um RPC de campos
dinâmicos (`listCardFields`). Campos de card e de contato que recebem ID abrem em modo de mapeamento
(`mode: edit`), como o Make pede para módulos de atualização. Opções de campo gravadas como texto
simples (sem `{ label, value }`) viram campo de texto, com as opções listadas na ajuda.

---

## 9. Lacunas da API

Pontos em que a API atual não atende a v1 de forma direta. O conector contorna como descrito;
nenhuma rota foi inventada.

| # | Lacuna | Contorno na v1 | Proposta para o backend |
|---|--------|----------------|-------------------------|
| 1 | Sem webhooks/REST Hooks para gatilhos instantâneos | Polling com cursor (seção 5) | `POST/DELETE /webhook-subscriptions` (`{ event, targetUrl, filters }`) assinadas com HMAC, reaproveitando o emissor de eventos das automações (`card.created`, `card.phase_changed`, `contact.created`, `task.completed`) |
| 2 | Sem histórico de movimentação consultável | `currentPhaseEnteredAt` como cursor; perde fases intermediárias entre ciclos | `GET /boards/{boardId}/card-movements?since=&phaseId=` lendo `movementHistory` (from, to, movedAt, movedBy) com paginação |
| 3 | `completedAt` só é carimbado na primeira conclusão; reabrir não limpa | Uma tarefa reaberta e concluída de novo não dispara | Limpar `completedAt` ao sair de status concluído e carimbar de novo ao concluir |
| 4 | `GET /tasks` devolve array puro com `limit`/`offset`, sem `meta.pagination` e sem teto de `limit` | Conector pagina por `offset` e para na página curta | Padronizar `{ data, meta.pagination }` com `pageSize` ≤ 100, como cards e contatos |
| 5 | `task.board` é privado; a tarefa sem card não informa o board | `boardId` fora da saída de Task | Expor `board { documentId, name }` no `find`/`findOne` de tarefas |
| 6 | Busca de contato por telefone sem normalização | `quickSearch` com dígitos (seção 7.1) | `GET /contacts/lookup?email=&phone=` usando o mesmo `findUpsertMatch` do upsert (sem criar nada) |
| 7 | `tags` no `PUT` do card substitui a lista | Ler, mesclar e gravar (janela de corrida) | `POST /boards/{boardId}/cards/{cardId}/tags` com `{ add: [...], remove: [...] }` |
| 8 | Card sempre nasce na fase inicial | Criar e mover (duas chamadas) | Aceitar `data.currentPhase` no `POST /boards/{boardId}/cards`, validando os obrigatórios das fases anteriores |
| 9 | Sem `X-Idempotency-Key` nas rotas REST de escrita (só o MCP tem) | Conector não repete `POST`/`PUT` em 5xx/timeout | Aceitar `X-Idempotency-Key` em `POST /boards/{boardId}/cards`, `POST /tasks` e `POST /contacts/upsert` (cache de 24 h por chave + organização) |
| 10 | 403 de escopo só traz texto (`PAT sem escopo crm:write`) | Conector extrai o escopo da mensagem com regex | `error.details = { code: "MISSING_SCOPE", requiredScope: "crm:write" }` |
| 11 | Sem URL canônica do card/contato na resposta | Saída sem link | Incluir `url` (ex.: `https://app.perpetuus.com.br/boards/{boardId}?card={cardId}`) nas respostas |
| 12 | Sem lista de definições de campos personalizados de contato pensada para conectores | `customFields` como chave → valor livre | Documentar no OpenAPI a rota de definições (`contact-custom-fields`) para dropdown |

---

## 10. Fora da v1

- Enviar WhatsApp ou e-mail, campanhas, conversas.
- Qualquer exclusão (`DELETE`).
- Atualizar card (campos/valor/responsáveis) além de mover fase e adicionar tags.
- Gatilhos instantâneos (dependem da lacuna 1).
