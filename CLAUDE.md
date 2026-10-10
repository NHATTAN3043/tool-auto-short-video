# Shorts Studio

Scene-based tool that turns script + voice + media into vertical 1080×1920 videos for TikTok,
YouTube Shorts and Facebook Reels. Modes: Manual, Assisted, Full AI. A mode is only a preset of
`AutomationSettings`; code checks the individual toggles, never the mode name.

Read before any milestone: `docs/PLAN.md` (roadmap), `docs/SOURCE-BASE.md` (architecture and
conventions), `docs/TECH-NOTES.md` (known pitfalls and core algorithms), `docs/adr/`.

## Architecture (enforced by `pnpm arch`)

- `packages/domain` — pure: zod schemas, scene operations, timeline, captions, `buildRenderPlan`. Only depends on zod.
- `packages/services` — use cases + ports (interfaces). Depends only on domain. In-memory fakes in `src/testing`.
- `packages/adapters` — one folder per port implementation (storage-local, repository-json, postgres, ffmpeg, queue-file,
  renderer-remotion, tts-_, ai-_, media-*, cost-guard). Adapters never import each other.
- `packages/video` — Remotion composition `ProjectVideo`, consumes only a `RenderPlan`.
- `apps/web` — Next.js. `app/` is routing only; features in `src/features/*`; `src/server/container.ts` wires adapters.
- `apps/worker` — render job loop. Own `container.ts`.

## Rules

1. TypeScript strict, no `any`. Parse every external input (request, JSON file, API response) with zod.
2. No business logic in React components or route handlers: handler = parse → call service → respond.
3. Scene is the core object; each scene is independently editable. Changing media never regenerates voice and vice versa.
4. Non-destructive editing: never modify uploaded files; store references (sourceStartMs/sourceEndMs/fit/focusX).
5. AI is optional: Manual mode works with zero API keys. Missing key → service is null → UI hides the feature.
6. External services only through ports. Never called from the browser; keys never reach the browser.
7. Every paid call goes through CostGuard. Max 2 retries, only on 429/5xx.
8. Preview and render use the same `buildRenderPlan` + `ProjectVideo`. Never write a second composition.
9. Long work (render, TTS batches) runs as jobs in the worker, never inside an HTTP request.
10. Data files carry `schemaVersion`; schema changes ship with a migration.
11. Only implement the milestone requested. No microservices, no multi-track timeline editor.
12. Hard-to-reverse decisions get a short ADR in `docs/adr/`.

## Workflow

- Start: read the milestone in docs/PLAN.md, propose the files to add/change, wait for approval.
- Contract first: schema → types → pure function / use case → tests → adapter → UI.
- Finish: run `pnpm check` (format, lint, typecheck, arch, test); summarize changed files, risks,
  and a Conventional Commit message.

## Commands

- `pnpm dev` — web + worker
- `pnpm check` — everything CI runs
- `pnpm test` / `pnpm test:watch`
- `pnpm render <projectId>` / `pnpm demo`
- `pnpm db:migrate` / `pnpm db:import` / `pnpm db:generate` — Postgres tables, copy JSON data in, new migration
- Env: see `.env.example` (`STUDIO_STORAGE_DIR`, `STUDIO_BROWSER_EXECUTABLE`, `DATABASE_URL`, provider keys later)
