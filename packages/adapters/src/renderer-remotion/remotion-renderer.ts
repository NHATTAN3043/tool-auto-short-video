import { rename, rm } from "node:fs/promises";

import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { ALL_LAYERS, buildRenderPlan, filterRenderPlan } from "@studio/domain";
import type { RendererPort, RenderRequest } from "@studio/services";

import { startFileServer } from "./file-server";

export interface RemotionRendererOptions {
  /** `@studio/video` entry file that calls registerRoot. */
  entryPoint: string;
  /** `@studio/video/public`, where the bundled font lives; staticFile() resolves against it. */
  publicDir: string;
  compositionId: string;
  /** Local Chrome/Chromium (STUDIO_BROWSER_EXECUTABLE); otherwise Remotion's own headless shell. */
  browserExecutable?: string;
  /** CRF for H.264; ~20 keeps text crisp at a reasonable size. */
  crf?: number;
}

export class RemotionRenderer implements RendererPort {
  private bundled: Promise<string> | null = null;

  constructor(private readonly options: RemotionRendererOptions) {}

  async render({
    project,
    projectDir,
    outputPath,
    layers = ALL_LAYERS,
    format = "mp4",
    onProgress,
  }: RenderRequest): Promise<void> {
    if (!/\.(mp4|wav)$/u.test(outputPath) || !outputPath.endsWith(`.${format}`)) {
      throw new Error(`Output path must end with .${format}: ${outputPath}`);
    }
    const server = await startFileServer(projectDir);
    // Same extension so Remotion keeps the container; renamed only once the file is complete.
    const partial = outputPath.replace(/\.(mp4|wav)$/u, ".partial.$1");
    try {
      const plan = buildRenderPlan(project, (asset) => server.urlFor(asset.path));
      const inputProps = { plan: filterRenderPlan(plan, layers) };
      const serveUrl = await this.serveUrl();
      const browserExecutable = this.options.browserExecutable ?? null;
      const composition = await selectComposition({
        serveUrl,
        id: this.options.compositionId,
        inputProps,
        browserExecutable,
      });
      await renderMedia({
        composition,
        serveUrl,
        inputProps,
        browserExecutable,
        // WAV is audio only: no video is encoded and no extra file is produced.
        ...(format === "wav"
          ? { codec: "wav" as const }
          : {
              codec: "h264" as const,
              audioCodec: "aac" as const,
              // yuv420p is what phones and the platforms can all decode. Frames are captured as full-range
              // JPEG; without bt709 the file is tagged yuvj420p (full range), which some players show washed out.
              pixelFormat: "yuv420p" as const,
              colorSpace: "bt709" as const,
              crf: this.options.crf ?? 20,
            }),
        enforceAudioTrack: true,
        outputLocation: partial,
        overwrite: true,
        onProgress: ({ progress }) => onProgress?.(progress),
      });
      await rename(partial, outputPath);
    } finally {
      await server.close();
      await rm(partial, { force: true });
    }
  }

  /** Bundling takes 20–40s, so it happens once per process and is reused by every render. */
  private serveUrl(): Promise<string> {
    this.bundled ??= bundle({ entryPoint: this.options.entryPoint, publicDir: this.options.publicDir }).catch(
      (error: unknown) => {
        this.bundled = null;
        throw error;
      },
    );
    return this.bundled;
  }
}
