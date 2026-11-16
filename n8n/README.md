# n8n-nodes-perpetuus

Official [n8n](https://n8n.io) community nodes for [Perpetuus CRM](https://perpetuus.com.br).

- **Perpetuus**: create or update contacts, create cards, move cards between phases, add tags,
  create tasks, and search contacts and cards.
- **Perpetuus Trigger**: start workflows when a card is created, a card enters a phase, a
  contact is created or a task is completed.

The operations, field names and outputs follow the shared
[v1 contract](../docs/v1-contract.md), so they match the Zapier and Make apps.

## Contents

- [Installation](#installation)
- [Credentials](#credentials)
- [Operations](#operations)
- [Trigger](#trigger)
- [Output](#output)
- [Limits and errors](#limits-and-errors)
- [Templates](#templates)
- [Development](#development)

## Installation

Follow the [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/):

1. In n8n, open **Settings → Community Nodes**.
2. Select **Install**, enter `n8n-nodes-perpetuus` and confirm.

For self-hosted n8n with npm: `npm install n8n-nodes-perpetuus` in your n8n custom folder
(`~/.n8n/custom`), then restart n8n.

## Credentials

The nodes use a Perpetuus **API key** (it starts with `ppt_`).

1. In Perpetuus, open **Settings → API Tokens e MCP**.
2. In the **Conectar sua IA (MCP)** card, select **Conectar editor**, then
   **Conectar novo editor**.
3. Name the key (for example `n8n`), choose how many days it is valid (1 to 365) and select
   the **crm:write** scope (it includes `crm:read`). The trigger alone only needs `crm:read`.
4. Select **Gerar configuração** and copy the `ppt_…` key from the `Authorization` field. It
   is shown only once.
5. In n8n, create a **Perpetuus API** credential and paste the key. Keep the base URL
   `https://api.perpetuus.com.br/api` unless Perpetuus support tells you otherwise.

The credential test calls `GET /auth/token-info`. The key already belongs to one
organization, so there is no organization field. When the key expires or is revoked, every
call fails with "Invalid or expired Perpetuus API key"; create a new key and update the
credential. More details: [Perpetuus API authentication](https://docs.perpetuus.com.br/docs/api/autenticacao).

## Operations

| Resource | Operation | What it does | Scope |
|----------|-----------|--------------|-------|
| Contact | Create or Update | Finds the contact by email and/or phone (any Brazilian format) and updates it, or creates it. Returns `created` and `matchedBy`. | `crm:write` |
| Contact | Search | Finds contacts by exact email, by phone digits or by text (name, email, phone, CPF, CNPJ). | `crm:read` |
| Card | Create | Creates a card in a board with title, custom fields, contact, tags, value, due date, assignees and an optional starting phase. | `crm:write` |
| Card | Move to Phase | Moves a card to another phase of its board, with an optional reason. | `crm:write` |
| Card | Add Tags | Adds board tags to a card and keeps the tags it already has. | `crm:write` |
| Card | Search | Finds cards of a board by title, phase or contact. | `crm:read` |
| Task | Create | Creates a task in a board, optionally attached to a card. | `crm:write` |

Notes:

- **Board, card and contact** fields accept a value from the list, an ID (Perpetuus
  `documentId`) or, for boards, the board URL (`https://app.perpetuus.com.br/boards/…`).
- **Custom fields** of a card are loaded from the selected board. Required fields of the
  board form phase must be filled, or Perpetuus rejects the card and lists the missing fields.
  Select fields show their options; multi-value fields take a JSON array or a comma-separated
  list.
- **Starting phase**: Perpetuus always creates cards in the first workflow phase. When you
  choose another phase, the node moves the card right after creating it. If that move fails,
  the card is kept and the output has a `warning`.
- **Phone search** matches the digits saved on the contact. `+55 (11) 99999-9999` finds a
  contact saved as `+5511999999999`, but a number without the ninth digit does not. To find
  or create by phone reliably, use **Create or Update**.

## Trigger

| Event | Parameters | Fires when | Deduplicated by |
|-------|------------|------------|-----------------|
| New Card | Board | A card is created in the board | card ID |
| Card Entered Phase | Board, Phase (optional) | A card enters a phase, including the initial phase of a new card | card ID + phase ID + entry time |
| New Contact | none | A contact is created | contact ID |
| Task Completed | Board (optional) | A task is completed | task ID + completion time |

How polling works:

- Perpetuus has no webhooks yet, so the trigger checks for changes on every poll (set the
  interval in **Poll Times**).
- The **first poll only marks the starting point**: records that already exist are never
  replayed. Changing the board, phase or event starts over.
- Each poll reads up to 500 new records, oldest first. A larger backlog is processed on the
  next polls.
- **Test step** (manual run) returns the most recent record as a sample without changing the
  starting point.

Known limits of polling:

- If a card moves through two phases between polls, only the phase it is in now fires.
- A task fires only the first time it is completed (Perpetuus keeps the first completion time).
- With an operator key, Perpetuus only returns the contacts and tasks that user can see.

## Output

Every operation returns flat objects with the same keys every time (missing values are `null`):

- **Contact**: `id`, `name`, `email`, `phone`, `contactType` (`person`/`company`), `cpf`,
  `cnpj`, `address`, `city`, `state`, `country`, `postalCode`, `customFields`, `createdAt`,
  `updatedAt`. Create or Update adds `created`, `matchedBy` and `otherMatchIds`.
- **Card**: `id`, `title`, `boardId`, `phaseId`, `phaseName`, `phaseEnteredAt`, `contactId`,
  `contactName`, `contactEmail`, `contactPhone`, `value`, `dueDate`, `description`, `tagIds`,
  `tagNames`, `fields` (custom field values by slug), `createdAt`, `updatedAt`.
- **Task**: `id`, `name`, `description`, `type`, `priority`, `status`, `dueDate`,
  `completedAt`, `cardId`, `cardTitle`, `assigneeIds`, `createdAt`, `updatedAt`.

Trigger items also have `eventId` (deduplication key) and `eventAt` (event time).

## Limits and errors

- Perpetuus allows **120 requests per minute per API key** and 600 per organization. When the
  limit is hit, the node waits for the `Retry-After` time (up to 60 seconds, twice) and tries
  again. After that it fails with "Perpetuus rate limit reached".
- Reads that fail with a server error are retried once. Writes are not retried, so a card or
  task is never created twice.
- Error messages:
  - **401**: the API key is invalid, expired or revoked.
  - **403**: the key is missing a scope (the message names it, for example `crm:write`) or the
    user's role cannot do this.
  - **400**: Perpetuus rejected the data (for example a missing required field); the details
    list what to fix.
  - **402**: the plan contact limit was reached.
  - **429**: rate limit; wait and try again.

## Templates

Import these from [`templates/`](templates/) (**Workflows → Import from File**):

- `form-to-contact-and-card.json`: n8n form → create or update contact → create card.
- `won-card-onboarding-task.json`: card entered the won phase → onboarding task on the card.
- `new-contact-to-google-sheets.json`: new contact → Google Sheets row.

They have no credentials; choose yours after importing.

## Development

```bash
npm install
npm run lint     # n8n community node rules
npm test         # unit tests (vitest, HTTP mocked)
npm run build
npm run dev      # local n8n with the nodes loaded (needs Docker or Podman)
```

Code layout:

- `credentials/PerpetuusApi.credentials.ts`: API key + base URL, Bearer auth, connection test.
- `nodes/Perpetuus/shared/`: n8n-independent code: HTTP retry and errors (`transport.ts`),
  Strapi query strings (`query.ts`), output mapping (`mappers.ts`), operations
  (`operations.ts`) and polling (`polling.ts`).
- `nodes/Perpetuus/GenericFunctions.ts`: the only place that calls n8n's HTTP helper.
- `nodes/Perpetuus/Perpetuus.node.ts` and `nodes/PerpetuusTrigger/PerpetuusTrigger.node.ts`.

### Releasing

Releases are published by GitHub Actions with npm provenance (required by n8n for verified
nodes). Bump `version` in `package.json`, update `CHANGELOG.md`, commit, then push a tag
`n8n-v<version>` (for example `n8n-v0.1.0`). The `Publish n8n node` workflow checks that the
tag matches the version, runs lint and tests, builds and publishes.

## License

[MIT](../LICENSE)
