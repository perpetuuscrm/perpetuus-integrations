---
name: find-contact-history
description: Find a contact in Perpetuus CRM and show their Cards, tasks, notes and conversation history. Use when the user asks who someone is, what is happening with a customer or lead, or wants the context before a call or reply.
---

# Find a contact and their history

## When to use

- "Find Maria Silva and show her open Cards."
- "What did we last talk about with Oliveira Contabilidade?"
- "Give me the context on this customer before my call."

## Instructions

1. Search with `crm_search_contacts` by name, email, phone, CPF or CNPJ. If several contacts match, list them (name, email, phone) and ask which one.
2. Open the contact with `crm_get_contact`.
3. Cards: for each Board the user cares about (or all Boards from `crm_list_boards`), call `crm_search_cards` filtered by the contact. Show Board, Phase and title of each Card.
4. Activity: `crm_list_contact_activities` for notes and history; `crm_list_tasks` for open tasks on those Cards.
5. Conversations (needs the chat scope): `crm_list_contact_conversations`, then `crm_list_conversation_messages` for the most recent one. Summarize; quote only what the messages say.
6. Present a short brief: who they are, open Cards by Phase, open tasks, last interaction and its date.

## Notes

- Contact data is personal data. Show only what the user asked for and do not copy it elsewhere.
- Replying in a conversation (`crm_send_conversation_message`) sends a real message to the customer: only do it when the user explicitly asks, and confirm the text first.
