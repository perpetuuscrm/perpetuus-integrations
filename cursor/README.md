# Perpetuus CRM plugin for Cursor

Official [Cursor](https://cursor.com) plugin for [Perpetuus CRM](https://www.perpetuus.com.br/en). It connects Cursor's agent to your Perpetuus organization through the official Perpetuus MCP server, so you can work with your **Boards, Phases and Cards**, contacts, tasks and conversations without leaving the editor.

## What's inside

| Component | Path | What it does |
|-----------|------|--------------|
| Manifest | `.cursor-plugin/plugin.json` | Plugin name `perpetuus-crm`, metadata and logo |
| MCP server | `mcp.json` | Remote MCP server `https://perpetuus-crm-mcp.services.perpetuus.com.br/mcp` (Streamable HTTP, OAuth 2.1) |
| Skill | `skills/review-board-pipeline` | Summarize a Board: Cards per Phase, counts, reports |
| Skill | `skills/create-and-move-card` | Create a Card, move it between Phases, tag it, comment, add a follow-up task |
| Skill | `skills/find-contact-history` | Find a contact and show their Cards, tasks, notes and conversations |
| Logo | `assets/logo.png` | 512×512 PNG |

## Requirements

- A Perpetuus account (sign up at https://www.perpetuus.com.br). The plugin does not create accounts, change plans or process payments.
- Cursor with plugin support.

## Setup

1. Install **Perpetuus CRM** from the Cursor Marketplace (or, for local testing, copy this folder to `~/.cursor/plugins/local/perpetuus-crm`).
2. Open Cursor Settings → MCP (or Customize → Plugins) and enable the `perpetuus` server. It shows up as `plugin-perpetuus-crm-perpetuus`.
3. Cursor opens the Perpetuus sign-in page. Log in, pick the organization and approve the requested access on the consent screen.

No API key or secret goes in this repository: authentication is OAuth 2.1 with PKCE and dynamic client registration, and the token stays in Cursor. You can revoke access at any time in Perpetuus under **Settings → API Tokens e MCP**.

## Usage examples

- "List my Boards and the Phases of the sales Board."
- "Which Cards are in the Qualified Phase of the sales Board?"
- "Find the contact Maria Silva and show her open Cards."
- "Move the Costa Pet Shop Card to Qualified and add the comment 'Budget approved'."
- "Create a task 'Send proposal' due tomorrow at 10am on the Studio Ana Souza Card."

## Permissions and safety

- The server only sees the organization you chose on the consent screen. Role permissions and plan limits are enforced by the Perpetuus API.
- Tools are annotated (`readOnlyHint`, `destructiveHint`), so Cursor asks before running tools that change or delete data or send messages.
- Sending a WhatsApp or chat message and deleting records only happen when you ask for them explicitly.

## Support

- Documentation: https://docs.perpetuus.com.br
- Email: contato@perpetuus.com.br
- Privacy policy: https://www.perpetuus.com.br/privacy · Terms: https://www.perpetuus.com.br/terms
- Security issues: report to contato@perpetuus.com.br with "security" in the subject.

## License

[MIT](LICENSE)
