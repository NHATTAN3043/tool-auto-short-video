import {
  ApiUsageEntrySchema,
  budgetExceededMessage,
  BudgetSettingsSchema,
  budgetWindows,
  checkBudget,
  DomainError,
  LibraryMediaSchema,
  LibrarySfxSchema,
  migrateProject,
  RenderJobSchema,
  sumUsageUsd,
  matchesUsageFilter,
  type AiTask,
  type ApiUsageEntry,
  type BudgetCheck,
  type BudgetLimits,
  type BudgetSettings,
  type PlannedSpend,
  type UsageFilter,
  type AiUsage,
  type LibraryMedia,
  type LibrarySfx,
  type MediaCandidate,
  type MediaRankingSuggestion,
  type MediaRankRequest,
  type SceneRewriteRequest,
  type SceneRewriteSuggestion,
  type StockProvider,
  type Project,
  type RenderJob,
  type ScenePlanRequest,
  type ScenePlanSuggestion,
  type ScriptRequest,
  type ScriptSuggestion,
  type VisualPlanRequest,
  type VisualPlansSuggestion,
  type VoiceSettings,
} from "@studio/domain";

import type { AiCall, AiCallError, AiEstimate, AiPort, RankImage } from "../ports/ai";
import type { ArchiveEntry, ArchivePort } from "../ports/archive";
import type { ClipCutterPort, ClipRange } from "../ports/clip-cutter";
import type { Clock } from "../ports/clock";
import type { ApiUsageLog, BudgetSettingsStore, CostGuardPort, GuardedRun } from "../ports/cost-guard";
import type { JobFilter, JobQueuePort, RenderJobPatch } from "../ports/job-queue";
import type { MediaLibraryRepository } from "../ports/media-library";
import type { MediaProbePort, ProbeResult, ThumbnailOptions } from "../ports/media-probe";
import type { MediaSearchPort, StockFile, StockSearch } from "../ports/media-search";
import type { RemoteFile, RemoteFilePort } from "../ports/remote-files";
import type { ProjectRepository, ProjectSummary } from "../ports/project-repository";
import type { RendererPort, RenderRequest } from "../ports/renderer";
import type { SfxLibraryRepository } from "../ports/sfx-library";
import type { StoragePort } from "../ports/storage";
import type { SynthesizedSpeech, TtsEstimate, TtsModel, TtsPort, TtsVoice } from "../ports/tts";
import { KeyedLock } from "../shared/keyed-lock";

// In-memory implementations of every port, for use-case tests. They follow the same contracts as the
// real adapters (validation, not-found errors, serialized updates) without touching disk or network.

export class FakeClock implements Clock {
  constructor(private current = "2026-01-01T00:00:00.000Z") {}

  now(): string {
    return this.current;
  }

  set(iso: string): void {
    this.current = iso;
  }
}

export class InMemoryProjectRepository implements ProjectRepository {
  private readonly projects = new Map<string, Project>();
  private readonly lock = new KeyedLock();

  get(id: string): Promise<Project> {
    const stored = this.projects.get(id);
    if (!stored) return Promise.reject(new DomainError("PROJECT_NOT_FOUND", `Project not found: ${id}`));
    return Promise.resolve(structuredClone(stored));
  }

