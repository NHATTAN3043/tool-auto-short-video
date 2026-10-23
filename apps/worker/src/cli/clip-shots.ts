// pnpm clip:shots <video...> [--threshold=5] — cuts videos into shots the way clip analysis will (ADR 0019),
// without any AI call, and writes a page of stills to check the cuts by eye. Nothing is stored in the studio.
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { DEFAULT_CUT_THRESHOLD, FfmpegClipFrames, FfmpegMediaProbe } from "@studio/adapters";
import { loadRepoEnv } from "@studio/config";
import { MAX_SHOT_MS, MIN_SHOT_MS, shotMiddleMs, shotsFromCuts, type ShotSpan } from "@studio/domain";

import { REPO_ROOT } from "../container";
import { timestampName } from "./progress";

/** Same size the analysis sends to the AI. */
const FRAME_MAX_SIDE = 480;

const args = process.argv.slice(2);
const thresholdArg = args.find((arg) => arg.startsWith("--threshold="));
const threshold = thresholdArg ? Number(thresholdArg.slice("--threshold=".length)) : DEFAULT_CUT_THRESHOLD;
const files = args.filter((arg) => !arg.startsWith("--"));
if (files.length === 0 || !Number.isFinite(threshold) || threshold <= 0 || threshold > 100) {
  console.error(
    "Usage: pnpm clip:shots <video...> [--threshold=5]  (threshold 1–100, lower finds more cuts)",
  );
  process.exit(1);
}

const env = loadRepoEnv(REPO_ROOT);
const probe = new FfmpegMediaProbe({
  ffmpegPath: env.STUDIO_FFMPEG_PATH,
  ffprobePath: env.STUDIO_FFPROBE_PATH,
});
const frames = new FfmpegClipFrames({ ffmpegPath: env.STUDIO_FFMPEG_PATH });
const outRoot = path.join(tmpdir(), "studio-clip-shots", timestampName(`t${String(threshold)}`));

const seconds = (ms: number) => (ms / 1000).toFixed(1).replace(".", ",");
const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"]/gu,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char,
  );

interface ClipReport {
  file: string;
  folder: string;
  durationMs: number;
  cuts: number;
  shots: ShotSpan[];
  detectMs: number;
}

async function analyze(file: string, index: number): Promise<ClipReport> {
  const absolute = path.resolve(file);
  const probed = await probe.probe(absolute);
  if (probed.kind !== "video" || probed.durationMs === undefined) throw new Error(`${file} is not a video`);
  const started = Date.now();
  const cuts = await frames.detectCuts(absolute, { threshold });
  const detectMs = Date.now() - started;
  const shots = shotsFromCuts(cuts, probed.durationMs);
  const folder = `clip-${String(index + 1)}`;
  await frames.grabFrames(absolute, shots.map(shotMiddleMs), path.join(outRoot, folder), {
    maxSide: FRAME_MAX_SIDE,
  });
  return { file: absolute, folder, durationMs: probed.durationMs, cuts: cuts.length, shots, detectMs };
}

function page(reports: readonly ClipReport[]): string {
  const sections = reports.map((report) => {
    const cells = report.shots.map((shot, i) => {
      const length = shot.endMs - shot.startMs;
      const flag = length < MIN_SHOT_MS || length > MAX_SHOT_MS ? ' class="off"' : "";
      return `<figure${flag}><img src="${report.folder}/frame-${String(i).padStart(3, "0")}.jpg" alt=""><figcaption>#${String(i)} · ${seconds(shot.startMs)}–${seconds(shot.endMs)}s (${seconds(length)}s)</figcaption></figure>`;
    });
    return `<section><h2>${escapeHtml(path.basename(report.file))}</h2><p>${seconds(report.durationMs)}s · ffmpeg tìm ${String(report.cuts)} điểm cắt → ${String(report.shots.length)} đoạn · tách mất ${seconds(report.detectMs)}s</p><div class="grid">${cells.join("")}</div></section>`;
  });
  return `<!doctype html><html lang="vi"><meta charset="utf-8"><title>Clip shots · threshold ${String(threshold)}</title>
<style>body{font:14px system-ui;margin:16px;background:#111;color:#eee}.grid{display:flex;flex-wrap:wrap;gap:8px}
figure{margin:0;width:150px}img{width:150px;height:150px;object-fit:contain;background:#000}figcaption{font-size:12px}
.off figcaption{color:#f66}h2{margin:24px 0 4px}</style>
<h1>Threshold ${String(threshold)}</h1>${sections.join("")}</html>`;
}

await mkdir(outRoot, { recursive: true });
const reports: ClipReport[] = [];
for (const [i, file] of files.entries()) {
  try {
    const report = await analyze(file, i);
    reports.push(report);
    const lengths = report.shots.map((shot) => shot.endMs - shot.startMs);
    console.warn(
      `${path.basename(file)}: ${seconds(report.durationMs)}s, ${String(report.cuts)} cuts → ${String(report.shots.length)} shots ` +
        `(${seconds(Math.min(...lengths))}–${seconds(Math.max(...lengths))}s), detect ${seconds(report.detectMs)}s`,
    );
  } catch (error) {
    console.error(`${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
const html = path.join(outRoot, "index.html");
await writeFile(html, page(reports));
console.warn(`Open: ${html}`);
