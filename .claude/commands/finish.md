---
description: Verify the current change and summarize it before committing
---

1. Run `pnpm check`. If anything fails, fix it and run again until it passes.
2. Re-read the diff (`git diff` and untracked files) adversarially: scope creep, logic in components,
   imports that cross layers, missing tests for domain logic, secrets, leftover debug code.
3. Report: what changed (by file), how it was verified, remaining risks or TODOs,
   and a Conventional Commit message. Do not commit unless I ask.
