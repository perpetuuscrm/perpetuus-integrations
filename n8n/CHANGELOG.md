# Changelog

## 0.2.1 (2026-11-24)

Changes requested in the n8n verification review of 0.2.0:

- All user-facing text is in English. The API key path is the same in the credential, the 401 error and the README: Settings → API Tokens and MCP ("API Tokens e MCP") → Connect your AI (MCP) → Connect editor → Connect new editor. The Portuguese menu label appears only in parentheses.
- Perpetuus Trigger codex `nodeVersion` is now `2.0`, matching the node's latest version.
- Perpetuus Trigger v2 now requires a valid signature on every request: when no signing secret is stored, the request is rejected with 401 instead of being accepted unsigned. Activation fails (and the new subscription is deleted) if Perpetuus does not return the signing secret.

## 0.2.0 (2026-11-20)

- **Perpetuus Trigger v2 is instant (webhooks).** New nodes subscribe to the Perpetuus webhook API when the workflow is activated (`POST /webhook-subscriptions`, `origin: n8n`) and unsubscribe when it is deactivated. Events: New Card, Card Entered Phase, New Contact and the new **New Message** (needs the `chat:read` scope). Every delivery is checked against `X-Perpetuus-Signature` (HMAC-SHA256 with the subscription secret, 5-minute timestamp tolerance); unsigned or tampered requests get 401. The output is the same as the polling trigger, plus `webhookEventId` (and `previousPhaseId`/`previousPhaseName` for Card Entered Phase).
- Existing workflows keep working: nodes created before 0.2.0 stay on Perpetuus Trigger **v1** (polling, unchanged).
- New **Perpetuus Polling Trigger** node with the polling events (including Task Completed, which has no webhook event yet) for instances Perpetuus cannot reach over public HTTPS.
- Contact type mapping also accepts `person`/`company`.

## 0.1.3 (2026-11-17)

- Fix "Class could not be found" when installing on instances that have an older `n8n-workflow` in `~/.n8n/nodes/node_modules` (left there by community packages installed under n8n 1.x). The community package resolves that copy before n8n's own, and versions before `NodeConnectionTypes` existed made the node constructors throw. The nodes now declare their `main` inputs and outputs as string literals, so they load with any `n8n-workflow` version. Regression test added.

## 0.1.2 (2026-11-17)

- Author email changed to luis.santos@perpetuus.com.br so the n8n Creator Portal sends the ownership token to a mailbox that exists.

## 0.1.1 (2026-11-17)

- First public release. Publishes with `access: public` so npm can attach provenance (0.1.0 was never published).

## 0.1.0 (not published)

- Perpetuus API credential (API key `ppt_…`, configurable base URL, test on `GET /auth/token-info`).
- Perpetuus node: Contact (Create or Update, Search), Card (Create, Move to Phase, Add Tags, Search), Task (Create).
- Perpetuus Trigger (polling): New Card, Card Entered Phase, New Contact, Task Completed.
- Shared Retry-After handling for the 120 requests/min per key limit.
