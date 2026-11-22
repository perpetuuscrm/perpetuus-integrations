---
name: create-and-move-card
description: Create a Perpetuus CRM Card or move a Card to another Phase, with optional tags, comment and follow-up task. Use when the user asks to add a lead or opportunity to a Board, advance or move a Card, tag it, comment on it or schedule a follow-up.
---

# Create and move Cards

## When to use

- "Add Padaria Pão Dourado as a new Card in the sales Board."
- "Move the Costa Pet Shop Card to Qualified and note that the budget was approved."
- "Create a follow-up task for tomorrow at 10am on that Card."

## Instructions

1. Resolve the Board with `crm_list_boards` and its Phases, tags and required fields with `crm_get_board_structure`.
2. **Create:** call `crm_create_card` with the `boardId` and the title. Fill the fields that are required on the Board's first (form) Phase; if a required value is missing, ask the user instead of guessing. A new Card starts in the first Phase; to place it elsewhere, create it and then move it (step 3).
   - To link a person or company, find the contact first (`crm_search_contacts`) or create it (`crm_upsert_contact` dedupes by email and phone).
3. **Move:** find the Card with `crm_search_cards` (inside its Board), confirm the target Phase name with the user if more than one Card or Phase matches, then call `crm_move_card_phase`.
4. **Tags:** `crm_add_card_tags` adds tags without removing existing ones.
5. **Comment:** `crm_create_card_comment` on the Card.
6. **Task:** `crm_create_task` linked to the Card, with name, due date (ask for the time zone if unclear; Perpetuus users are mostly in America/Sao_Paulo), type and priority.
7. Report what changed: Card title, Board, Phase before and after, and any task or comment created.

## Safety

- Writing tools change real CRM data. Before a move, bulk change or anything that sends a message, restate the change and get the user's confirmation.
- Never delete Cards, Boards or Phases unless the user explicitly asks for that specific record.
