# Perpetuus CRM for Zapier

Official [Zapier](https://zapier.com) integration for [Perpetuus CRM](https://perpetuus.com.br),
built with the [Zapier Platform CLI](https://docs.zapier.com/platform/build-cli/overview)
(`zapier-platform-core` 19.3.0, Node.js 22, CommonJS).

The operations, field keys and outputs follow the shared
[v1 contract](../docs/v1-contract.md), so they match the n8n and Make connectors.

## Contents

- [Operations](#operations)
- [Authentication](#authentication)
- [How the triggers deduplicate](#how-the-triggers-deduplicate)
- [Limits and errors](#limits-and-errors)
- [Development](#development)
- [Publishing](#publishing)

## Operations

| Type | Key | Label | REST calls | Scope |
|------|-----|-------|------------|-------|
| Trigger | `newCard` | New Card | `GET /boards/{boardId}/cards` | `crm:read` |
| Trigger | `cardEnteredPhase` | Card Entered Phase | `GET /boards/{boardId}/cards` | `crm:read` |
| Trigger | `newContact` | New Contact | `GET /contacts` | `crm:read` |
| Trigger | `taskCompleted` | Task Completed | `GET /tasks` | `crm:read` |
| Create | `upsertContact` | Create or Update Contact | `POST /contacts/upsert` | `crm:write` |
| Create | `createCard` | Create Card | `POST /boards/{boardId}/cards` (+ `PUT` to move, + `GET`) | `crm:write` |
| Create | `moveCard` | Move Card to Phase | `PUT /boards/{boardId}/cards/{cardId}` + `GET` | `crm:write` |
| Create | `addCardTags` | Add Tags to Card | `GET` + `PUT` + `GET` on the card (merges tags) | `crm:write` |
| Create | `createTask` | Create Task | `POST /tasks` | `crm:write` |
| Search | `findContact` | Find Contact | `GET /contacts` | `crm:read` |
| Search | `findCard` | Find Card | `GET /boards/{boardId}/cards` | `crm:read` |
| Search or create | `findContact` | Find or Create Contact | Find Contact, then Create or Update Contact | both |

Hidden triggers feed the dynamic dropdowns: `boardList`, `phaseList`, `tagList`, `memberList`,
`contactList` and `cardList`. Create Card loads the custom fields of the selected board as
dynamic inputs (`fields__<slug>`, required only for fields of the form phase) and also takes an
**Other Custom Fields** dictionary (`fields`) for boards mapped from a previous step.

Every result uses the flat canonical objects of the contract (Contact, Card, Task). Card custom
fields come in `fields` and contact custom fields in `customFields`; Zapier shows them as
`fields__<slug>` and `customFields__<key>`.

## Authentication

Custom auth with two fields:

- **API Key** (`apiKey`, password): a Perpetuus key starting with `ppt_`. Create it in
  **Settings → API Tokens e MCP → Conectar sua IA (MCP) → Conectar editor → Conectar novo
  editor** with the `crm:write` scope (it includes `crm:read`).
- **API Base URL** (`baseUrl`, optional): defaults to `https://api.perpetuus.com.br/api`.
  Only HTTPS addresses are accepted (validated in `lib/middleware.js`).

The connection test calls `GET /auth/token-info` and the connection label is
`<organization name> (<user email>)`. A `beforeRequest` middleware adds the base URL and
`Authorization: Bearer <key>`; an `afterResponse` middleware turns 401, 403 and 429 into the
canonical messages.

## How the triggers deduplicate

Zapier keeps no cursor for the integration and deduplicates by the `id` of each result, so
every poll reads the newest 100 items (`sort=<field>:desc`) and returns them newest first.
`id` is the contract `eventId`, and the entity id goes in `cardId`, `contactId` or `taskId`.

| Trigger | Sorted by | `id` (`eventId`) | Notes |
|---------|-----------|------------------|-------|
| New Card | `createdAt` | `{cardId}` | |
| Card Entered Phase | `currentPhaseEnteredAt` (`$notNull`) | `{cardId}:{phaseId}:{currentPhaseEnteredAt}` | A re-entry gets a new id and triggers again. New cards count as entering the first phase. Phases skipped between two polls are not seen. |
| New Contact | `createdAt` | `{contactId}` | Only contacts visible to the key owner. |
| Task Completed | `completedAt` (`$notNull`) | `{taskId}:{completedAt}` | Fires on the first completion only (the API keeps the first `completedAt`). |

When more than 100 events happen between two polls, the oldest ones are not seen. See the
[API gaps](../docs/v1-contract.md#9-lacunas-da-api) for the planned REST hooks.

## Limits and errors

- The API allows 120 requests/min per key and 600/min per organization.
- A 429 with `Retry-After` up to 10 seconds is retried inline (at most twice). Longer waits
  raise `ThrottledError` with the `Retry-After` delay and Zapier retries the step later.
- `GET` requests are retried once on 5xx or network errors. `POST`/`PUT` are never retried
  (the REST API has no idempotency key yet).
- Error messages are the canonical English texts of the contract (§3.3).

## Development

Requirements: Node.js 22 (the Zapier runtime) and npm.

```bash
cd zapier
npm ci
npm test            # Jest + nock, no network
npm run validate    # zapier-platform validate: schema + integration checks
```

`npm run validate` works without logging in. The only remaining warning is D026 (manual
validation of the base URL field), which needs a human answer during review: the field only
accepts HTTPS URLs and defaults to production.

Layout:

```text
index.js            App definition (flags, middlewares, operations, search-or-create)
authentication.js   API key auth, test and connection label
lib/                HTTP client, errors, mappers, operations, polling, samples
triggers/           Polling triggers and hidden dropdown triggers
creates/            Actions
searches/           Searches
test/               Jest tests with nock
```

## Publishing

Not done yet: the Zapier developer account does not exist. Steps once it does:

1. `npx zapier-platform login` with the Perpetuus developer account (use an
   `@perpetuus.com.br` email; at least one admin must have an email on the app domain).
2. `npx zapier-platform register "Perpetuus CRM"` (creates `.zapierapprc`; commit it).
   Fill in the listing on the developer platform: category, a 1 to 3 sentence description
   starting with "Perpetuus CRM is a…", homepage `https://perpetuus.com.br` and a square
   256×256 PNG logo.
3. `npx zapier-platform push` to upload version 1.0.0 (it runs the build and the checks).
4. Invite beta testers from the developer platform (**Manage → Sharing**) and test every
   trigger, action and search in a live Zap with at least one successful run. Keep those Zaps
   and runs; Zapier may ask for them.
5. Create a non-expiring Perpetuus test account for `integration-testing@zapier.com` with all
   features enabled (no trial limits), and give Zapier the credentials and setup notes.
6. Reach **at least 3 users with live Zaps** using the integration (check S001/S002), then
   submit for publishing from the developer platform. Zapier reviews it, including the D026
   warning above.
7. For new versions: bump `version` in `package.json`, `npx zapier-platform push`, then
   `npx zapier-platform promote <version>` and `npx zapier-platform migrate` for existing users.
