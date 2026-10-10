---
description: Plan and implement one milestone from docs/PLAN.md
argument-hint: <milestone, e.g. M3>
---

Implement milestone $ARGUMENTS from docs/PLAN.md.

1. Read CLAUDE.md, the $ARGUMENTS section of docs/PLAN.md, and the related parts of
   docs/SOURCE-BASE.md and docs/TECH-NOTES.md. Inspect the current repository structure.
2. Reply with: the files you will add or change, the public interfaces/schemas you will introduce,
   the tests you will write, and anything in the milestone that is ambiguous. Then STOP and wait for my approval.
3. After approval, implement contract-first (schema → types → logic → tests → adapters → UI).
   Stay strictly inside the milestone's scope and its "Không làm" list.
4. Finish with /finish.
