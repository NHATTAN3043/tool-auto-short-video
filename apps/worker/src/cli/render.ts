// pnpm render <projectId> — renders a project directly, without going through the job queue.
import path from "node:path";

import { createContainer } from "../container";
import { progressPrinter, timestampName } from "./progress";

const projectId = process.argv[2];
if (!projectId) {
  console.error("Usage: pnpm render <projectId>");
  process.exit(1);
}

const container = createContainer();
const started = Date.now();
try {
  const result = await container.renderProject({
    projectId,
    outputName: timestampName("render"),
    onProgress: progressPrinter("render"),
  });
  const projectDir = path.join(container.storageDir, "projects", projectId);
  console.warn(`Rendered in ${String(Math.round((Date.now() - started) / 1000))}s`);
  console.warn(`MP4: ${path.join(projectDir, result.videoPath)}`);
  console.warn(`SRT: ${path.join(projectDir, result.srtPath)}`);
  await container.close();
} catch (error) {
  console.error(`Render failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
