import { existsSync } from "node:fs";
import path from "node:path";

import { loadEnv, type Env } from "./env";

/**
 * The monorepo root (the folder holding pnpm-workspace.yaml), searched upwards from `start`.
 * pnpm runs app scripts from apps/<name>, and Next runs from apps/web, so `cwd` alone is not enough.
 */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`Cannot find the repo root (pnpm-workspace.yaml) above ${start}`);
    dir = parent;
  }
}

/** Loads the repo-root `.env` (without overriding variables already set), then validates. */
export function loadRepoEnv(repoRoot: string = findRepoRoot()): Env {
  const envFile = path.join(repoRoot, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  return loadEnv();
}

/** A relative STUDIO_SKILLS_DIR is relative to the repo root too. */
export function resolveSkillsDir(
  env: Pick<Env, "STUDIO_SKILLS_DIR">,
  repoRoot: string = findRepoRoot(),
): string {
  return path.resolve(repoRoot, env.STUDIO_SKILLS_DIR);
}

/** A relative STUDIO_STORAGE_DIR is relative to the repo root, wherever the app was started from. */
export function resolveStorageDir(
  env: Pick<Env, "STUDIO_STORAGE_DIR">,
  repoRoot: string = findRepoRoot(),
): string {
  return path.resolve(repoRoot, env.STUDIO_STORAGE_DIR);
}
