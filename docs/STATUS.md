# Status dos conectores

**Atualizado em:** 17/11/2026 · **Contrato:** [v1-contract.md](v1-contract.md)

Este documento resume o que já foi feito nos conectores do n8n, do Zapier e do Make, o que falta para publicar cada um e os próximos passos. O detalhe técnico de cada operação (rotas, campos, saída, deduplicação, erros) está no contrato.

## Resumo

| Conector | Pasta | Versão | Código | Testes | Publicado |
|---|---|---|---|---|---|
| n8n (`n8n-nodes-perpetuus`) | [`n8n/`](../n8n/) | 0.1.2 | pronto | 53 testes, lint e build ok | **sim, npm com provenance**; verificação: revisão automática ok, manual aguardando vídeo |
| Zapier (Perpetuus CRM) | [`zapier/`](../zapier/) | 1.0.0 | pronto | 55 testes, `validate` ok | **app privado no Zapier** (id 249970, versão 1.0.0 enviada); falta testar e pedir revisão |
| Make (Perpetuus CRM) | [`make/`](../make/) | 1 | pronto | validação local ok (contrato + schemas do editor) | **app privado no Make** (`perpetuus-crm-ej2gdv`, versão 1, criado e enviado em 17/11/2026, zona us2); não foi testado contra a API real nem publicado |

