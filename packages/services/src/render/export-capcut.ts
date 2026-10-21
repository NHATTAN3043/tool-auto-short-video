import {
  buildCaptions,
  buildRenderPlan,
  captionsToSrt,
  DomainError,
  filterRenderPlan,
  hasAudibleAudio,
  type Project,
  type RenderLayers,
} from "@studio/domain";

import type { ArchiveEntry, ArchivePort } from "../ports/archive";
import type { ClipCutterPort } from "../ports/clip-cutter";
import type { ProjectRepository } from "../ports/project-repository";
import type { RendererPort } from "../ports/renderer";
import type { StoragePort } from "../ports/storage";

export interface ExportCapcutInput {
  projectId: string;
  /** File name without extension, e.g. the job id. */
  outputName: string;
  onProgress?: (progress: number) => void;
}

export interface ExportCapcutResult {
  /** Relative to the project folder, like asset paths. */
  zipPath: string;
  srtPath: string;
}

export interface ExportCapcutDeps {
  repo: ProjectRepository;
  storage: StoragePort;
  renderer: RendererPort;
  cutter: ClipCutterPort;
  archive: ArchivePort;
}

const OUTPUT_NAME = /^[A-Za-z0-9_-]+$/u;

const NONE: RenderLayers = {
  visuals: false,
  captions: false,
  voices: false,
  music: false,
  sfx: false,
  watermark: false,
};

/** Separate audio tracks, each rendered on its own and as long as the video. */
const AUDIO_TRACKS: readonly { name: string; layer: keyof RenderLayers; label: string }[] = [
  { name: "audio/giong_doc.wav", layer: "voices", label: "giọng đọc" },
  { name: "audio/nhac_nen.wav", layer: "music", label: "nhạc nền (đã lặp và chỉnh âm lượng)" },
  { name: "audio/hieu_ung.wav", layer: "sfx", label: "hiệu ứng âm thanh, đã đặt đúng thời điểm" },
];

const VIDEO_NAME = "video_khong_phu_de.mp4";
const SRT_NAME = "phu_de.srt";
const README_NAME = "HUONG_DAN.txt";

async function* bytesOf(text: string): AsyncIterable<Uint8Array> {
  await Promise.resolve();
  yield new TextEncoder().encode(text);
}

const clipName = (index: number) => `canh/canh_${String(index + 1).padStart(2, "0")}.mp4`;

function readme(project: Project, audioNames: readonly string[], clipCount: number): string {
  const tracks = AUDIO_TRACKS.filter((track) => audioNames.includes(track.name));
  const lines = [
    `Gói CapCut — ${project.name}`,
    "",
    "Trong gói:",
    `- ${VIDEO_NAME}: hình của cả video (kèm tiếng gốc của clip nếu có), KHÔNG có phụ đề, giọng đọc, nhạc hay hiệu ứng.`,
    ...tracks.map((track) => `- ${track.name}: ${track.label}.`),
    `- ${SRT_NAME}: phụ đề, chỉnh sửa được trong CapCut.`,
    `- canh/: ${String(clipCount)} clip, mỗi cảnh một file, nếu muốn sắp xếp hoặc thay từng cảnh.`,
    "",
    "Cách dùng trong CapCut (máy tính):",
    "1. Giải nén gói này.",
    `2. Nhập (Import) ${VIDEO_NAME} và các file trong audio/, kéo tất cả xuống timeline, mỗi file một track,`,
    "   và đặt TẤT CẢ bắt đầu ở 00:00. Mọi track dài bằng video nên sẽ khớp nhau.",
    `3. Phụ đề: vào Văn bản (Text) → Phụ đề cục bộ (Local captions) → Nhập (Import) → chọn ${SRT_NAME}.`,
    "4. Muốn đổi từng cảnh: dùng clip trong canh/ thay cho video tổng (cùng thứ tự, nối liền nhau).",
    "",
    "Lưu ý: kiểu chữ và hiệu ứng nảy của phụ đề không đi theo file SRT; chọn lại kiểu chữ trong CapCut.",
    "",
  ];
  return lines.join("\r\n");
}

