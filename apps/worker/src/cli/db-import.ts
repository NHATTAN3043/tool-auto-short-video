// pnpm db:import — copies the JSON data of ADR 0001 (projects, render jobs, libraries, API usage, budgets) into
// Postgres. Rows that already exist are skipped, so it can run again; the JSON files are never changed.
import {
  createPgDatabase,
  PgApiUsageLog,
  PgBudgetSettings,
  PgJobQueue,
  PgMediaLibrary,
  PgProjectRepository,
  PgSfxLibrary,
} from "@studio/adapters/postgres";
import { FileJobQueue } from "@studio/adapters/queue-file";
import {
  JsonApiUsageLog,
  JsonBudgetSettings,
  JsonMediaLibrary,
  JsonProjectRepository,
  JsonSfxLibrary,
} from "@studio/adapters/repository-json";
import { findRepoRoot, loadRepoEnv, resolveStorageDir } from "@studio/config";

const repoRoot = findRepoRoot(import.meta.dirname);
const env = loadRepoEnv(repoRoot);
if (env.DATABASE_URL === undefined) {
  console.error("DATABASE_URL is not set in .env — run `pnpm db:migrate` after setting it.");
  process.exit(1);
}
const storageDir = resolveStorageDir(env, repoRoot);
const database = createPgDatabase(env.DATABASE_URL);

const json = {
  repo: new JsonProjectRepository(storageDir),
  queue: new FileJobQueue(storageDir),
  library: new JsonSfxLibrary(storageDir),
  media: new JsonMediaLibrary(storageDir),
  usage: new JsonApiUsageLog(storageDir),
  budget: new JsonBudgetSettings(storageDir),
};
const pg = {
  repo: new PgProjectRepository(database.db),
  queue: new PgJobQueue(database.db),
  library: new PgSfxLibrary(database.db),
  media: new PgMediaLibrary(database.db),
  usage: new PgApiUsageLog(database.db),
  budget: new PgBudgetSettings(database.db),
};

let failures = 0;

async function importEach<T extends { id: string }>(
  label: string,
  items: T[],
  existing: Set<string>,
  write: (item: T) => Promise<unknown>,
  skip: (item: T) => string | undefined = () => undefined,
): Promise<void> {
  const tally = { imported: 0, skipped: 0, failed: 0 };
  for (const item of items) {
    const reason = existing.has(item.id) ? "already in the database" : skip(item);
    if (reason !== undefined) {
      tally.skipped++;
      if (!existing.has(item.id)) console.warn(`[${label}] skip ${item.id}: ${reason}`);
      continue;
    }
    try {
      await write(item);
      tally.imported++;
    } catch (error) {
      tally.failed++;
      console.error(
        `[${label}] ${item.id} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  failures += tally.failed;
  console.warn(
    `${label}: ${String(tally.imported)} imported, ${String(tally.skipped)} skipped, ${String(tally.failed)} failed`,
  );
}

try {
  console.warn(`Importing from ${storageDir}`);

  // Projects first: render jobs reference them.
  const summaries = await json.repo.list();
  const projects = [];
  for (const { id } of summaries) projects.push(await json.repo.get(id));
  const knownProjects = new Set((await pg.repo.list()).map((project) => project.id));
  await importEach("projects", projects, knownProjects, (project) => pg.repo.save(project));

  const projectIds = new Set((await pg.repo.list()).map((project) => project.id));
  const knownJobs = new Set((await pg.queue.list()).map((job) => job.id));
  await importEach(
    "render jobs",
    await json.queue.list(),
    knownJobs,
    (job) => pg.queue.enqueue(job),
    (job) => (projectIds.has(job.projectId) ? undefined : `project ${job.projectId} does not exist`),
  );

  const knownSfx = new Set((await pg.library.list()).map((sfx) => sfx.id));
  await importEach("sound effects", await json.library.list(), knownSfx, (sfx) => pg.library.add(sfx));

  const knownMedia = new Set((await pg.media.list()).map((item) => item.id));
  await importEach("library media", await json.media.list(), knownMedia, (item) => pg.media.add(item));

  // Usage rows have no foreign key: spend of deleted projects still counts against the budgets.
  const knownUsage = new Set((await pg.usage.list()).map((entry) => entry.id));
  await importEach("API usage", await json.usage.list(), knownUsage, (entry) => pg.usage.append(entry));

  const budget = await json.budget.get();
  if (budget !== null && (await pg.budget.get()) === null) {
    await pg.budget.save(budget);
    console.warn("budget settings: imported");
  }

  if (failures > 0) process.exitCode = 1;
} catch (error) {
  console.error(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await database.close();
}
