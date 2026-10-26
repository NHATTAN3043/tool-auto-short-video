import {
  budgetExceededMessage,
  DomainError,
  expectedShotCount,
  maxShotCount,
  MAX_CLIPS_PER_JOB,
  newId,
  type BudgetCheck,
  type IdGenerator,
  type LibraryMedia,
  type RenderJob,
} from "@studio/domain";

import type { AiPort, AiResolver } from "../ports/ai";
import type { Clock } from "../ports/clock";
import type { CostGuardPort } from "../ports/cost-guard";
import type { JobQueuePort } from "../ports/job-queue";
import type { MediaLibraryRepository } from "../ports/media-library";
import type { ProjectRepository } from "../ports/project-repository";
import { KeyedLock } from "../shared/keyed-lock";

const ACTIVE = new Set<RenderJob["status"]>(["QUEUED", "PROCESSING"]);

export interface ClipAnalysisInput {
  /** The project the job runs for: its budget pays, and its job list shows the progress. */
  projectId: string;
  libraryIds: readonly string[];
  /** Analyze again videos that already have shots. */
  reanalyze?: boolean;
}

export type ClipSkipReason = "not_found" | "not_video" | "analyzed" | "no_duration";

export interface ClipAnalysisEstimate {
  clips: { id: string; fileName: string; durationMs: number; expectedShots: number }[];
  skipped: { id: string; reason: ClipSkipReason }[];
  expectedUsd: number;
  /** Every clip at the most shots it can have: reserved against the budgets while the job runs. */
  maxUsd: number;
  model: string;
  budget: BudgetCheck;
}

export interface ClipAnalysisDeps {
  repo: ProjectRepository;
  library: MediaLibraryRepository;
  ai: AiPort;
  resolveAi?: AiResolver;
  costGuard: CostGuardPort;
}

function skipReason(item: LibraryMedia | null, reanalyze: boolean): ClipSkipReason | null {
  if (!item) return "not_found";
  if (item.kind !== "video") return "not_video";
  if (item.durationMs === undefined || item.durationMs <= 0) return "no_duration";
  if (item.analysis && !reanalyze) return "analyzed";
  return null;
}

/**
 * What analyzing these library videos would cost and whether the budgets allow it (ADR 0019). Makes no paid
 * call: the shots are only known once ffmpeg cuts the clip, so the cost is worked out from each length.
 */
export function makeEstimateClipAnalysis(deps: ClipAnalysisDeps) {
  return async (input: ClipAnalysisInput): Promise<ClipAnalysisEstimate> => {
    const project = await deps.repo.get(input.projectId);
    const ai = deps.resolveAi?.(project.ai) ?? deps.ai;
    const ids = [...new Set(input.libraryIds)];
    if (ids.length > MAX_CLIPS_PER_JOB) {
      throw new DomainError("INVALID_INPUT", `Mỗi lần phân tích tối đa ${String(MAX_CLIPS_PER_JOB)} video`);
    }
    const clips: ClipAnalysisEstimate["clips"] = [];
    const skipped: ClipAnalysisEstimate["skipped"] = [];
    let expectedUsd = 0;
    let maxUsd = 0;
    let maxCallUsd = 0;
    for (const id of ids) {
      const item = await deps.library.get(id).catch(() => null);
      const reason = skipReason(item, input.reanalyze === true);
      if (reason !== null || !item?.durationMs) {
        skipped.push({ id, reason: reason ?? "no_duration" });
        continue;
      }
      const expectedShots = expectedShotCount(item.durationMs);
      const worst = ai.estimateShots(maxShotCount(item.durationMs)).maxUsd;
      clips.push({ id, fileName: item.fileName, durationMs: item.durationMs, expectedShots });
      expectedUsd += ai.estimateShots(expectedShots).expectedUsd;
      maxUsd += worst;
      maxCallUsd = Math.max(maxCallUsd, worst);
    }
    const budget = await deps.costGuard.check({ projectId: input.projectId, totalUsd: maxUsd, maxCallUsd });
    return { clips, skipped, expectedUsd, maxUsd, model: ai.model, budget };
  };
}

/**
 * Queues the analysis of library videos for the worker, after checking the budgets so the user is told at
 * once; the worker's CostGuard checks each clip again right before its paid call. Videos already analyzed
 * are left out unless `reanalyze`. An active job that covers the same videos is returned instead.
 */
export function makeRequestClipAnalysis(
  deps: ClipAnalysisDeps & { queue: JobQueuePort; clock: Clock; newId?: IdGenerator },
) {
  const estimate = makeEstimateClipAnalysis(deps);
  const lock = new KeyedLock();
  return (input: ClipAnalysisInput): Promise<RenderJob> =>
    lock.run(input.projectId, async () => {
      const cost = await estimate(input);
      const project = await deps.repo.get(input.projectId);
      const selectedAi = deps.resolveAi?.(project.ai) ?? deps.ai;
      const config = project.ai ?? {
        provider: selectedAi.id === "openai" ? ("openai" as const) : ("claude" as const),
        model: selectedAi.model,
      };
      const libraryIds = cost.clips.map((clip) => clip.id);
      if (libraryIds.length === 0) {
        throw new DomainError("INVALID_OPERATION", "Không có video nào cần phân tích");
      }
      const jobs = await deps.queue.list({ projectId: input.projectId });
      const covering = jobs.find(
        (job) =>
          job.kind === "clip" &&
          ACTIVE.has(job.status) &&
          libraryIds.every((id) => job.clip?.libraryIds.includes(id) === true),
      );
      if (covering) return covering;
      const blocked = budgetExceededMessage(cost.budget);
      if (blocked !== null) throw new DomainError("BUDGET_EXCEEDED", blocked);
      return deps.queue.enqueue({
        id: (deps.newId ?? newId)("job"),
        projectId: input.projectId,
        kind: "clip",
        clip: {
          libraryIds,
          config,
          ...(input.reanalyze === true && { reanalyze: true }),
          maxUsd: cost.maxUsd,
        },
        status: "QUEUED",
        progress: 0,
        createdAt: deps.clock.now(),
      });
    });
}
