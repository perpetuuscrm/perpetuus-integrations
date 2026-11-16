# Status dos conectores

**Atualizado em:** 16/11/2026 · **Contrato:** [v1-contract.md](v1-contract.md)

Este documento resume o que já foi feito nos conectores do n8n e do Zapier, o que falta para publicar cada um e os próximos passos. O detalhe técnico de cada operação (rotas, campos, saída, deduplicação, erros) está no contrato.

## Resumo

| Conector | Pasta | Versão | Código | Testes | Publicado |
|---|---|---|---|---|---|
| n8n (`n8n-nodes-perpetuus`) | [`n8n/`](../n8n/) | 0.1.0 | pronto | 53 testes, lint e build ok | não (falta conta npm) |
| Zapier (Perpetuus CRM) | [`zapier/`](../zapier/) | 1.0.0 | pronto | 55 testes, `validate` ok | não (falta conta de desenvolvedor) |
| Make | `make/` | — | não iniciado | — | — |

Nenhum dos dois foi testado ainda contra a API real; todos os testes usam HTTP simulado.

## O que a API do Perpetuus já oferece aos conectores

Entregue e em produção:

- **Chave de API (`ppt_…`)** como credencial oficial, com escopos (`crm:read`, `crm:write`, `chat:read`, `chat:write`, `ai:control`, `campaign:read`), validade de 1 a 365 dias e revogação. A organização vem da própria chave; o header `x-tenant-id` é opcional. Guia: [autenticação](https://docs.perpetuus.com.br/docs/api/autenticacao).
- **Teste de conexão:** `GET /api/auth/token-info` devolve a credencial, o usuário e a organização, sem nunca devolver a chave.
- **Limite de requisições:** 120 por minuto por chave e 600 por organização, com headers `X-RateLimit-*` e resposta 429 com `Retry-After`.
- **Criar ou atualizar contato:** `POST /api/contacts/upsert`, casando por e-mail e depois telefone, dentro da organização.
- **Estrutura do board numa chamada:** `GET /api/boards/:id/structure?include=phases,fields,tags,conditions`, usada nas listas de fases, tags e campos custom.
- **Chave só de leitura** alcança todas as leituras, inclusive as que usam POST.

## Escopo v1 (igual nos dois conectores)

- **Gatilhos (por polling):** New Card, Card Entered Phase, New Contact, Task Completed.
- **Ações:** Create or Update Contact, Create Card (com campos custom do board), Move Card to Phase, Add Tags to Card, Create Task.
- **Buscas:** Find Contact, Find Card. No Zapier, também Find or Create Contact.
- **Listas dinâmicas:** boards, fases, tags, membros (e contatos e cards no Zapier).
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

### Falta para publicar

1. **Testar contra a API real** com uma chave de uma organização de teste, inclusive `npm run dev` (precisa de Docker ou Podman). Pontos a conferir: filtros dos gatilhos em `currentPhaseEnteredAt` e `completedAt`, e o formato de `/boards/:id/structure` e da lista de membros.
2. **Conta no npm:** criar a organização dona do pacote, confirmar que o nome `n8n-nodes-perpetuus` está livre e configurar no GitHub o secret `NPM_TOKEN` (ou Trusted Publishing do npm).
3. **Confirmar o e-mail de autor** do `package.json` (hoje `contato@perpetuus.com.br`); precisa bater com o da conta npm.
4. **Primeira publicação:** criar a tag `n8n-v0.1.0` e deixar o workflow publicar.
5. **Scanner do n8n:** `npx @n8n/scan-community-package n8n-nodes-perpetuus` (só roda com o pacote já publicado).
6. **Verificação:** enviar o pacote no Creator Portal do n8n, com README e templates.

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

1. **Conta de desenvolvedor no Zapier**, com pelo menos um admin de e-mail do domínio `@perpetuus.com.br`.
2. **Cadastrar e enviar o app:** `npx zapier-platform login`, `register "Perpetuus CRM"` (gera o `.zapierapprc`, que deve ser commitado) e `push`.
3. **Listagem no painel do Zapier:** categoria, descrição começando com "Perpetuus CRM is a…", homepage e logo PNG quadrado de 256×256 (ainda não existe).
4. **Testar cada operação num Zap ligado** com pelo menos uma execução bem-sucedida (contra a API real).
5. **Conta de teste** `integration-testing@zapier.com` na organização de demonstração, sem expiração e com todos os recursos.
6. **Beta:** convidar clientes e chegar a 3 usuários com Zaps ativos (checks S001 e S002); então pedir a publicação e responder o D026.

## Limitações conhecidas (valem para os dois)

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

1. **Testar n8n e Zapier contra a API real** com uma chave de teste (`crm:read` e `crm:write`) de uma organização de demonstração.
2. **Make:** custom app seguindo o mesmo contrato (módulos, RPCs para listas, módulo universal, paginação, cenário de teste cobrindo todos os módulos).
3. **Webhooks de saída na API:** inscrição por API, entrega assinada (HMAC), retry e log. Torna os gatilhos instantâneos no Zapier, Make e n8n e é obrigatório para a Pluga.
4. **OAuth 2.1 na API:** login "Conectar" sem colar chave no Zapier e no Make, e pré-requisito para Pipedream, ChatGPT e o diretório do Claude.
5. **Pipedream** (pedido ao programa App Partners, depende do OAuth), **Activepieces** (piece enviado como PR ao repositório deles) e **Pluga** (depende dos webhooks).

## Pendências que dependem do time

- Criar as contas: npm (organização), Zapier (desenvolvedor) e, depois, Make e n8n Creator Portal.
- Confirmar o e-mail de autor e contato dos pacotes.
- Logo PNG 256×256 para o Zapier e as demais listagens.
- Organização de demonstração com dados fictícios e usuário de revisão sem autenticação em dois fatores.
- Chave de teste para validar os conectores contra a API real.
