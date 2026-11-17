# Changelog

## 0.1.1 (2026-11-17)

- First public release. Publishes with `access: public` so npm can attach provenance (0.1.0 was never published).

## 0.1.0 (not published)

- Perpetuus API credential (API key `ppt_…`, configurable base URL, test on `GET /auth/token-info`).
- Perpetuus node: Contact (Create or Update, Search), Card (Create, Move to Phase, Add Tags, Search), Task (Create).
- Perpetuus Trigger (polling): New Card, Card Entered Phase, New Contact, Task Completed.
- Shared Retry-After handling for the 120 requests/min per key limit.
