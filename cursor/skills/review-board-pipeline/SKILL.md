---
name: review-board-pipeline
description: Review a Perpetuus CRM Board pipeline. Use when the user asks how a Board is doing, which Cards are in a Phase, how many Cards entered a Phase in a period, or wants a pipeline summary or report.
---

# Review a Board pipeline

Perpetuus organizes work in **Boards**. Each Board has ordered **Phases** (the first one is usually a form/intake Phase) and holds **Cards**. Use this vocabulary with the user: Board, Phase, Card. Do not call Cards "deals".

## When to use

- "How is my sales Board doing?"
- "Which Cards are in the Qualified Phase?"
- "How many Cards entered Proposal this week?"

## Instructions

1. If the user did not name a Board, call `crm_list_boards` and ask which one, unless there is only one.
2. Call `crm_get_board_structure` for the Board to get its Phases (in order), tags and fields. Match Phase names case-insensitively; if the name is ambiguous, ask.
3. To list or count Cards, call `crm_search_cards` with the `boardId` and the Phase, tag, contact or date filters. For a count, use `pageSize` 1 and read `meta.pagination.total`.
4. For conversion, won/lost and Cards-per-day questions, prefer `crm_get_board_report`.
5. To go deeper on one Card, call `crm_get_card` (fields, tags, contact) and `crm_list_tasks` for its open tasks.
6. Summarize per Phase in order. Quote real names and numbers only; never invent Cards, contacts or values.

## Notes

- Everything is scoped to the organization chosen on the Perpetuus consent screen. Role permissions and plan limits are enforced by the API; report a permission error as is.
- These steps are read-only.
