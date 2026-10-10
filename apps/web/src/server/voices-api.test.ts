import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { scriptToScenes, setVoiceSettings, type Project, type RenderJob } from "@studio/domain";
import { FakeTts } from "@studio/services/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as estimateRoute } from "@/app/api/projects/[id]/voices/estimate/route";
import { POST as voicesRoute } from "@/app/api/projects/[id]/voices/route";
import { GET as getJob } from "@/app/api/projects/[id]/renders/[jobId]/route";
import { GET as listRenders, POST as renderRoute } from "@/app/api/projects/[id]/renders/route";
import { PUT } from "@/app/api/projects/[id]/route";
import { POST as createRoute } from "@/app/api/projects/route";
import { GET as catalogRoute } from "@/app/api/voices/route";

import { resetContainer } from "./container";

const voice = {
  provider: "fake",
  voiceId: "v1",
  modelId: "m1",
  stability: 0.5,
  similarityBoost: 0.75,
  speed: 1,
};

describe("voice API", () => {
  let dir = "";
  let tts: FakeTts;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "studio-voices-"));
    vi.stubEnv("STUDIO_STORAGE_DIR", dir);
    vi.stubEnv("ELEVENLABS_DEFAULT_VOICE_ID", "v1");
    tts = new FakeTts();
    resetContainer({ tts });
  });

  afterEach(() => {
    resetContainer();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const post = (body?: unknown) =>
    new Request("http://x", { method: "POST", ...(body !== undefined && { body: JSON.stringify(body) }) });

  async function project(withVoice = true): Promise<Project> {
    const created = (await (await createRoute(post({ name: "Giọng", mode: "assisted" }))).json()) as Project;
    let edited: Project = { ...created, scenes: scriptToScenes("Một.\n\nHai.\n\nBa.") };
    if (withVoice) edited = setVoiceSettings(edited, voice);
    const res = await PUT(
      new Request("http://x", { method: "PUT", body: JSON.stringify(edited) }),
      ctx(created.id),
    );
    return (await res.json()) as Project;
  }

  it("lists voices, models and defaults", async () => {
    const res = await catalogRoute();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      provider: "fake",
      models: tts.models,
      voices: tts.voices,
      defaults: { provider: "fake", modelId: "eleven_flash_v2_5", voiceId: "v1" },
    });
  });

  it("reports a provider failure without leaking its message", async () => {
    tts.failList = true;
    const res = await catalogRoute();
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("invalid key");
  });

  it("estimates the scenes that need a voice without calling the provider", async () => {
    const p = await project();
    const res = await estimateRoute(post({ sceneIds: [p.scenes[1]?.id] }), ctx(p.id));
    expect(await res.json()).toEqual({
      sceneIds: [p.scenes[1]?.id],
      characters: 4,
      credits: 2,
      usd: 2 * 0.0006,
      budget: expect.objectContaining({
        allowed: true,
        planned: { totalUsd: 0.0012, maxCallUsd: 0.0012 },
      }) as unknown,
    });
    expect(tts.calls).toEqual([]);
  });

  it("queues a tts job that is pollable but hidden from the render list", async () => {
    const p = await project();
    const res = await voicesRoute(post(), ctx(p.id));
    expect(res.status).toBe(202);
    const job = (await res.json()) as RenderJob;
    expect(job).toMatchObject({ kind: "tts", sceneIds: p.scenes.map((s) => s.id), status: "QUEUED" });

    const polled = await getJob(new Request("http://x"), {
      params: Promise.resolve({ id: p.id, jobId: job.id }),
    });
    expect(((await polled.json()) as RenderJob).id).toBe(job.id);
    expect(tts.calls).toEqual([]);
    // The render list endpoint still returns it; the panel filters it out (isOutputJob).
    expect(
      (await (await listRenders(new Request("http://x"), ctx(p.id))).json()) as RenderJob[],
    ).toHaveLength(1);
  });

  it("rejects voice generation without voice settings and invalid bodies", async () => {
    const p = await project(false);
    expect((await voicesRoute(post(), ctx(p.id))).status).toBe(409);
    expect((await voicesRoute(post({ sceneIds: [] }), ctx(p.id))).status).toBe(400);
  });

  it("does not accept tts as a render kind", async () => {
    const p = await project();
    expect((await renderRoute(post({ kind: "tts" }), ctx(p.id))).status).toBe(400);
  });

  it("answers 404 TTS_UNAVAILABLE on every voice route without a provider", async () => {
    resetContainer({ tts: null });
    const p = await project();
    for (const res of [
      await catalogRoute(),
      await estimateRoute(post(), ctx(p.id)),
      await voicesRoute(post(), ctx(p.id)),
    ]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: "TTS_UNAVAILABLE" } });
    }
  });
});
