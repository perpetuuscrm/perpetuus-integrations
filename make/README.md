# Perpetuus CRM for Make

Official [Make](https://www.make.com) custom app for [Perpetuus CRM](https://perpetuus.com.br),
kept as source files in the **local development** layout of the Make Apps Editor extension for
VS Code (`makecomapp.json` plus one file per component code).

The operations, field names and outputs follow the shared [v1 contract](../docs/v1-contract.md),
so they match the n8n and Zapier connectors. Make-specific choices are listed in the contract
(§3.2, §5.6, §6.2 and §7 platform notes).

## Contents

- [Structure](#structure)
- [Modules](#modules)
- [Connection](#connection)
- [How the triggers deduplicate](#how-the-triggers-deduplicate)
- [Limits and errors](#limits-and-errors)
- [Validate locally](#validate-locally)
- [Deploy to Make](#deploy-to-make)
- [Test](#test)
- [Review checklist](#review-checklist)
- [Technology Partner](#technology-partner)

## Structure

```text
make/
├── app/                                  ← the custom app (what is deployed to Make)
│   ├── makecomapp.json                   ← component list, metadata, code file paths, origins
│   ├── README.md                         ← app documentation shown in Make
│   ├── general/base.iml.json             ← Base: base URL, Bearer header, errors, sanitization
│   ├── connections/perpetuus/            ← API key connection (communication + params)
│   ├── rpcs/<rpc>/                       ← dropdowns and dynamic fields (communication + params)
│   └── modules/
│       ├── groups.json                   ← module groups (Cards, Contacts, Tasks, Other)
│       └── <module>/                     ← communication, epoch (triggers), static-params,
│                                           mappable-params, interface, samples
├── docs/test-scenarios.md                ← scenarios required by the Make app review
├── schemas/                              ← Make's official editor JSON schemas (MIT, Celonis)
├── scripts/validate.mjs                  ← local validation (no Make account needed)
└── package.json                          ← only Ajv, for the schema check
```

File names follow the extension: `<component-id-in-kebab-case>.<code>.iml.json`
(`communication`, `epoch`, `static-params`, `mappable-params`, `interface`, `samples`, `params`).
The extension also accepts `.iml.jsonc`; this app uses `.iml.json` so every tool reads it as plain
JSON. Common data is excluded (`null` in `makecomapp.json`): the app has no secrets of its own.

There are no custom IML functions. Everything uses built-in IML (`ifempty`, `map`, `switch`,
`toCollection`, `formatDate`…), because deploying IML functions from the extension can be
blocked for external developers and needs a separate request to Make.

## Modules

| Group | Module (ID) | Label | Type | Contract | REST calls |
|-------|-------------|-------|------|----------|------------|
| Cards | `watchNewCards` | Watch new cards | Trigger (polling) | `newCard` | `GET /boards/{boardId}/cards` |
| Cards | `watchCardsEnteredPhase` | Watch cards entering a phase | Trigger (polling) | `cardEnteredPhase` | `GET /boards/{boardId}/cards` |
| Contacts | `watchNewContacts` | Watch new contacts | Trigger (polling) | `newContact` | `GET /contacts` |
| Tasks | `watchCompletedTasks` | Watch completed tasks | Trigger (polling) | `taskCompleted` | `GET /tasks` |
| Contacts | `upsertContact` | Create or update a contact | Action (create) | `upsertContact` | `POST /contacts/upsert` |
| Cards | `createCard` | Create a card | Action (create) | `createCard` | `POST /boards/{boardId}/cards` (+ `PUT` to move, + `GET`) |
| Cards | `moveCard` | Move a card to a phase | Action (update) | `moveCard` | `PUT /boards/{boardId}/cards/{cardId}` + `GET` |
| Cards | `addCardTags` | Add tags to a card | Action (update) | `addCardTags` | `GET` + `PUT` (merged tags) + `GET` |
| Tasks | `createTask` | Create a task | Action (create) | `createTask` | `POST /tasks` |
| Contacts | `searchContacts` | Search contacts | Search | `findContact` | `GET /contacts` |
| Cards | `searchCards` | Search cards | Search | `findCard` | `GET /boards/{boardId}/cards` |
| Other | `makeApiCall` | Make an API call | Universal | — | any route under the base URL |

RPCs: `listBoards`, `listPhases`, `listTags`, `listMembers`, `listCards`, `listContacts`
(option lists, up to 300 items with pagination) and `listCardFields` (dynamic fields).

Input and output names are the contract's (`boardId`, `phaseId`, `tagIds`, `contactType`,
`phaseEnteredAt`, `customFields`…). Outputs are flat and typed in the interface (dates as `date`,
`value` as number, ID lists as arrays of text); `fields` and `customFields` are collections.
Triggers add `eventId` and `eventAt`.

**Create a card** loads the custom fields of the chosen board below the board field (from
`GET /boards/{boardId}/structure?include=phases,fields`). Fields required by the form phase are
required; selects, numbers, dates, switches and lists get the matching Make type. When the board is
mapped from a previous module, the fields cannot load: use **Other custom fields** (`fields`, slug
and value pairs). A custom field whose slug equals one of the module's own inputs (`title`, `value`,
`description`…) is only reachable through **Other custom fields**.

## Connection

- **API key** (`apiKey`, password, required): a Perpetuus key `ppt_…` with `crm:write` (it includes
  `crm:read`). In Perpetuus: **Settings → API Tokens e MCP → Conectar sua IA (MCP) → Conectar
  editor → Conectar novo editor**.
- **API base URL** (`baseUrl`, advanced, optional): defaults to `https://api.perpetuus.com.br/api`;
  must be `https://` and must not end with `/`.
- Validation: `GET /auth/token-info`. The connection is labelled `Organization (email)`.
- The key goes in `Authorization: Bearer …` from the Base and the connection, and
  `request.headers.authorization` is sanitized in both, so it never appears in Make logs.

## How the triggers deduplicate

The triggers are Make polling triggers of type `date`, asking newest first (`order: desc`, as Make
recommends) and filtering from the date Make kept from the previous run (`data.lastDate`) with
Strapi's `$gte`. Make keeps the last date and ID and drops what it already returned:

| Module | `trigger.id` (= `eventId`) | `trigger.date` (= `eventAt`) |
|--------|-----------------------------|------------------------------|
| Watch new cards | `cardId` | `createdAt` |
| Watch cards entering a phase | `cardId:phaseId:currentPhaseEnteredAt` | `currentPhaseEnteredAt` |
| Watch new contacts | `contactId` | `createdAt` |
| Watch completed tasks | `taskId:completedAt` | `completedAt` |

Because the phase timestamp is part of the ID, a card that comes back to the same phase triggers
again. **Choose where to start** (epoch) offers *From now on*, *Since specific date*, *All* and a
list of the last 300 items. The `limit` (required, default 10) caps the bundles per run; Make keeps
the rest for the next run. Same limitations as the other connectors: no webhooks yet, only the
current phase is seen if a card crosses several phases between runs, and a reopened task does not
trigger again.

## Limits and errors

The API allows 120 requests/min per key and 600/min per organization. Errors use the contract
messages, prefixed with the HTTP status as Make recommends:

| HTTP | Make error type | Message |
|------|-----------------|---------|
| 400 | `DataError` (can be stored as an incomplete execution) | `Perpetuus rejected the request: …` + details |
| 401 | `InvalidAccessTokenError` (scenario stops, user notified) | `Invalid or expired Perpetuus API key…` |
| 402 | `RuntimeError` | `Your Perpetuus plan contact limit was reached: …` |
| 403 | `RuntimeError` | missing scope (`The Perpetuus API key is missing the "crm:write" scope…`) or `Perpetuus denied access: …` |
| 404 | `RuntimeError` | `Not found in Perpetuus: …` |
| 429 | `RateLimitError` (Make pauses the scenario and retries) | `Perpetuus rate limit reached (120 requests/min per key). Try again in N seconds.` |
| 5xx on reads | `ConnectionError` (Make retries later) | `Perpetuus server error (HTTP N). Try again later.` |
| 5xx on writes | `RuntimeError` (not retried, to avoid duplicate cards, tasks or contacts) | same, plus a note to check Perpetuus |

Make cannot wait for `Retry-After` inside a module, so the contract's "wait and retry twice" is
replaced by `RateLimitError`. Create a card does up to three requests; if the move to the chosen
phase fails, the module fails after the card was created (Make has no partial success): the error
says what happened and the card stays in the first phase.

## Validate locally

IML only runs inside Make, so the repository checks everything else:

```bash
cd make
npm ci                 # installs Ajv only
npm run validate       # or: node scripts/validate.mjs (works without Ajv, skips the schema check)
```

`scripts/validate.mjs` checks that:

1. `makecomapp.json` and every code file are valid JSON, every listed file exists and no file is
   orphaned; component IDs follow Make's rules;
2. every connection and `rpc://` reference exists, every RPC only reads parameters the calling
   module declares, every module is in a group;
3. review rules hold: Base and connection sanitize the `Authorization` header and handle errors,
   the 400/401/402/403/404/429 messages are the contract's, triggers have epoch, a required
   `limit`, `order: desc` matching `sort …:desc`, `data.lastDate` filter and pagination; searches
   have an optional `limit` and pagination; writes don't retry on 5xx; there is one universal
   module; labels are sentence case;
4. input names, interface, output keys and samples match `docs/v1-contract.md` (parsed from the
   contract tables, so a contract change breaks the check);
5. IML expressions are balanced and only read declared parameters;
6. there are no secrets (`ppt_…` keys, bearer tokens, private keys) in `make/`;
7. with Ajv, every file validates against Make's official editor schemas in [`schemas/`](schemas/).

CI runs it on every change ([`make-ci.yml`](../.github/workflows/make-ci.yml)).

## Deploy to Make

Nothing in this folder depends on a Make account. The only account-specific data is the
**origin** (`origins` in `makecomapp.json`, empty in the repository) and its API key file, which
stays outside Git.

### With the Make Apps Editor extension (VS Code)

Make marks the extension as deprecated for new apps but still supports it, including deploying a
local app into an empty app.

1. In Make, create a Make API token with the `sdk-apps:read` and `sdk-apps:write` scopes
   (**Profile → API access**), in the zone of your organization (for example `eu2.make.com`).
2. In Make, **Custom apps → Create a new app**: name `perpetuus-crm` (or the free name you get),
   label `Perpetuus CRM`, the brand color as theme and the logo (512×512 PNG). The app stays empty and private.
3. Open this repository in VS Code with the extension installed and the environment configured.
4. Right-click `make/app/makecomapp.json` → **Deploy to Make** → **Deploy into another app**. The
   extension adds an origin; replace the `-FILL-ME-` values:

   ```json
   "origins": [
       {
           "label": "Production",
           "baseUrl": "https://eu2.make.com/api",
           "appId": "perpetuus-crm",
           "appVersion": 1,
           "apikeyFile": "../../.secrets/apikey"
       }
   ]
   ```

   `baseUrl` is your Make zone, `appId` the app name created in step 2, `appVersion` is `1`.
   The API key file lives in `.secrets/` at the repository root, which is in `.gitignore`.
5. Deploy again and answer **Deploy as new remote component (and apply for all unmapped)**. The
   extension creates the connection, RPCs and modules and writes `idMapping` into the origin.
   Commit `makecomapp.json` with the origin and `idMapping` (no secrets in it) so the next deploys
   update the same components. For a separate testing app, add a second origin.

### With the Make TypeScript SDK (the route Make now recommends)

The same files can be uploaded with `@makehq/sdk` (`make.sdk.apps.create` with `private: true`,
then `setSection` and `getSection` per component). Section names map like this:

| Local file | SDK / API section |
|------------|-------------------|
| `general/base.iml.json` | app `base` |
| `README.md` | app `content` (documentation) |
| `modules/groups.json` | app `groups` |
| `*.communication.iml.json` | `api` |
| connection/RPC `*.params.iml.json` | `parameters` |
| `*.static-params.iml.json` | `parameters` |
| `*.mappable-params.iml.json` | `expect` |
| `*.interface.iml.json`, `*.samples.iml.json`, `*.epoch.iml.json` | `interface`, `samples`, `epoch` |

Component metadata (label, description, module type, CRUD, connection) comes from
`makecomapp.json`. Keep the RPC and module names as the IDs in that file (`rpc://listBoards`
references them by name); the connection name is generated by Make and is not referenced by IML.

## Test

There is no Make account yet, so nothing here was run against Make or the real API. After the
deploy:

1. Create a Perpetuus organization for tests with fictitious data and an API key with `crm:write`.
2. Create the connection; check the label `Organization (email)` and that a wrong key fails with
   the 401 message.
3. Build and run the scenarios in [docs/test-scenarios.md](docs/test-scenarios.md): they use every
   module, include pagination runs and an error scenario, as the review requires.
4. Check the RPCs in the Make web editor (**RPCs → Test**) with a board ID.
5. Record the checks in [`docs/STATUS.md`](../docs/STATUS.md).

## Review checklist

From [Make's app review prerequisites](https://developers.make.com/custom-apps-documentation/app-review/prerequisites):

- [x] Base and connection sanitize the API key (`request.headers.authorization`).
- [x] Base and connection handle errors with clear messages and the right error types.
- [x] Base and connection use the production API (`https://api.perpetuus.com.br/api`); the
      connection validates the key on `/auth/token-info` and a wrong key fails.
- [x] Modules have labels and descriptions in Make's naming conventions.
- [x] Universal module **Make an API call**.
- [x] Interfaces describe every output field; dates are `date`, IDs are text.
- [x] Dates are formatted in the requests (`formatDate`) and typed in interfaces.
- [x] Triggers, searches and RPCs have `limit` and pagination.
- [x] Only the credentials the API needs (one API key).
- [ ] Test scenarios run without errors, with pagination logs and an error scenario (needs the account).
- [ ] App logo (512×512 PNG) and theme color set in Make.
- [ ] Test modules/connections removed before publishing (publishing cannot be undone).
- [ ] App published, modules made visible, review form sent with the API docs link and scenario links.

## Technology Partner

The app review makes the app public for every Make user. Being listed as a Make **Technology
Partner** is a separate program with Make's partnership team: apply on make.com (partner program,
technology partners), with the approved app, a partnership contact, a support contact, the company
logo, categories and the service URL that the review form also asks for. Make may also ask for
co-marketing material (an integration page on perpetuus.com.br and templates). Approved apps must
keep being maintained: every change goes through Make's change review.
