// pnpm demo [--voice path/to/voice.mp3] — generates sample media with FFmpeg, creates the 3-scene demo
// project from fixtures/demo-project.json and renders it. Needs no API key and no network.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { migrateProject, type MediaAsset, type Project } from "@studio/domain";

import { createContainer, REPO_ROOT } from "../container";
import { progressPrinter, timestampName } from "./progress";

const { values } = parseArgs({ options: { voice: { type: "string" } } });
const container = createContainer();
const { env, storage, probe, repo } = container;
const projectKey = "projects/prj_demo";

function ffmpeg(args: string[]): void {
  execFileSync(env.STUDIO_FFMPEG_PATH, ["-v", "error", "-y", ...args], {
    stdio: "inherit",
    windowsHide: true,
  });
}

/** `testsrc` burns a running timestamp into the picture, so the chosen segment can be checked by eye. */
const generators: Record<string, (out: string, durationS: number) => void> = {
  ast_demo_video1: (out) => {
    ffmpeg([
      ...["-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=30:duration=12"],
      ...["-c:v", "libx264", "-pix_fmt", "yuv420p", out],
    ]);
  },
  ast_demo_video2: (out) => {
    ffmpeg([
      ...["-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30:duration=25"],
      ...["-vf", "hue=h=140", "-c:v", "libx264", "-pix_fmt", "yuv420p", out],
    ]);
  },
  ast_demo_photo: (out) => {
    ffmpeg(["-f", "lavfi", "-i", "mandelbrot=size=1600x1200", "-frames:v", "1", out]);
  },
  // Placeholder narration until TTS exists (M8): a quiet tone covering the whole video.
  ast_demo_voice: (out, durationS) => {
    ffmpeg([
      ...["-f", "lavfi", "-i", `sine=frequency=220:duration=${durationS.toFixed(2)}`],
      ...["-af", "volume=0.15", "-c:a", "libmp3lame", out],
    ]);
  },
};

async function prepareAsset(asset: MediaAsset, totalS: number): Promise<MediaAsset> {
  const key = `${projectKey}/${asset.path}`;
  const file = await storage.pathForWrite(key);
  if (asset.id === "ast_demo_voice" && values.voice) {
    copyFileSync(path.resolve(values.voice), file);
  } else if (!existsSync(file)) {
    const generate = generators[asset.id];
    if (!generate) throw new Error(`No generator for ${asset.id}`);
    generate(file, totalS);
  }
  // Metadata always comes from the real file, never from the fixture.
  const probed = await probe.probe(file);
  return {
    ...asset,
    ...(probed.durationMs !== undefined && asset.kind !== "image" && { durationMs: probed.durationMs }),
    ...(probed.width !== undefined &&
      asset.kind !== "audio" && { width: probed.width, height: probed.height }),
    ...(probed.fps !== undefined && asset.kind === "video" && { fps: probed.fps, hasAudio: probed.hasAudio }),
  };
}

const fixture: Project = migrateProject(
  JSON.parse(readFileSync(path.join(REPO_ROOT, "fixtures", "demo-project.json"), "utf8")),
);
const totalS = fixture.scenes.reduce((sum, scene) => sum + (scene.durationMs ?? 0), 0) / 1000;

console.warn("Preparing demo media…");
const assets: MediaAsset[] = [];
for (const asset of fixture.assets) assets.push(await prepareAsset(asset, totalS));
const project = await repo.save({ ...fixture, assets, updatedAt: new Date().toISOString() });

console.warn("Rendering (the first run bundles the composition and may download Chrome Headless Shell)…");
const started = Date.now();
const result = await container.renderProject({
  projectId: project.id,
  outputName: timestampName("demo"),
  onProgress: progressPrinter("demo"),
});
const projectDir = path.join(container.storageDir, projectKey);
console.warn(`Rendered in ${String(Math.round((Date.now() - started) / 1000))}s`);
console.warn(`MP4: ${path.join(projectDir, result.videoPath)}`);
console.warn(`SRT: ${path.join(projectDir, result.srtPath)}`);
await container.close();
