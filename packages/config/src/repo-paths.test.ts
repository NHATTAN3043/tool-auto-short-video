import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { findRepoRoot, loadRepoEnv, resolveStorageDir } from "./repo-paths";

describe("repo paths", () => {
  let dir = "";

  afterEach(() => {
    vi.unstubAllEnvs();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function fakeRepo(): string {
    dir = mkdtempSync(path.join(tmpdir(), "studio-repo-root-"));
    writeFileSync(path.join(dir, "pnpm-workspace.yaml"), "packages: []\n");
    mkdirSync(path.join(dir, "apps", "web", "src"), { recursive: true });
    return dir;
  }

  it("finds the workspace root from a nested folder", () => {
    const root = fakeRepo();
    expect(findRepoRoot(path.join(root, "apps", "web", "src"))).toBe(root);
    expect(findRepoRoot(root)).toBe(root);
  });

  it("finds this repo from the current directory", () => {
    expect(findRepoRoot()).toBe(path.resolve(import.meta.dirname, "../../.."));
  });

  it("fails clearly outside a workspace", () => {
    dir = mkdtempSync(path.join(tmpdir(), "studio-no-root-"));
    expect(() => findRepoRoot(dir)).toThrow(/pnpm-workspace\.yaml/u);
  });

  it("resolves relative storage dirs against the root and keeps absolute ones", () => {
    const root = fakeRepo();
    expect(resolveStorageDir({ STUDIO_STORAGE_DIR: "./storage" }, root)).toBe(path.join(root, "storage"));
    const absolute = path.join(root, "elsewhere");
    expect(resolveStorageDir({ STUDIO_STORAGE_DIR: absolute }, root)).toBe(absolute);
  });

  it("loads the root .env without overriding variables already set", () => {
    const root = fakeRepo();
    writeFileSync(
      path.join(root, ".env"),
      "STUDIO_FFMPEG_PATH=/from/env-file\nSTUDIO_FFPROBE_PATH=/ignored\n",
    );
    vi.stubEnv("STUDIO_FFMPEG_PATH", undefined);
    vi.stubEnv("STUDIO_FFPROBE_PATH", "/from/shell");
    const env = loadRepoEnv(root);
    expect(env.STUDIO_FFMPEG_PATH).toBe("/from/env-file");
    expect(env.STUDIO_FFPROBE_PATH).toBe("/from/shell");
  });
});