  list(): Promise<ProjectSummary[]> {
    const summaries = [...this.projects.values()]
      .map(({ id, name, mode, scenes, updatedAt }) => ({
        id,
        name,
        mode,
        sceneCount: scenes.length,
        updatedAt,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return Promise.resolve(summaries);
  }

  save(project: Project): Promise<Project> {
    return this.lock.run(project.id, () => Promise.resolve(this.store(project)));
  }

  update(id: string, mutate: (project: Project) => Project): Promise<Project> {
    return this.lock.run(id, async () => {
      const current = await this.get(id);
      // Yield once so concurrent callers really interleave, like a disk read would.
      await Promise.resolve();
      const next = mutate(current);
      if (next.id !== id) throw new DomainError("INVALID_OPERATION", "A project id cannot change");
      return this.store(next);
    });
  }

  remove(id: string): Promise<void> {
    return this.lock.run(id, () => {
      if (!this.projects.delete(id)) {
        return Promise.reject(new DomainError("PROJECT_NOT_FOUND", `Project not found: ${id}`));
      }
      return Promise.resolve();
    });
  }

  private store(project: Project): Project {
    const validated = migrateProject(structuredClone(project));
    this.projects.set(validated.id, validated);
    return structuredClone(validated);
  }
}

/** Not a real hash: services never inspect it, they only store it. */
function fakeDigest(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

export class InMemoryStorage implements StoragePort {
  readonly files = new Map<string, Uint8Array>();

  async write(key: string, data: AsyncIterable<Uint8Array>): Promise<{ bytes: number; sha256: string }> {
    this.assertKey(key);
    const chunks: Uint8Array[] = [];
    for await (const chunk of data) chunks.push(chunk);
    const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    this.files.set(key, bytes);
    return { bytes: bytes.length, sha256: fakeDigest(bytes) };
  }

  resolvePath(key: string): string {
    this.assertKey(key);
    return `/memory/${key}`;
  }

  pathForWrite(key: string): Promise<string> {
    return Promise.resolve(this.resolvePath(key));
  }

  exists(key: string): Promise<boolean> {
    return Promise.resolve(this.files.has(key));
  }

  stat(key: string): Promise<{ size: number } | null> {
    this.assertKey(key);
    const file = this.files.get(key);
    return Promise.resolve(file ? { size: file.length } : null);
  }

  async *read(key: string, range?: { start: number; end: number }): AsyncIterable<Uint8Array> {
    this.assertKey(key);
    const file = this.files.get(key);
    if (!file) throw new Error(`ENOENT: ${key}`);
    await Promise.resolve();
    yield range ? file.slice(range.start, range.end + 1) : file.slice();
  }

  remove(key: string): Promise<void> {
    this.files.delete(key);
    return Promise.resolve();
  }

  removeFolder(key: string): Promise<void> {
    this.assertKey(key);
    for (const existing of [...this.files.keys()]) {
      if (existing.startsWith(`${key}/`)) this.files.delete(existing);
    }
    return Promise.resolve();
  }

  keyOf(absolutePath: string): string {
    return absolutePath.replace(/^\/memory\//u, "");
  }

  private assertKey(key: string): void {
    if (key.startsWith("/") || key.split("/").includes("..")) {
      throw new DomainError("INVALID_INPUT", `Invalid storage key: ${key}`);
    }
  }
}

/** Returns a preset result per file extension; can fail on demand. */
export class FakeMediaProbe implements MediaProbePort {
  readonly thumbnails: { input: string; output: string; options: ThumbnailOptions }[] = [];
  failProbe = false;
  failThumbnail = false;

  constructor(
    private readonly storage: InMemoryStorage,
    private readonly results: Record<string, ProbeResult> = {
      mp4: {
        kind: "video",
        durationMs: 12_000,
        width: 1920,
        height: 1080,
        fps: 30,
        hasAudio: true,
        codec: "h264",
      },
      png: { kind: "image", width: 800, height: 600, hasAudio: false, codec: "png" },
      jpg: { kind: "image", width: 1080, height: 1920, hasAudio: false, codec: "mjpeg" },
      mp3: { kind: "audio", durationMs: 5000, hasAudio: true, codec: "mp3" },
    },
  ) {}

  probe(absolutePath: string): Promise<ProbeResult> {
    const extension = absolutePath.split(".").at(-1) ?? "";
    const result = this.results[extension];
    if (this.failProbe || !result) return Promise.reject(new Error("unreadable"));
    return Promise.resolve(result);
  }

  async createThumbnail(input: string, output: string, options: ThumbnailOptions): Promise<void> {
    if (this.failThumbnail) throw new Error("thumbnail failed");
    this.thumbnails.push({ input, output, options });
    await this.storage.write(this.storage.keyOf(output), oneChunk(new Uint8Array([0xff, 0xd8])));
  }
}

export class InMemoryJobQueue implements JobQueuePort {
  private readonly jobs = new Map<string, RenderJob>();

  constructor(private readonly clock: Clock = new FakeClock()) {}

  enqueue(job: RenderJob): Promise<RenderJob> {
    const parsed = RenderJobSchema.parse(job);
    if (this.jobs.has(parsed.id)) {
      return Promise.reject(new DomainError("INVALID_OPERATION", `Job already exists: ${parsed.id}`));
    }
    this.jobs.set(parsed.id, parsed);
    return Promise.resolve(structuredClone(parsed));
  }

  get(id: string): Promise<RenderJob> {
    const job = this.jobs.get(id);
    if (!job) return Promise.reject(new DomainError("JOB_NOT_FOUND", `Job not found: ${id}`));
    return Promise.resolve(structuredClone(job));
  }

  list(filter: JobFilter = {}): Promise<RenderJob[]> {
    const jobs = [...this.jobs.values()]
      .filter((job) => filter.projectId === undefined || job.projectId === filter.projectId)
      .filter((job) => filter.status === undefined || job.status === filter.status)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return Promise.resolve(structuredClone(jobs));
  }

  async claimNext(): Promise<RenderJob | null> {
    const [next] = await this.list({ status: "QUEUED" });
    return next ? this.update(next.id, { status: "PROCESSING", startedAt: this.clock.now() }) : null;
  }

  async update(id: string, patch: RenderJobPatch): Promise<RenderJob> {
    const job = RenderJobSchema.parse({ ...(await this.get(id)), ...patch });
    this.jobs.set(id, job);
    return structuredClone(job);
  }

  removeForProject(projectId: string): Promise<void> {
    for (const [id, job] of this.jobs) if (job.projectId === projectId) this.jobs.delete(id);
    return Promise.resolve();
  }
}

export async function* oneChunk(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  await Promise.resolve();
  yield bytes;
}

/** Records requests and reports the given progress steps; can fail on demand. */
export class FakeRenderer implements RendererPort {
  readonly requests: RenderRequest[] = [];
  failWith: Error | null = null;

  constructor(private readonly progressSteps: number[] = [0.25, 0.5, 1]) {}

  render(request: RenderRequest): Promise<void> {
    this.requests.push(request);
    for (const step of this.progressSteps) request.onProgress?.(step);
    return this.failWith ? Promise.reject(this.failWith) : Promise.resolve();
  }
}

export class InMemorySfxLibrary implements SfxLibraryRepository {
  private readonly items = new Map<string, LibrarySfx>();

  list(): Promise<LibrarySfx[]> {
    const items = [...this.items.values()].reverse().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return Promise.resolve(structuredClone(items));
  }

  get(id: string): Promise<LibrarySfx> {
    const item = this.items.get(id);
    if (!item) return Promise.reject(new DomainError("SFX_NOT_FOUND", `Sound effect not found: ${id}`));
    return Promise.resolve(structuredClone(item));
  }

  add(item: LibrarySfx): Promise<LibrarySfx> {
    const parsed = LibrarySfxSchema.parse(item);
    this.items.set(parsed.id, parsed);
    return Promise.resolve(structuredClone(parsed));
  }

  async rename(id: string, name: string): Promise<LibrarySfx> {
    const parsed = LibrarySfxSchema.safeParse({ ...(await this.get(id)), name });
    if (!parsed.success) throw new DomainError("INVALID_INPUT", "Invalid sound effect name");
    this.items.set(id, parsed.data);
    return structuredClone(parsed.data);
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    this.items.delete(id);
  }
}

/** Records cuts; can fail on demand. */
export class FakeClipCutter implements ClipCutterPort {
  readonly cuts: { input: string; output: string; range: ClipRange }[] = [];
  failWith: Error | null = null;

  cut(input: string, output: string, range: ClipRange): Promise<void> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.cuts.push({ input, output, range });
    return Promise.resolve();
  }
}

/** Records the entries of each archive and writes a placeholder file where the ZIP would be. */
export class FakeArchive implements ArchivePort {
  readonly archives: { entries: ArchiveEntry[]; output: string }[] = [];

  constructor(private readonly storage: InMemoryStorage) {}

  async zip(entries: readonly ArchiveEntry[], output: string): Promise<void> {
    this.archives.push({ entries: [...entries], output });
    await this.storage.write(this.storage.keyOf(output), oneChunk(new Uint8Array([0x50, 0x4b])));
  }
}

/** Speaks "mp3" bytes derived from the text; records calls and can fail for chosen texts. */
export class FakeTts implements TtsPort {
  readonly id = "fake";
  readonly models: readonly TtsModel[] = [{ id: "m1", name: "Model 1", creditsPerCharacter: 0.5 }];
  readonly calls: { text: string; voice: VoiceSettings }[] = [];
  voices: TtsVoice[] = [{ id: "v1", name: "Giọng 1", labels: { gender: "female" } }];
  failFor = new Set<string>();
  failList = false;

  listVoices(): Promise<TtsVoice[]> {
    return this.failList ? Promise.reject(new Error("401 invalid key")) : Promise.resolve(this.voices);
  }

  estimate(text: string): TtsEstimate {
    const credits = text.length * 0.5;
    return { characters: text.length, credits, usd: credits * 0.0006 };
  }

  synthesize(text: string, voice: VoiceSettings): Promise<SynthesizedSpeech> {
    this.calls.push({ text, voice });
    if (this.failFor.has(text)) return Promise.reject(new Error(`provider failed for ${text}`));
    return Promise.resolve({ audio: new TextEncoder().encode(`voice:${text}`), extension: "mp3" });
  }
}

/** Answers from canned suggestions, records calls and can fail with a chosen AiCallError. */
export class FakeAi implements AiPort {
  readonly id = "fake-ai";
  readonly model = "fake-model";
  readonly calls: AiTask[] = [];
  usage: AiUsage = { inputTokens: 1000, outputTokens: 500, usd: 0.007 };
  estimateResult: AiEstimate = {
    inputTokens: 1000,
    expectedOutputTokens: 500,
    maxOutputTokens: 4000,
    expectedUsd: 0.007,
    maxUsd: 0.042,
  };
  failWith: AiCallError | null = null;
  /** Images received by each rankMedia call. */
  readonly rankImages: ReadonlyMap<string, RankImage>[] = [];
  script: ScriptSuggestion = { title: "Mèo", script: "Câu một.\n\nCâu hai." };
  scenes: ScenePlanSuggestion = {
    scenes: [
      {
        narration: "Câu một.",
        visualPlan: { intent: "Mèo", preferredMedia: "video", searchQueries: ["cat"] },
      },
      {
        narration: "Câu hai.",
        visualPlan: { intent: "Chó", preferredMedia: "image", searchQueries: ["dog"] },
      },
    ],
  };

  estimate(): Promise<AiEstimate> {
    return Promise.resolve(this.estimateResult);
  }

  private answer<T>(task: AiTask, data: T): Promise<AiCall<T>> {
    this.calls.push(task);
    if (this.failWith) return Promise.reject(this.failWith);
    return Promise.resolve({ data, usage: this.usage });
  }

  generateScript(input: ScriptRequest): Promise<AiCall<ScriptSuggestion>> {
    return this.answer({ type: "script", input }, this.script);
  }

  planScenes(input: ScenePlanRequest): Promise<AiCall<ScenePlanSuggestion>> {
    return this.answer({ type: "scenes", input }, this.scenes);
  }

  /** Ranks each scene's candidates in reverse order, so tests can tell a ranked list from the original. */
  rankMedia(
    input: MediaRankRequest,
    images: ReadonlyMap<string, RankImage>,
  ): Promise<AiCall<MediaRankingSuggestion>> {
    this.rankImages.push(images);
    return this.answer(
      { type: "rank_media", input },
      {
        scenes: input.scenes.map((scene) => ({
          sceneId: scene.sceneId,
          keys: scene.candidates.map((candidate) => candidate.key).reverse(),
        })),
      },
    );
  }

  rewriteScene(input: SceneRewriteRequest): Promise<AiCall<SceneRewriteSuggestion>> {
    return this.answer({ type: "rewrite_scene", input }, { narration: `${input.narration} (viết lại)` });
  }

  generateVisualPlans(input: VisualPlanRequest): Promise<AiCall<VisualPlansSuggestion>> {
    return this.answer(
      { type: "visual", input },
      {
        plans: input.scenes.map((scene) => ({
          sceneId: scene.id,
          visualPlan: {
            intent: scene.narration,
            preferredMedia: "video" as const,
            searchQueries: ["b-roll"],
          },
        })),
      },
    );
  }
}

export class InMemoryMediaLibrary implements MediaLibraryRepository {
  readonly items = new Map<string, LibraryMedia>();

  private find(id: string): LibraryMedia {
    const item = this.items.get(id);
    if (!item) throw new DomainError("LIBRARY_MEDIA_NOT_FOUND", `Library media not found: ${id}`);
    return item;
  }

  list(): Promise<LibraryMedia[]> {
    return Promise.resolve([...this.items.values()].reverse());
  }

  get(id: string): Promise<LibraryMedia> {
    try {
      return Promise.resolve(structuredClone(this.find(id)));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  findBySourceRef(sourceRef: string): Promise<LibraryMedia | null> {
    return Promise.resolve([...this.items.values()].find((item) => item.sourceRef === sourceRef) ?? null);
  }

  add(item: LibraryMedia): Promise<LibraryMedia> {
    const parsed = LibraryMediaSchema.parse(item);
    if (this.items.has(parsed.id) || [...this.items.values()].some((i) => i.sourceRef === parsed.sourceRef)) {
      return Promise.reject(
        new DomainError("INVALID_OPERATION", `Library media exists: ${parsed.sourceRef}`),
      );
    }
    this.items.set(parsed.id, parsed);
    return Promise.resolve(parsed);
  }

  private change(id: string, patch: Partial<LibraryMedia>): Promise<LibraryMedia> {
    try {
      const next = LibraryMediaSchema.parse({ ...this.find(id), ...patch });
      this.items.set(id, next);
      return Promise.resolve(next);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  setTags(id: string, tags: readonly string[]): Promise<LibraryMedia> {
    return this.change(id, { tags: [...tags] });
  }

  incrementUsage(id: string): Promise<LibraryMedia> {
    return this.items.has(id) ? this.change(id, { usageCount: this.find(id).usageCount + 1 }) : this.get(id);
  }

  remove(id: string): Promise<void> {
    if (!this.items.delete(id)) {
      return Promise.reject(new DomainError("LIBRARY_MEDIA_NOT_FOUND", `Library media not found: ${id}`));
    }
    return Promise.resolve();
  }
}

/** A stock provider with canned results; `files` maps a ref to the URL its download resolves to. */
export class FakeMediaSearch implements MediaSearchPort {
  readonly searches: StockSearch[] = [];
  readonly resolved: string[] = [];
  results: MediaCandidate[] = [];
  fail = false;

  constructor(readonly id: StockProvider) {}

  search(query: StockSearch): Promise<MediaCandidate[]> {
    this.searches.push(query);
    if (this.fail) return Promise.reject(new Error(`${this.id} is down`));
    return Promise.resolve(this.results.filter((candidate) => candidate.kind === query.kind));
  }

  resolve(kind: "video" | "image", ref: string): Promise<StockFile> {
    this.resolved.push(ref);
    const extension = kind === "video" ? "mp4" : "jpg";
    return Promise.resolve({ url: `https://cdn.${this.id}.test/${ref}.${extension}`, extension });
  }

  isProxyUrl(url: URL): boolean {
    return url.hostname === `cdn.${this.id}.test`;
  }
}

/** Serves bytes per URL; unknown URLs fail like a 404. */
export class FakeRemoteFiles implements RemoteFilePort {
  readonly opened: { url: string; range: string | null }[] = [];
  readonly files = new Map<string, Uint8Array>();

  open(url: string, options: { range?: string | null } = {}): Promise<RemoteFile> {
    this.opened.push({ url, range: options.range ?? null });
    const data = this.files.get(url) ?? (url.includes("missing") ? undefined : new TextEncoder().encode(url));
    if (!data) return Promise.reject(new Error("404"));
    return Promise.resolve({
      status: 200,
      contentType: url.endsWith(".mp4") ? "video/mp4" : "image/jpeg",
      contentLength: data.length,
      body: oneChunk(data),
    });
  }
}

export class InMemoryApiUsageLog implements ApiUsageLog {
  readonly entries: ApiUsageEntry[] = [];

  append(entry: ApiUsageEntry): Promise<void> {
    this.entries.push(ApiUsageEntrySchema.parse(entry));
    return Promise.resolve();
  }

  totalUsd(filter: UsageFilter = {}): Promise<number> {
    return Promise.resolve(sumUsageUsd(this.entries, filter));
  }

  list(filter: UsageFilter = {}): Promise<ApiUsageEntry[]> {
    return Promise.resolve(
      structuredClone(this.entries.filter((entry) => matchesUsageFilter(entry, filter))),
    );
  }
}

export class InMemoryBudgetSettings implements BudgetSettingsStore {
  settings: BudgetSettings | null = null;

  get(): Promise<BudgetSettings | null> {
    return Promise.resolve(this.settings && structuredClone(this.settings));
  }

  save(settings: BudgetSettings): Promise<BudgetSettings> {
    this.settings = BudgetSettingsSchema.parse(settings);
    return Promise.resolve(structuredClone(this.settings));
  }
}

export const NO_BUDGET_LIMITS: BudgetLimits = {
  perCallUsd: null,
  perDayUsd: null,
  perMonthUsd: null,
  perProjectUsd: null,
};

/** Same contract as the cost-guard adapter, kept simple: `limits` is set directly by the test. */
export class FakeCostGuard implements CostGuardPort {
  limits: BudgetLimits = NO_BUDGET_LIMITS;
  private ids = 0;

  constructor(
    readonly log: InMemoryApiUsageLog = new InMemoryApiUsageLog(),
    private readonly clock: Clock = new FakeClock(),
  ) {}

  async check(planned: PlannedSpend & { projectId?: string }): Promise<BudgetCheck> {
    const { daySince, monthSince } = budgetWindows(this.clock.now());
    const spent = {
      dayUsd: await this.log.totalUsd({ since: daySince }),
      monthUsd: await this.log.totalUsd({ since: monthSince }),
      projectUsd:
        planned.projectId === undefined ? null : await this.log.totalUsd({ projectId: planned.projectId }),
    };
    return checkBudget(this.limits, spent, { totalUsd: planned.totalUsd, maxCallUsd: planned.maxCallUsd });
  }

  async guard<T>({ call, run, onResult, onError }: GuardedRun<T>): Promise<T> {
    const base = {
      id: `use_${String(++this.ids)}`,
      service: call.service,
      provider: call.provider,
      operation: call.operation,
      estimatedUsd: call.maxUsd,
      createdAt: this.clock.now(),
      ...(call.model !== undefined && { model: call.model }),
      ...(call.projectId !== undefined && { projectId: call.projectId }),
      ...(call.jobId !== undefined && { jobId: call.jobId }),
    };
    const check = await this.check({
      ...(call.projectId !== undefined && { projectId: call.projectId }),
      totalUsd: call.maxUsd,
      maxCallUsd: call.maxUsd,
    });
    const blocked = budgetExceededMessage(check);
    if (blocked !== null) {
      await this.log.append({ ...base, status: "blocked", usd: 0, message: blocked });
      throw new DomainError("BUDGET_EXCEEDED", blocked);
    }
    try {
      const result = await run();
      await this.log.append({ ...base, ...onResult(result) });
      return result;
    } catch (error) {
      await this.log.append({ ...base, ...onError(error) });
      throw error;
    }
  }
}
