# Perpetuus integrations

Official no-code connectors for [Perpetuus CRM](https://perpetuus.com.br).

| Folder | What it is | Status |
|--------|------------|--------|
| [`docs/`](docs/) | Shared v1 contract: every trigger, action and search with its REST route, canonical field names, output shape and polling deduplication. All connectors follow it. | v1 |
| [`n8n/`](n8n/) | `n8n-nodes-perpetuus`, the n8n community node (Perpetuus + Perpetuus Trigger). | v0.1.0 (not published yet) |
| [`zapier/`](zapier/) | Perpetuus CRM app for Zapier (Platform CLI): 4 polling triggers, 5 actions, 2 searches and Find or Create Contact. | v1.0.0 (not published yet) |
| `make/` | Make custom app | planned |

All connectors authenticate with a Perpetuus API key (`ppt_…`). See the
[authentication docs](https://docs.perpetuus.com.br/docs/api/autenticacao) to create one.

## License

[MIT](LICENSE)
