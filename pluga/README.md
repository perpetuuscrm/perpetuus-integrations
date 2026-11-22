# Perpetuus CRM on Pluga

HTTP adapter that implements the [Pluga Developers contract](https://developers.pluga.co/api-docs/pluga-developers.yml)
(OpenAPI 3.1) on top of the Perpetuus REST API v1 and outgoing webhooks v1. Pluga does not host
partner code: it calls this service with the user's Perpetuus API key (`Authorization: Bearer ppt_…`),
and the adapter forwards the key to `https://api.perpetuus.com.br/api`. Operations, field names
and outputs follow the shared contract in [`docs/v1-contract.md`](../docs/v1-contract.md), the same
as the n8n, Zapier and Make connectors (Board / Phase / Card vocabulary).

## Routes

| Route | What it does |
|-------|--------------|
| `GET /manifest.json` | App name, description (pt_BR/en), color, signup URL, key tutorial |
| `GET /ping` | Validates the key (`GET /auth/token-info`): `{ name, email, scopes }`, 401 when invalid |
| `GET /helpers/{id}` | Dropdowns: `boards_list`, `phases_list`, `tags_list`, `members_list`, `cards_list` (board-dependent ones read `?boardId=`) |
| `GET /actions/{id}/manifest.json · /fields · /attributes`, `POST /actions/{id}` | Actions below. `POST` answers 201 with the flat result |
| `GET /triggers/{id}/manifest.json · /attributes · /sample` | Triggers below (`rest_hook`). The sample uses the newest real record, else the API sample |
| `POST /triggers/{id}/subscribe`, `DELETE /triggers/{id}/unsubscribe/{webhook_id}` | Creates / removes the Perpetuus webhook subscription; `webhook_id` = Perpetuus subscription id |
| `POST /relay/{token}` | Receives Perpetuus webhooks and forwards them to Pluga (internal, not part of Pluga's contract) |
| `GET /health` | Liveness |

### Actions

| id | Perpetuus | Configuration | Fields |
|----|-----------|---------------|--------|
| `create_card` | Create Card (§6.2), optional contact find-or-create by email/phone | `boardId`, `phaseId` (optional) | `title`*, `contactEmail`, `contactPhone`, `contactName`, `contactId`, `value`, `dueDate`, `description`, `tagIds`, `assigneeIds`, plus the Board's custom fields as `fields.<slug>` when Pluga passes `?boardId=` |
| `move_card` | Move Card to Phase (§6.3) | `boardId`, `phaseId` | `cardId`*, `reason` |
| `add_card_tags` | Add Tags to Card (§6.4) | `boardId`, `tagIds` | `cardId`* |
| `upsert_contact` | Create or Update Contact (§6.1) | — | `name`, `email`, `phone`, `contactType`, `cpf`, `cnpj`, address fields |
| `create_task` | Create Task (§6.5) | `boardId` (optional) | `name`*, `cardId`, `description`, `dueDate`, `type`, `priority` |

### Triggers (`rest_hook`)

| id | Perpetuus events | Configuration |
|----|------------------|---------------|
| `card_created` | `card.created` | `boardId`* |
| `card_entered_phase` | `card.created` + `card.phase_changed` (a Card created in a Phase counts as entering it) | `boardId`*, `phaseId` |
| `contact_created` | `contact.created` | — |
| `message_received` | `message.received` (key needs `chat:read`) | `boardId` |

Outputs are the v1 canonical objects, flattened for Pluga: lists become comma-separated text
(`tagNames: "Quente, Site"`), custom fields stay under `fields.<slug>`. `eventId` is the unique key.

## Webhook relay

Perpetuus signs each delivery with a per-subscription secret and sends the v1 envelope
`{ id, type, timestamp, data }`. Pluga expects the flat object. On subscribe, the adapter registers
`${PUBLIC_BASE_URL}/relay/<token>` in Perpetuus, where `<token>` is AES-256-GCM-encrypted
`{ Pluga URL, trigger, Board, Phase, signing secret }` (`RELAY_KEY`). On delivery it checks the
HMAC signature, filters by event, Board and Phase, maps and POSTs to Pluga. There is no database;
only this service can read or create tokens. Status codes back to Perpetuus follow its retry
policy (2xx done, 410 removes the subscription, 5xx retried, other 4xx dropped).

The relay only delivers to hosts in `ALLOWED_TARGET_HOSTS` (default `pluga.co`) that resolve to
public addresses, over https, without following redirects.

## Configuration

| Variable | Default | |
|----------|---------|-|
| `PUBLIC_BASE_URL` | `http://localhost:3000` | Public https URL of this service (`base_url` for Pluga) |
| `RELAY_KEY` | — (required for triggers) | 32 random bytes, base64 (`openssl rand -base64 32`). Rotating it breaks active triggers |
| `ALLOWED_TARGET_HOSTS` | `pluga.co` | Host suffixes the relay may POST to |
| `PERPETUUS_API_BASE_URL` | `https://api.perpetuus.com.br/api` | |
| `PORT` | `3000` | |

No runtime dependencies (Node ≥ 20). Deploy: `Dockerfile` + `captain-definition` (CapRover).
Logs show method, path (relay tokens masked), status and time; never keys or bodies.

## Tests

```bash
npm install          # dev dependencies only: ajv, ajv-formats, yaml
npm test             # offline: every route against test/spec/pluga-developers.yml + relay unit tests
PERPETUUS_TEST_KEY_FILE=… PERPETUUS_TEST_BOARD_ID=… npm run test:live   # real API, demo org only
```

The live test refuses to run outside the `perpetuus-demo` organization, creates records named
`[pluga-test] …` and deletes them at the end (including Cards copied by other automations).

## Registering with Pluga

`submission/pluga-integration.json` is the registration JSON Pluga asks for (to
integrations@pluga.co). It assumes the service is deployed at `https://pluga.services.perpetuus.com.br`.
