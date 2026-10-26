# Repository Guidelines

## Project Structure & Module Organization

Shorts Studio is a TypeScript pnpm monorepo for creating vertical videos.

- `apps/web`: Next.js UI and API routes; features live in `src/features`, dependency wiring in `src/server/container.ts`.
- `apps/worker`: background jobs for rendering, voice generation, and AI tasks.
- `packages/domain`: pure business rules and Zod schemas; `packages/services`: use cases, ports, and testing fakes.
- `packages/adapters`: storage, database, FFmpeg, and external provider implementations.
- `packages/video`: shared Remotion preview/render composition and `public/` assets; `packages/config`: environment validation and TypeScript configuration.
- Tests sit beside source files. `fixtures/` contains sample projects; `docs/` holds architecture, plans, and ADRs. Generated media and runtime data belong in ignored `storage/`.

## Build, Test, and Development Commands

Use Node.js 22+ and the pnpm version pinned in `package.json`. Install FFmpeg and ffprobe for media operations.

- `pnpm install`: install workspace dependencies.
- `pnpm dev`: start web and worker together.
- `pnpm build`: run workspace builds.
- `pnpm check`: run formatting, ESLint, type checks, architecture checks, and tests.
- `pnpm test` / `pnpm test:watch`: run Vitest once or interactively.
- `pnpm test:coverage`: check domain coverage.
- `pnpm demo`: generate and render a sample project.
- `pnpm db:migrate`: apply PostgreSQL migrations when using a database.

## Coding Style & Architecture

Use two-space indentation, LF endings, double quotes, trailing commas, and Prettier's 110-character width. Run `pnpm format` to format changes. Use strict TypeScript, explicit type imports, and no `any`. Name modules in kebab-case and React components in PascalCase.

Validate external inputs with Zod. Keep business logic out of components and route handlers. Domain stays pure; services use ports; adapters implement them; application containers wire dependencies. Run `pnpm arch` to verify boundaries. Read `docs/SOURCE-BASE.md` and applicable nested guidance, including `apps/web/AGENTS.md`, before editing.

## Testing Guidelines

Use colocated `*.test.ts` files and service fakes for isolated tests. Add regression tests for changed behavior. Domain coverage requires 90% for lines, statements, functions, and branches. PostgreSQL tests require `TEST_DATABASE_URL` with permission to create temporary databases; otherwise they skip.

## Commit & Pull Request Guidelines

Follow existing Conventional Commits: `feat(clip): ...`, `fix(ffmpeg): ...`, or `docs: ...`. Keep commits focused. PRs should describe behavior changes, link relevant issues, report validation, and include screenshots for UI changes. Record significant architectural decisions in `docs/adr/`.

## Security & Configuration

Copy `.env.example` to `.env`; never commit secrets or expose provider keys to the browser. Keep Manual mode functional without API keys. Route paid calls through CostGuard and long-running work through worker jobs.
