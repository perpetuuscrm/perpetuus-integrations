# Perpetuus integrations

Official no-code connectors for [Perpetuus CRM](https://perpetuus.com.br).

| Folder | What it is | Status |
|--------|------------|--------|
| [`docs/`](docs/) | Shared v1 contract: every trigger, action and search with its REST route, canonical field names, output shape and polling deduplication. All connectors follow it. [`docs/STATUS.md`](docs/STATUS.md) tracks what is done and what is left to publish each connector (pt-BR). | v1 |
| [`n8n/`](n8n/) | `n8n-nodes-perpetuus`, the n8n community node (Perpetuus + Perpetuus Trigger). | v0.1.0 (not published yet) |
| [`zapier/`](zapier/) | Perpetuus CRM app for Zapier (Platform CLI): 4 polling triggers, 5 actions, 2 searches and Find or Create Contact. | v1.0.0 (not published yet) |
| [`make/`](make/) | Perpetuus CRM custom app for Make, in the Make Apps Editor local-development layout: 4 polling triggers, 5 actions, 2 searches, RPC dropdowns and dynamic card fields, and the universal Make an API call module. Validated offline against the contract and Make's editor schemas. | v1 (not deployed yet) |
| [`cursor/`](cursor/) | Perpetuus CRM plugin for the Cursor Marketplace: remote MCP server (OAuth), 3 skills, logo. Listed in [`.cursor-plugin/marketplace.json`](.cursor-plugin/marketplace.json). | v1.0.0 (not submitted yet) |
| [`pluga/`](pluga/) | HTTP adapter implementing the Pluga Developers contract: 5 actions, 4 `rest_hook` triggers, dropdown helpers, signed webhook relay. | v1.0.0 (not deployed yet) |

All connectors authenticate with a Perpetuus API key (`ppt_…`). See the
[authentication docs](https://docs.perpetuus.com.br/docs/api/autenticacao) to create one.

## License

[MIT](LICENSE)
