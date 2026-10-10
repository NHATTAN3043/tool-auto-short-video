import type { Project, RenderLayers } from "@studio/domain";

export interface RenderRequest {
  project: Project;
  /** Absolute project folder; asset paths in the project are relative to it. */
  projectDir: string;
  /** Absolute path to create, with the extension matching `format`. */
  outputPath: string;
  /** Default: everything. Switched-off layers are left out but the timing stays the same. */
  layers?: RenderLayers;
  /** `mp4` (default): H.264/AAC video. `wav`: audio only, same length as the video. */
  format?: "mp4" | "wav";
  /** 0..1 */
  onProgress?: (progress: number) => void;
}

/** Turns a project into an MP4 (H.264/AAC/yuv420p) or a WAV. Builds the RenderPlan itself, with URLs it can serve. */
export interface RendererPort {
  render(request: RenderRequest): Promise<void>;
}
