import { FullAiDraftSchema, type FullAiDraft } from "@studio/domain";

import type { Clock } from "../ports/clock";
import type { ProjectRepository } from "../ports/project-repository";
import type { StoragePort } from "../ports/storage";

// The Full AI draft lives apart from the project (ADR 0015), so the editor's autosave of the whole
// project never overwrites it, and the other way round.

export const fullAiDraftKey = (projectId: string) => `projects/${projectId}/full-ai/draft.json`;

async function* bytes(data: Uint8Array): AsyncIterable<Uint8Array> {
  await Promise.resolve();
  yield data;
}

async function readText(storage: StoragePort, key: string): Promise<string> {
  let text = "";
  const decoder = new TextDecoder();
  for await (const chunk of storage.read(key)) text += decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
}

/** The project's draft, or null without one. A broken or outdated file starts over instead of failing. */
export function makeGetFullAiDraft(deps: { repo: ProjectRepository; storage: StoragePort }) {
  return async (projectId: string): Promise<FullAiDraft | null> => {
    await deps.repo.get(projectId);
    const key = fullAiDraftKey(projectId);
    if (!(await deps.storage.exists(key))) return null;
    try {
      const parsed = FullAiDraftSchema.safeParse(JSON.parse(await readText(deps.storage, key)));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  };
}

/** Saves the whole draft, stamped with the time it was saved. */
export function makeSaveFullAiDraft(deps: { repo: ProjectRepository; storage: StoragePort; clock: Clock }) {
  return async (input: { projectId: string; draft: FullAiDraft }): Promise<FullAiDraft> => {
    await deps.repo.get(input.projectId);
    const draft = FullAiDraftSchema.parse({ ...input.draft, updatedAt: deps.clock.now() });
    await deps.storage.write(
      fullAiDraftKey(input.projectId),
      bytes(new TextEncoder().encode(JSON.stringify(draft))),
    );
    return draft;
  };
}

/** Starts over; no-op without a draft. */
export function makeDeleteFullAiDraft(deps: { storage: StoragePort }) {
  return (projectId: string): Promise<void> => deps.storage.remove(fullAiDraftKey(projectId));
}