/**
 * Builds `render/<name>.zip` for editing in CapCut: the video without captions, every audio layer as its
 * own WAV, the SRT, one clip per scene and a short guide. Every piece comes from the same RenderPlan as
 * the normal render, so they line up with each other and with the MP4. Intermediate files are removed.
 */
export function makeExportCapcut(deps: ExportCapcutDeps) {
  return async (input: ExportCapcutInput): Promise<ExportCapcutResult> => {
    if (!OUTPUT_NAME.test(input.outputName)) {
      throw new DomainError("INVALID_INPUT", `Invalid output name: ${input.outputName}`);
    }
    const project = await deps.repo.get(input.projectId);
    if (project.scenes.length === 0) {
      throw new DomainError("INVALID_OPERATION", "The project has no scenes to export");
    }

    const projectKey = `projects/${project.id}`;
    const workKey = `${projectKey}/render/${input.outputName}-capcut`;
    const zipPath = `render/${input.outputName}.zip`;
    const srtPath = `render/${input.outputName}.srt`;
    const projectDir = deps.storage.resolvePath(projectKey);
    const workFile = (name: string) => deps.storage.pathForWrite(`${workKey}/${name}`);

    // Timing only: the URLs do not matter here.
    const plan = buildRenderPlan(project, (asset) => asset.path);
    const audioTracks = AUDIO_TRACKS.filter((track) =>
      hasAudibleAudio(filterRenderPlan(plan, { ...NONE, [track.layer]: true })),
    );

    // Progress weights: the video dominates, audio-only renders are quick, clips are re-encoded.
    const steps = [
      0.6,
      ...audioTracks.map(() => 0.05),
      ...plan.scenes.map(() => 0.2 / plan.scenes.length),
      0.05,
    ];
    const total = steps.reduce((sum, weight) => sum + weight, 0);
    let done = 0;
    let step = 0;
    const report = (fraction: number) => {
      const weight = steps[step] ?? 0;
      input.onProgress?.(Math.min(1, (done + weight * Math.min(1, Math.max(0, fraction))) / total));
    };
    const finishStep = () => {
      done += steps[step] ?? 0;
      step += 1;
      report(0);
    };

    try {
      const entries: ArchiveEntry[] = [];
      const video = await workFile(VIDEO_NAME);
      await deps.renderer.render({
        project,
        projectDir,
        outputPath: video,
        // The channel logo stays burned into the picture, so the package cannot be reposted without it.
        layers: { ...NONE, visuals: true, watermark: true },
        onProgress: report,
      });
      entries.push({ name: VIDEO_NAME, file: video });
      finishStep();

      for (const track of audioTracks) {
        const file = await workFile(track.name);
        await deps.renderer.render({
          project,
          projectDir,
          outputPath: file,
          layers: { ...NONE, [track.layer]: true },
          format: "wav",
          onProgress: report,
        });
        entries.push({ name: track.name, file });
        finishStep();
      }

      // Cut on the plan's frame boundaries so the clips join back into exactly the full video.
      const toMs = (frames: number) => Math.round((frames / plan.fps) * 1000);
      for (const scene of plan.scenes) {
        const file = await workFile(clipName(scene.index));
        await deps.cutter.cut(video, file, {
          startMs: toMs(scene.from),
          endMs: toMs(scene.from + scene.durationInFrames),
        });
        entries.push({ name: clipName(scene.index), file });
        finishStep();
      }

      const srt = captionsToSrt(buildCaptions(project));
      await deps.storage.write(`${workKey}/${SRT_NAME}`, bytesOf(srt));
      entries.push({ name: SRT_NAME, file: await workFile(SRT_NAME) });
      await deps.storage.write(
        `${workKey}/${README_NAME}`,
        bytesOf(
          readme(
            project,
            audioTracks.map((track) => track.name),
            plan.scenes.length,
          ),
        ),
      );
      entries.push({ name: README_NAME, file: await workFile(README_NAME) });

      await deps.archive.zip(entries, await deps.storage.pathForWrite(`${projectKey}/${zipPath}`));
      // The SRT also on its own, like a normal render, so it can be downloaded without unzipping.
      await deps.storage.write(`${projectKey}/${srtPath}`, bytesOf(srt));
      finishStep();
      return { zipPath, srtPath };
    } finally {
      await deps.storage.removeFolder(workKey);
    }
  };
}
