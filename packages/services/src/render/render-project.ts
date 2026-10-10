import { buildCaptions, captionsToSrt, DomainError } from "@studio/domain";

import type { ProjectRepository } from "../ports/project-repository";
import type { RendererPort } from "../ports/renderer";
import type { StoragePort } from "../ports/storage";

export interface RenderProjectInput {
  projectId: string;
  /** File name without extension, e.g. the job id. */
  outputName: string;
  onProgress?: (progress: number) => void;
}

export interface RenderProjectResult {
  /** Relative to the project folder, like asset paths. */
  videoPath: string;
  srtPath: string;
}

const OUTPUT_NAME = /^[A-Za-z0-9_-]+$/u;

async function* bytesOf(text: string): AsyncIterable<Uint8Array> {
  await Promise.resolve();
  yield new TextEncoder().encode(text);
}

/** Renders `projects/<id>/render/<name>.mp4` and writes the matching `.srt` next to it. */
export function makeRenderProject(deps: {
  repo: ProjectRepository;
  storage: StoragePort;
  renderer: RendererPort;
}) {
  return async (input: RenderProjectInput): Promise<RenderProjectResult> => {
    if (!OUTPUT_NAME.test(input.outputName)) {
      throw new DomainError("INVALID_INPUT", `Invalid output name: ${input.outputName}`);
    }
    const project = await deps.repo.get(input.projectId);
    if (project.scenes.length === 0) {
      throw new DomainError("INVALID_OPERATION", "The project has no scenes to render");
    }

    const projectKey = `projects/${project.id}`;
    const videoPath = `render/${input.outputName}.mp4`;
    const srtPath = `render/${input.outputName}.srt`;
    await deps.renderer.render({
      project,
      projectDir: deps.storage.resolvePath(projectKey),
      outputPath: await deps.storage.pathForWrite(`${projectKey}/${videoPath}`),
      ...(input.onProgress && { onProgress: input.onProgress }),
    });
    // Captions as a separate file, for platforms that take uploaded subtitles.
    await deps.storage.write(`${projectKey}/${srtPath}`, bytesOf(captionsToSrt(buildCaptions(project))));
    return { videoPath, srtPath };
  };
}