Os três foram testados contra a API real em 17/11/2026 na org demo (`perpetuus-demo`): todas as ações, buscas e gatilhos passaram. Falham as listas que dependem de `GET /boards/{id}/structure`, que devolve 500 em produção (bug do backend). Detalhes em [Testes contra a API real](#testes-contra-a-api-real-17112026).

## O que a API do Perpetuus já oferece aos conectores

Entregue e em produção:

- **Chave de API (`ppt_…`)** como credencial oficial, com escopos (`crm:read`, `crm:write`, `chat:read`, `chat:write`, `ai:control`, `campaign:read`), validade de 1 a 365 dias e revogação. A organização vem da própria chave; o header `x-tenant-id` é opcional. Guia: [autenticação](https://docs.perpetuus.com.br/docs/api/autenticacao).
- **Teste de conexão:** `GET /api/auth/token-info` devolve a credencial, o usuário e a organização, sem nunca devolver a chave.
- **Limite de requisições:** 120 por minuto por chave e 600 por organização, com headers `X-RateLimit-*` e resposta 429 com `Retry-After`.
- **Criar ou atualizar contato:** `POST /api/contacts/upsert`, casando por e-mail e depois telefone, dentro da organização.
- **Estrutura do board numa chamada:** `GET /api/boards/:id/structure?include=phases,fields,tags,conditions`, usada nas listas de fases, tags e campos custom.
- **Chave só de leitura** alcança todas as leituras, inclusive as que usam POST.

## Escopo v1 (igual nos três conectores)

- **Gatilhos (por polling):** New Card, Card Entered Phase, New Contact, Task Completed.
- **Ações:** Create or Update Contact, Create Card (com campos custom do board), Move Card to Phase, Add Tags to Card, Create Task.
- **Buscas:** Find Contact, Find Card (no Make, Search contacts e Search cards). No Zapier, também Find or Create Contact.
- **Listas dinâmicas:** boards, fases, tags, membros (e contatos e cards no Zapier e no Make).
- **Só no Make:** o módulo universal Make an API call, exigido na revisão.
- **Fora da v1:** enviar WhatsApp ou e-mail, campanhas e qualquer exclusão.

## n8n

### Feito

- Pacote `n8n-nodes-perpetuus` no padrão atual de community nodes, sem dependências de runtime (`n8n-workflow` só como peer).
- Credencial `PerpetuusApi`: chave em campo senha, base URL configurável (padrão de produção) e teste em `/auth/token-info`.
- Node **Perpetuus** com as ações e buscas do contrato, seletores de board, card e contato (lista, ID ou URL do app) e mapeador de campos custom com tipos e opções.
- Node **Perpetuus Trigger** com os 4 gatilhos. Guarda um cursor (maior carimbo de tempo visto + IDs desse carimbo), não dispara o histórico na primeira execução e processa até 500 eventos por ciclo sem perder os restantes.
- Cliente HTTP único com respeito a `Retry-After` e mensagens de erro claras (401, 403 com o escopo que falta, 429).
- Ícones claro e escuro, 3 templates de workflow em [`n8n/templates/`](../n8n/templates/), README e CHANGELOG.
- CI (`.github/workflows/n8n-ci.yml`: lint, testes, build) e publicação com provenance por tag `n8n-v*` (`n8n-publish.yml`, usa o secret `NPM_TOKEN`).

### Publicação e verificação (17/11/2026)

- **Publicado no npm:** [`n8n-nodes-perpetuus`](https://www.npmjs.com/package/n8n-nodes-perpetuus), `latest` = **0.1.2**, com provenance SLSA assinada pelo GitHub Actions (tag `n8n-v0.1.2`). Conta npm `perpetuuscrm` (2FA ligado), organização `perpetuus`.
- **Repositório público:** o npm só aceita provenance de repositório público, então `perpetuuscrm/perpetuus-integrations` passou a ser público.
- **Histórico de versões:**
  - 0.1.0 nunca foi publicada (faltava `publishConfig.access: public`).
  - 0.1.1 foi a primeira publicação.
  - 0.1.2 trocou o e-mail de autor para `luis.santos@perpetuus.com.br`, porque o Creator Portal manda o token de posse para o e-mail de autor e `contato@` não recebia.
  - Existe ainda uma versão `0.0.0-stage`, publicada pelo próprio `n8n-node release` no mesmo run da 0.1.1. Pendente marcar como deprecated.
- **Creator Portal** (usuário `perpetuus`): pacote submetido.
  - Revisão automática: **COMPLETE** ("Your node has passed the automated review process").
  - Revisão manual: **AWAITING VIDEO**.

### Falta para a verificação

1. **Testar contra a API real** com uma chave `ppt_` (`crm:read` e `crm:write`) de uma organização de demonstração com dados fictícios. Ainda não foi feito; os testes atuais usam HTTP simulado. Pontos a conferir:
   - os filtros dos gatilhos em `currentPhaseEnteredAt` e `completedAt`;
   - o formato de `/boards/:id/structure` e da lista de membros.
2. **Vídeo para a revisão manual:** até 5 minutos, sem cortes, gravado no Loom ou similar. Precisa mostrar:
   1. a instalação da versão submetida pelo npm numa instância n8n;
   2. o node inserido num workflow;
   3. a criação da credencial com o teste passando;
   4. as ações mais comuns;
   5. o node como ferramenta de um AI Agent (`usableAsTool: true` já está no código).

   Depois, enviar o link no portal e clicar em "Submit for review".
3. **Trusted Publishing no npm:** ligar o pacote ao workflow `n8n-publish.yml` e então apagar o secret `NPM_TOKEN`. O npm avisou que tokens que pulam o 2FA estão sendo restringidos.
4. **Creator verificado:** o portal pede mais 3 templates de workflow publicados.

Observação: o `@n8n/node-cli` pede Node 24; localmente funciona no 22 com aviso, e o CI usa o 24.

## Zapier

### Feito

- App em JavaScript (CommonJS, formato do template oficial) com `zapier-platform-core` 19.3.0 e runtime Node 22.
- Autenticação por chave (`apiKey` em campo senha e `baseUrl` opcional, só HTTPS). Teste em `/auth/token-info`; a conexão aparece como "Organização (e-mail)".
- Middleware que monta a URL, envia o Bearer e traduz 401, 403 e 429 nas mensagens do contrato. Espera no próprio passo só quando `Retry-After` é de até 10 segundos; acima disso devolve `ThrottledError` e o Zapier repete o passo depois.
- 4 gatilhos por polling, 5 ações, 2 buscas e Find or Create Contact.
- Em Create Card, os campos custom do board aparecem como campos dinâmicos (`fields__<slug>`), obrigatórios só na fase de formulário; também aceita um dicionário `fields` quando o board vem de um passo anterior.
- Dropdowns por gatilhos ocultos (boards, fases, tags, membros, contatos e cards) e `sample` com dados fictícios em toda operação.
- Testes com Jest e nock cobrindo autenticação, cada operação e os erros 400, 401, 402, 403, 404, 429 e 5xx.
- `zapier-platform validate`: 27 verificações ok. Resta o aviso D026 (validação manual do campo `baseUrl`), que não bloqueia e é respondido na revisão.
- CI em `.github/workflows/zapier-ci.yml` (testes e validate).

### Como os gatilhos deduplicam

O Zapier não guarda cursor para o app: cada verificação lê os 100 itens mais recentes, do mais novo para o mais antigo, e o Zapier descarta os `id` já vistos.

- New Card: `id = cardId`.
- Card Entered Phase: `id = cardId:phaseId:currentPhaseEnteredAt` (voltar à mesma fase dispara de novo).
- New Contact: `id = contactId`.
- Task Completed: `id = taskId:completedAt`.

Limitação: se entrarem mais de 100 eventos entre duas verificações, os mais antigos não são vistos. Some com webhooks.

### Falta para publicar

1. ~~Conta de desenvolvedor no Zapier~~ (feita com `luis.santos@perpetuus.com.br`; trial Pro até 01/12/2026).
2. ~~Cadastrar e enviar o app~~ (feito em 17/11/2026): registrado como **Perpetuus CRM**, privado, categoria CRM, id `249970` (`zapier/.zapierapprc` commitado), e a versão 1.0.0 enviada com `push` (build e validação ok).
3. **Listagem no painel do Zapier:** categoria, descrição começando com "Perpetuus CRM is a…", homepage e logo PNG quadrado de 256×256 (ainda não existe).
4. **Testar cada operação num Zap ligado** com pelo menos uma execução bem-sucedida (contra a API real).
5. **Conta de teste** `integration-testing@zapier.com` na organização de demonstração, sem expiração e com todos os recursos.
6. **Beta:** convidar clientes e chegar a 3 usuários com Zaps ativos (checks S001 e S002); então pedir a publicação e responder o D026.

## Make

### Feito

- Custom app em [`make/app/`](../make/app/) no formato de *local development* da extensão Make Apps Editor (VS Code): `makecomapp.json` e um arquivo por código de componente (`*.communication.iml.json`, `*.mappable-params.iml.json`, `*.interface.iml.json`…), pronto para "Deploy to Make" num app vazio. O mesmo conjunto de arquivos serve para o upload pelo SDK `@makehq/sdk`, que o Make passou a recomendar (o README tem o mapeamento de seções).
- Base com URL vinda da conexão (padrão de produção), `Authorization: Bearer`, sanitização do header nos logs e mensagens do contrato para 400, 401, 402, 403 (com o escopo que falta), 404, 429 e 5xx. O 429 é `RateLimitError`; 5xx em escrita é `RuntimeError` para não duplicar.
- Conexão por chave de API (campo senha) e base URL opcional, validada em `/auth/token-info`, com rótulo "Organização (e-mail)".
- 4 gatilhos por polling (Watch new cards, Watch cards entering a phase, Watch new contacts, Watch completed tasks) com `limit`, epoch "Choose where to start", ordem decrescente e filtro pelo carimbo que o Make guarda.
- 5 ações (Create or update a contact, Create a card, Move a card to a phase, Add tags to a card, Create a task), 2 buscas paginadas com `limit` (Search contacts, Search cards) e o módulo universal Make an API call.
- 7 RPCs: boards, fases, tags, membros, cards e contatos (até 300 itens, paginados) e os campos custom do board como campos dinâmicos em Create a card.
- Interfaces tipadas com os nomes do contrato, amostras com dados fictícios, labels e ajuda em inglês no padrão do Make. Sem funções IML custom (o deploy delas pode ser bloqueado para desenvolvedores externos).
- Validação local em [`make/scripts/validate.mjs`](../make/scripts/validate.mjs): JSON, referências, regras da revisão do Make, nomes de campos lidos do contrato, expressões IML, segredos e os schemas oficiais do editor (copiados em [`make/schemas/`](../make/schemas/)). CI em `.github/workflows/make-ci.yml`.
- Cenários de teste passo a passo em [`make/docs/test-scenarios.md`](../make/docs/test-scenarios.md), cobrindo todos os módulos, paginação e um cenário de erro.
- App privado **Perpetuus CRM** criado e enviado em 17/11/2026 na zona us2 (`perpetuus-crm-ej2gdv`, versão 1), com base, conexão, 7 RPCs, 12 módulos, grupos e documentação. O Make atribuiu o nome `perpetuus-crm-ej2gdv` (o pedido era `perpetuus-crm`). Origem e `idMapping` estão em [`make/app/makecomapp.json`](../make/app/makecomapp.json). O app não foi publicado.

### Como os gatilhos deduplicam

O próprio Make guarda a data e o ID do último item. Cada execução lê do mais novo para o mais antigo com `$gte` a partir dessa data e o Make descarta o que já devolveu, usando o `trigger.id` (= `eventId` do contrato):

- Watch new cards: `cardId`; Watch new contacts: `contactId`.
- Watch cards entering a phase: `cardId:phaseId:currentPhaseEnteredAt` (voltar à mesma fase dispara de novo).
- Watch completed tasks: `taskId:completedAt`.

Acima do `limit`, o restante sai nas execuções seguintes.

### Falta para publicar

1. ~~**Conta no Make** (organização da Perpetuus) e um token da API do Make com `sdk-apps:read` e `sdk-apps:write`.~~ (feito em 17/11/2026, com `luis.santos@perpetuus.com.br`).
2. ~~**Criar o app e fazer o deploy de `make/app`.**~~ Feito em 17/11/2026: o app privado **Perpetuus CRM** (`perpetuus-crm-ej2gdv`, versão 1, zona us2.make.com) foi criado e o código foi enviado (base, conexão, 7 RPCs, 12 módulos, grupos e documentação). A origem e o `idMapping` estão em `makecomapp.json`. O Make atribuiu o nome `perpetuus-crm-ej2gdv` (o pedido era `perpetuus-crm`). Sem logo ainda (PNG 512×512). O app não foi testado contra a API real nem publicado.
3. **Testar contra a API real** com a organização de demonstração: conexão, cada RPC no editor e os cenários de `make/docs/test-scenarios.md`. Pontos a conferir: expressões IML que não rodam fora do Make (`toCollection`/`toArray` dos campos custom, regex do telefone, filtro `data.lastDate`), formato das opções dos campos select e o `value` decimal.
4. **Rodar os cenários no mesmo dia** do pedido de revisão, sem dados pessoais nos logs, e apagar módulos ou conexões de teste (a publicação não pode ser desfeita).
5. **Publicar** o app, deixar os módulos visíveis e enviar o formulário de revisão com o link da documentação da API e dos cenários.
6. **Technology Partner** (opcional, depois da aprovação): pedido ao programa de parceiros do Make, com contato de parceria e de suporte.

## Testes contra a API real (17/11/2026)

Org demo `perpetuus-demo` (plano DOMINION), chave `ppt_` com `crm:read` e `crm:write`, base `https://api.perpetuus.com.br/api`. A org estava vazia, então o teste criou um board próprio ("TESTE conector - board", template padrão `pre-vendas-sdr`) e duas tags. Todos os registros levaram o prefixo "TESTE conector" e foram apagados no fim.

Como cada conector foi exercitado:

- **n8n:** a lógica do node (`dist/nodes/Perpetuus/shared`: montagem de URL, query Strapi, retry e mapeamento de erro) com um `Sender` HTTP real no lugar do `httpRequestWithAuthentication` do n8n. A casca do n8n (`Perpetuus.node.ts`, leitura de parâmetros) não rodou; isso fica para o vídeo de revisão.
- **Zapier:** `zapier-platform-core` `createAppTester` local com a chave real (sem push).
- **Make:** as requisições dos arquivos `.communication.iml.json` reproduzidas uma a uma (mesma URL, query e corpo). O IML em si só roda dentro do Make.

| Operação | n8n | Zapier | Make |
|---|---|---|---|
| Teste de conexão (`/auth/token-info`) | ok | ok (rótulo "Perpetuus Demo (demo@perpetuus.com.br)") | ok |
| Upsert de contato: cria (201) e atualiza pelo e-mail (200, mesmo id) | ok | ok | ok |
| Buscar contato por e-mail, telefone e texto | ok | ok | ok |
| Criar card (contato, tag, fase, valor, campos obrigatórios da fase de formulário) | ok | ok (inputs `fields__<slug>`) | ok |
| Buscar card por título, fase e contato | ok | ok | ok |
| Mover card de fase (com motivo) | ok | ok | ok |
| Adicionar tags (mescla com as existentes) | ok | ok | ok |
| Criar tarefa (no card e só no board) | ok | ok | ok |
| Gatilho New Card | ok | ok | ok |
| Gatilho Card Entered Phase | ok | ok | ok |
| Gatilho New Contact | ok | ok | ok |
| Gatilho Task Completed | ok | ok | ok |
| Make an API Call | não existe | não existe | ok |
| Listas de boards, membros, contatos e cards | ok | ok | ok |
| Listas de fases, tags e campos do card (`/boards/{id}/structure`) | **falha 500** | **falha 500** | **falha 500** |
| Erros 400, 401 e 404 com a mensagem do contrato | ok | ok | não testado (só roda no Make) |

No n8n, os gatilhos foram testados em três ciclos: o primeiro só grava o cursor, o segundo emite o item novo e o terceiro não emite nada (deduplicação).

Não testado: 403 por falta de escopo (a chave tem `crm:write`), 429 e webhooks (os gatilhos são por polling; a API não tem webhooks).

Achados:

1. **Backend: `GET /boards/{id}/structure` devolve 500** ("Falha ao montar a estrutura do board") em qualquer board e com qualquer `include`, inclusive num board vazio. Acontece na REST e no MCP (`crm_get_board_structure`). Isso quebra os dropdowns de fase e tag e os campos dinâmicos do card nos três conectores. Sem esses campos, no Zapier o usuário não vê os campos obrigatórios da fase de formulário (dá para contornar mapeando o dicionário `fields`). Código em `perpetuus-back/src/services/board/board-structure.ts`; a causa está no log `[board.structure]` do servidor.
2. **Template padrão cria a automação "Criar contato"** quando o board nasce. Ela cria ou reaproveita um contato a partir de `fields.email`/`fields.whatsapp` do card e troca o contato vinculado. Se o card for criado com `contactId` de um contato e `fields.email` de outro, o card acaba ligado ao segundo. Além disso, todo contato criado é sincronizado com o Chatwoot da org.
3. **Make: filtro vazio zera a busca.** `filters[currentPhase][documentId][$eq]=` vazio devolve 0 cards. Se o Make mandar string vazia quando o campo opcional chega vazio de um módulo anterior, Search Cards não encontra nada. Proposta: `{{ifempty(parameters.phaseId, undefined)}}` nos filtros opcionais de `search-cards` (e `watch-*`).
4. Sem chave nenhuma a API responde 403, não 401; com chave inválida responde 401 (mapeado certo nos três).

## Limitações conhecidas (valem para os três)

Detalhadas, com o contorno usado e a proposta para a API, em [v1-contract.md §9](v1-contract.md). As principais:

- **Sem webhooks:** os gatilhos são por polling, com atraso de alguns minutos.
- **Sem histórico de mudança de fase:** se o card passar por duas fases entre duas verificações, só a fase atual dispara.
- **Tarefa reaberta** e concluída de novo não dispara (`completedAt` só é gravado na primeira conclusão).
- **`GET /tasks`** devolve array puro e pagina com `limit`/`offset`, fora do padrão das outras rotas.
- **Busca por telefone** sem normalização de formato.
- **Adicionar tags** lê, mescla e grava; há risco de corrida se outra pessoa mexer nas tags ao mesmo tempo.
- **Criar card numa fase específica** exige duas chamadas (criar e mover).
- **Sem chave de idempotência** nas rotas de escrita; os conectores não repetem POST/PUT para não duplicar.
- **As respostas não trazem a URL** do card ou do contato no app.

## Próximos passos

1. **Testar n8n, Zapier e Make contra a API real** com uma chave de teste (`crm:read` e `crm:write`) de uma organização de demonstração.
2. **Make:** testar contra a API real, rodar os cenários de `make/docs/test-scenarios.md` e pedir a revisão (o app privado `perpetuus-crm-ej2gdv` já foi criado e enviado em 17/11/2026; ainda falta o logo 512×512).
3. **Webhooks de saída na API:** inscrição por API, entrega assinada (HMAC), retry e log. Torna os gatilhos instantâneos no Zapier, Make e n8n e é obrigatório para a Pluga.
4. **OAuth 2.1 na API:** login "Conectar" sem colar chave no Zapier e no Make, e pré-requisito para Pipedream, ChatGPT e o diretório do Claude.
5. **Pipedream** (pedido ao programa App Partners, depende do OAuth), **Activepieces** (piece enviado como PR ao repositório deles) e **Pluga** (depende dos webhooks).

## Pendências que dependem do time

- ~~Criar as contas: npm, Zapier, Make e n8n Creator Portal~~ (feito em 17/11/2026, com `luis.santos@perpetuus.com.br`).
- ~~Confirmar o e-mail de autor~~ (n8n usa `luis.santos@perpetuus.com.br` desde a 0.1.2).
- Gravar o vídeo da revisão manual do n8n.
- Logo PNG 256×256 para o Zapier e 512×512 para o Make e as demais listagens.
- Organização de demonstração com dados fictícios e usuário de revisão sem autenticação em dois fatores.
- Chave de teste para validar os conectores contra a API real.
