# Test scenarios for the Make app review

Make asks for scenarios that use **every module** at least once, run without errors right before
the review request, include **pagination** logs for searches and list RPCs, and **one scenario that
ends in an error**. Logs must not contain personal data, so use a Perpetuus test organization with
fictitious records only.

These scenarios are described step by step (not as blueprints) because a blueprint embeds the
account-specific app name and connection ID. Build them once in the Make test team, run them, and
send their links in the review form.

## Preparation

1. Perpetuus test organization with:
   - a board **Make review** with phases *Lead* (form phase), *Proposal* and *Won*, the tags
     *Hot lead* and *Make*, one custom field per type (text `origem`, number `valor_proposta`,
     select `canal` with options, date `data_visita`, switch `vip`) and one required field in the
     form phase;
   - at least **120 contacts** and **120 cards** on that board (to force two pages of 100 in the
     searches), all fictitious (`teste-001@example.com`, …);
   - two board members.
2. A Perpetuus API key with `crm:write`, valid for 365 days, stored only in the Make connection.
3. In Make: the connection **Perpetuus CRM (Make review)**; check that its label shows
   `Organization (email)`.

## Scenario 1: contact → card → tags → move → task (all actions and triggers)

Run each trigger once with **Run once** after the action steps of scenario 1B created data.

**1A. Actions** (scheduled: on demand)

| # | Module | Settings |
|---|--------|----------|
| 1 | Tools → Set multiple variables | `email = make-review-{{now}}@example.com`, `phone = (11) 98888-{{formatDate(now; "mmss")}}` |
| 2 | Perpetuus CRM → **Create or update a contact** | Email `{{1.email}}`, Phone `{{1.phone}}`, Name `Make Review`, Contact type *Person*, City `São Paulo`, Custom fields `origem = Make` |
| 3 | Perpetuus CRM → **Create or update a contact** | Same email, Name `Make Review (updated)`; expect `created = false`, `matchedBy = email` |
| 4 | Perpetuus CRM → **Create a card** | Board *Make review*, Title `Make Review card`, Contact ID `{{2.id}}`, Value `1500.50`, Due date `{{addDays(now; 7)}}`, the custom fields that loaded (including the required one), Phase *Proposal* (forces the extra move request) |
| 5 | Perpetuus CRM → **Add tags to a card** | Board *Make review*, Card ID `{{4.id}}`, Tags *Hot lead*, *Make* |
| 6 | Perpetuus CRM → **Move a card to a phase** | Board *Make review*, Card ID `{{4.id}}`, Phase *Won*, Reason `Make review` |
| 7 | Perpetuus CRM → **Create a task** | Name `Send the proposal`, Card ID `{{4.id}}`, Due date `{{addDays(now; 1)}}`, Type *Follow-up*, Priority *High*, Assignees one member |
| 8 | Perpetuus CRM → **Make an API call** | URL `/tasks/{{7.id}}`, Method `PUT`, Body `{"data": {"taskStatus": "completed"}}` (use the done status of the board) to complete the task for scenario 1B |

Expected: every module succeeds; module 4 returns `phaseName = Proposal` and the custom fields in
`fields`; module 5 returns both tags in `tagNames` plus the ones the card already had; module 6
returns `phaseName = Won`.

**1B. Triggers** (one scenario per trigger, or one scenario with the trigger and a Tools → Set
variable after it)

| Scenario | Trigger | Settings | Expected after 1A |
|----------|---------|----------|-------------------|
| 1B-1 | **Watch new cards** | Board *Make review*, Limit 10, start *Since specific date* = before 1A | The card of 1A, with `eventId = id` |
| 1B-2 | **Watch cards entering a phase** | Board *Make review*, Phase empty, Limit 10, start before 1A | The card in *Won* (and earlier phases only if a run happened between the moves) |
| 1B-3 | **Watch cards entering a phase** | Board *Make review*, Phase *Won*, Limit 10 | Only cards entering *Won* |
| 1B-4 | **Watch new contacts** | Limit 10, start before 1A | The contact of 1A |
| 1B-5 | **Watch completed tasks** | Board *Make review*, Limit 10, start before 1A | The task completed by module 8 |

Run each trigger a second time without new data: it must return **no bundles** (deduplication).
Then move the card back to *Proposal* and again to *Won* and run 1B-3: the card must trigger again
(new `phaseEnteredAt`).

## Scenario 2: searches with pagination (end of separate routes)

| # | Module | Settings | Expected |
|---|--------|----------|----------|
| 1 | Perpetuus CRM → **Search contacts** | Search by *Text*, Value `teste`, Limit empty | 100 bundles over two requests (pages of 100, capped at 100) |
| 2 | Perpetuus CRM → **Search contacts** | Search by *Email*, Value one test email | 1 bundle |
| 3 | Perpetuus CRM → **Search contacts** | Search by *Phone*, Value `(11) 98888-…` of scenario 1 | the contact of scenario 1 |
| 4 | Perpetuus CRM → **Search cards** | Board *Make review*, Limit `100` | 100 bundles, two requests in the log |
| 5 | Perpetuus CRM → **Search cards** | Board *Make review*, Title contains `Make Review`, Phase *Won* | the card of scenario 1 |

To see two requests with fewer records, temporarily lower `pagination[pageSize]` in the module
communication of the testing app only (never in the deployed production app).

## Scenario 3: error handling

| # | Module | Settings | Expected error |
|---|--------|----------|----------------|
| 1 | Perpetuus CRM → **Move a card to a phase** | Board *Make review*, Card ID `does-not-exist`, Phase *Won* | `[404] Not found in Perpetuus: …` (RuntimeError) |
| 2 | Perpetuus CRM → **Create a card** | Board *Make review*, Title only (required form field empty) | `[400] Perpetuus rejected the request: … Details: …` (DataError) |
| 3 | Connection with a revoked key, any module | — | `[401] Invalid or expired Perpetuus API key…` |
| 4 | Connection with a key that only has `crm:read`, **Create a task** | — | `[403] The Perpetuus API key is missing the "crm:write" scope…` |

Keep scenario 3 with module 1 only for the review link (a 401 would stop the scenario).

## RPCs

In the Make web editor, test each RPC with the board of the test organization: `listBoards`,
`listPhases` (*Lead (form)*, *Proposal*, *Won*), `listTags`, `listMembers`, `listCards` and
`listContacts` (up to 300 items, three pages), and `listCardFields` (one field per type, the form
field marked required).

## Checklist before requesting the review

- [ ] Scenarios 1A, 1B-1…5, 2 and 3 ran on the same day as the request, with logs visible.
- [ ] No real personal data in inputs, outputs or logs; the API key does not appear in any log.
- [ ] Test-only modules and connections deleted from the app.
- [ ] Scenario links and the API documentation link (https://docs.perpetuus.com.br/docs/api) in the review form.
