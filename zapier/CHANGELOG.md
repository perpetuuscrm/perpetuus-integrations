## 1.1.0

- Instant triggers (REST Hooks on the Perpetuus webhook API): New Card, Card Entered Phase, New Contact and New Message (new, needs the `chat:read` scope). Deliveries are verified with the HMAC signature.
- The polling triggers New Card, Card Entered Phase and New Contact are hidden for new Zaps and labelled "(Polling)"; existing Zaps keep working unchanged.
- Contact type mapping also accepts `person`/`company`.

## 1.0.0

- First version: polling triggers, create/update actions, searches and dynamic dropdowns.
