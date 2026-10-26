import "server-only";

import { DomainError } from "@studio/domain";

import {
  budgetDefaults,
  findRepoRoot,
  loadRepoEnv,
  resolveSkillsDir,
  resolveStorageDir,
  type Env,
} from "@studio/config";
import { BudgetCostGuard, GuardedTts } from "@studio/adapters/cost-guard";
import { FfmpegMediaProbe } from "@studio/adapters/ffmpeg";
import { ClaudeAi } from "@studio/adapters/ai-claude";
import { OpenAi } from "@studio/adapters/ai-openai";
import { ElevenLabsTts } from "@studio/adapters/tts-elevenlabs";
import { PexelsSearch } from "@studio/adapters/media-pexels";
import { PixabaySearch } from "@studio/adapters/media-pixabay";
import {
  createPgDatabase,
  PgApiUsageLog,
  PgBudgetSettings,
  PgJobQueue,
  PgMediaLibrary,
  PgProjectRepository,
  PgSfxLibrary,
} from "@studio/adapters/postgres";
import { FileJobQueue } from "@studio/adapters/queue-file";
import { FetchRemoteFiles } from "@studio/adapters/remote-http";
import {
  JsonApiUsageLog,
  JsonBudgetSettings,
  JsonMediaLibrary,
  JsonProjectRepository,
  JsonSfxLibrary,
} from "@studio/adapters/repository-json";
import { LocalSkillCatalog } from "@studio/adapters/skills-local";
import { LocalStorage } from "@studio/adapters/storage-local";
import {
  makeCreateProject,
  makeEstimateAiTask,
  makeDeleteFullAiDraft,
  makeEstimateFullAi,
  makeGetFullAiDraft,
  makeGetFullAiResult,
  makeGetLatestFullAi,
  makeRequestFullAi,
  makeSaveFullAiDraft,
  makeGetAiResult,
  makeGetBudgetSettings,
  makeGetUsageReport,
  makeSaveBudgetSettings,
  makeDeleteProject,
  makeEstimateSceneVoices,
  makeGetProject,
  makeGetRenderJob,
  makeAddUploadToLibrary,
  makeEstimateClipAnalysis,
  makeRequestClipAnalysis,
  makeImportAsset,
  makeImportCandidate,
  makeListLibraryMedia,
  makeProxyStockMedia,
  makeReadLibraryMediaFile,
  makeRemoveLibraryMedia,
  makeSearchMedia,
  makeSetLibraryMediaTags,
  makeImportLibrarySfx,
  makeListLibrarySfx,
  makeListProjects,
  makeListRenderJobs,
  makeListSkills,
  makeListTtsVoices,
  makeGetVoiceSample,
  makePreviewVoice,
  makeReadLibrarySfxFile,
  makeReadProjectFile,
  makeRemoveLibrarySfx,
  makeRenameLibrarySfx,
  makeRequestAiTask,
  makeRequestRender,
  makeRequestSceneVoices,
  makeRequestVoiceLoudness,
  makeSaveProject,
  makeUseLibrarySfxInProject,
  systemClock,
  type ApiUsageLog,
  type BudgetSettingsStore,
  type Clock,
  type JobQueuePort,
  type MediaProbePort,
  type ProjectRepository,
  type SfxLibraryRepository,
  type AiPort,
  type AiResolver,
  type MediaLibraryRepository,
  type MediaSearchPort,
  type RemoteFilePort,
  type SkillCatalogPort,
  type TtsPort,
} from "@studio/services";

export interface ContainerOverrides {
  clock?: Clock;
  /** Tests only: replaces ffprobe/ffmpeg so uploads can be exercised without the binaries. */
  probe?: MediaProbePort;
  /** Tests only: a fake provider; `null` forces "no TTS configured". Default: from ELEVENLABS_API_KEY. */
  tts?: TtsPort | null;
  /** Tests only: a fake AI provider; `null` forces "no AI configured". Default: from ANTHROPIC_API_KEY. */
  ai?: AiPort | null;
  /** Tests only: fake stock providers and downloads instead of Pexels/Pixabay and the network. */
  stockProviders?: readonly MediaSearchPort[];
  remote?: RemoteFilePort;
  /** Tests only: fake skills instead of the STUDIO_SKILLS_DIR folder. */
  skills?: SkillCatalogPort;
}

function createStockProviders(env: Env): MediaSearchPort[] {
  const providers: MediaSearchPort[] = [];
  if (env.PEXELS_API_KEY !== undefined) providers.push(new PexelsSearch({ apiKey: env.PEXELS_API_KEY }));
  if (env.PIXABAY_API_KEY !== undefined) providers.push(new PixabaySearch({ apiKey: env.PIXABAY_API_KEY }));
  return providers;
}

function createAi(env: Env): AiPort | null {
  if (env.ANTHROPIC_API_KEY !== undefined)
    return new ClaudeAi({ apiKey: env.ANTHROPIC_API_KEY, model: env.AI_MODEL });
  if (env.OPENAI_API_KEY !== undefined)
    return new OpenAi({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_AI_MODEL });
  return null;
}

function createAiResolver(env: Env): AiResolver {
  return (config) => {
    const provider = config?.provider ?? "claude";
    const model = config?.model ?? env.AI_MODEL;
    if (provider === "claude" && env.ANTHROPIC_API_KEY !== undefined) {
      return new ClaudeAi({ apiKey: env.ANTHROPIC_API_KEY, model });
    }
    if (provider === "openai" && env.OPENAI_API_KEY !== undefined) {
      return new OpenAi({ apiKey: env.OPENAI_API_KEY, model });
    }
    throw new DomainError("AI_UNAVAILABLE", `Missing API key for ${provider}`);
  };
}

function createTts(env: Env): TtsPort | null {
  if (env.ELEVENLABS_API_KEY === undefined) return null;
  return new ElevenLabsTts({ apiKey: env.ELEVENLABS_API_KEY, usdPerCredit: env.ELEVENLABS_USD_PER_CREDIT });
}

interface Persistence {
  repo: ProjectRepository;
  library: SfxLibraryRepository;
  mediaLibrary: MediaLibraryRepository;
  queue: JobQueuePort;
  usage: ApiUsageLog;
  budget: BudgetSettingsStore;
  /** Releases the database connections. */
  close: () => Promise<void>;
}

/** Postgres when DATABASE_URL is set (ADR 0005), otherwise the JSON files of ADR 0001. */
function createPersistence(env: Env, storageDir: string, clock: Clock): Persistence {
  if (env.DATABASE_URL !== undefined) {
    const { db, close } = createPgDatabase(env.DATABASE_URL);
    return {
      repo: new PgProjectRepository(db),
      library: new PgSfxLibrary(db),
      mediaLibrary: new PgMediaLibrary(db),
      queue: new PgJobQueue(db, clock),
      usage: new PgApiUsageLog(db),
      budget: new PgBudgetSettings(db),
      close,
    };
  }
  return {
    repo: new JsonProjectRepository(storageDir),
    library: new JsonSfxLibrary(storageDir),
    mediaLibrary: new JsonMediaLibrary(storageDir),
    queue: new FileJobQueue(storageDir, clock),
    usage: new JsonApiUsageLog(storageDir),
    budget: new JsonBudgetSettings(storageDir),
    close: () => Promise.resolve(),
  };
}

// Composition root for the web app: the only place adapters are created. Imports adapters by subpath so
// the Remotion renderer (webpack, Chrome) never ends up in the Next.js server bundle.
export function createContainer(env: Env, overrides: ContainerOverrides = {}) {
  const clock = overrides.clock ?? systemClock;
  const repoRoot = findRepoRoot();
  const storageDir = resolveStorageDir(env, repoRoot);
  const skills = overrides.skills ?? new LocalSkillCatalog(resolveSkillsDir(env, repoRoot));
  // The web app only enqueues and reads jobs; the worker claims and renders them.
  const { repo, library, mediaLibrary, queue, usage, budget, close } = createPersistence(
    env,
    storageDir,
    clock,
  );
  // The web app checks budgets before queuing and shows spend (ADR 0009); its only paid call is the short
  // voice preview, guarded like the worker's calls (ADR 0014).
  const defaults = budgetDefaults(env);
  const costGuard = new BudgetCostGuard({ log: usage, settings: budget, defaults, clock });
  const storage = new LocalStorage(storageDir);
  const probe =
    overrides.probe ??
    new FfmpegMediaProbe({ ffmpegPath: env.STUDIO_FFMPEG_PATH, ffprobePath: env.STUDIO_FFPROBE_PATH });
  const maxUploadBytes = env.STUDIO_MAX_UPLOAD_MB * 1024 * 1024;
  // Without a key every voice service is null and the UI hides voice generation (Manual needs no key).
  const tts = overrides.tts === undefined ? createTts(env) : overrides.tts;
  const ai = overrides.ai === undefined ? createAi(env) : overrides.ai;
  const resolveAi = overrides.ai === undefined ? createAiResolver(env) : undefined;
  // Without keys the list is empty: only the shared library is searched.
  const providers = overrides.stockProviders ?? createStockProviders(env);
  const remote = overrides.remote ?? new FetchRemoteFiles();
  const aiDeps = ai ? { repo, ai, ...(resolveAi && { resolveAi }), queue, clock, costGuard, skills } : null;
  const voiceDefaults = tts
    ? {
        provider: tts.id,
        modelId: env.ELEVENLABS_DEFAULT_MODEL_ID,
        ...(env.ELEVENLABS_DEFAULT_VOICE_ID !== undefined && { voiceId: env.ELEVENLABS_DEFAULT_VOICE_ID }),
      }
    : null;
  const fullAiDeps = ai
    ? {
        repo,
        ai,
        ...(resolveAi && { resolveAi }),
        tts,
        voiceDefaults,
        costGuard,
        queue,
        clock,
        skills,
        library: mediaLibrary,
      }
    : null;
  return {
    /** Releases the database connections of a container that is replaced. */
    close,
    maxUploadBytes,
    /** Preselected when a project has no voice settings yet. */
    voiceDefaults,
    listTtsVoices: tts ? makeListTtsVoices({ tts }) : null,
    getVoiceSample: tts ? makeGetVoiceSample({ tts }) : null,
    previewVoice: tts
      ? makePreviewVoice({ repo, storage, tts: (context) => new GuardedTts(tts, costGuard, context) })
      : null,
    estimateSceneVoices: tts ? makeEstimateSceneVoices({ repo, tts, costGuard }) : null,
    requestSceneVoices: tts ? makeRequestSceneVoices({ repo, queue, tts, costGuard, clock }) : null,
    /** Free loudness balancing of existing AI voices; the worker runs it with ffmpeg, no TTS key needed. */
    requestVoiceLoudness: makeRequestVoiceLoudness({ repo, queue, clock }),
    // AI runs in the worker; the server only estimates (free token count), queues and reads results.
    estimateAiTask: aiDeps ? makeEstimateAiTask(aiDeps) : null,
    requestAiTask: aiDeps ? makeRequestAiTask(aiDeps) : null,
    /** Clip analysis (ADR 0019); null without an AI key, so the UI hides it. */
    estimateClipAnalysis: ai
      ? makeEstimateClipAnalysis({
          repo,
          library: mediaLibrary,
          ai,
          ...(resolveAi && { resolveAi }),
          costGuard,
        })
      : null,
    requestClipAnalysis: ai
      ? makeRequestClipAnalysis({
          repo,
          library: mediaLibrary,
          ai,
          ...(resolveAi && { resolveAi }),
          costGuard,
          queue,
          clock,
        })
      : null,
    getAiResult: ai ? makeGetAiResult({ queue, storage }) : null,
    // Full AI runs in the worker too (ADR 0010); the server estimates, queues and reads the result.
    estimateFullAi: fullAiDeps ? makeEstimateFullAi(fullAiDeps) : null,
    requestFullAi: fullAiDeps ? makeRequestFullAi(fullAiDeps) : null,
    getFullAiResult: makeGetFullAiResult({ queue, storage }),
    /** Skills for the Full AI and rewrite pickers; empty without AI, since nothing would use them. */
    listSkills: ai ? makeListSkills({ skills }) : () => Promise.resolve([]),
    getLatestFullAi: makeGetLatestFullAi({ queue, storage }),
    /** The Full AI draft (ADR 0015) is free to read and save, so it works without a key too. */
    getFullAiDraft: makeGetFullAiDraft({ repo, storage }),
    saveFullAiDraft: makeSaveFullAiDraft({ repo, storage, clock }),
    deleteFullAiDraft: makeDeleteFullAiDraft({ storage }),
    getBudgetSettings: makeGetBudgetSettings({ store: budget, defaults }),
    saveBudgetSettings: makeSaveBudgetSettings({ store: budget, clock }),
    getUsageReport: makeGetUsageReport({ log: usage, repo, clock }),
    createProject: makeCreateProject({ repo, clock }),
    getProject: makeGetProject({ repo }),
    listProjects: makeListProjects({ repo }),
    saveProject: makeSaveProject({ repo, clock }),
    deleteProject: makeDeleteProject({ repo, queue, storage }),
    importAsset: makeImportAsset({
      repo,
      storage,
      probe,
      clock,
      maxBytes: maxUploadBytes,
      addToLibrary: makeAddUploadToLibrary({ library: mediaLibrary, storage, clock }),
    }),
    readProjectFile: makeReadProjectFile({ repo, storage }),
    requestRender: makeRequestRender({ repo, queue, clock }),
    listRenderJobs: makeListRenderJobs({ repo, queue }),
    getRenderJob: makeGetRenderJob({ queue }),
    listLibrarySfx: makeListLibrarySfx({ library }),
    importLibrarySfx: makeImportLibrarySfx({ library, storage, probe, clock, maxBytes: maxUploadBytes }),
    renameLibrarySfx: makeRenameLibrarySfx({ library }),
    removeLibrarySfx: makeRemoveLibrarySfx({ library, storage }),
    readLibrarySfxFile: makeReadLibrarySfxFile({ library, storage }),
    useLibrarySfxInProject: makeUseLibrarySfxInProject({ library, repo, storage, clock }),
    searchMedia: makeSearchMedia({ repo, library: mediaLibrary, providers }),
    importMediaCandidate: makeImportCandidate({
      repo,
      library: mediaLibrary,
      providers,
      storage,
      probe,
      remote,
      clock,
      maxBytes: maxUploadBytes,
    }),
    proxyStockMedia: makeProxyStockMedia({ providers, remote }),
    listLibraryMedia: makeListLibraryMedia({ library: mediaLibrary }),
    setLibraryMediaTags: makeSetLibraryMediaTags({ library: mediaLibrary }),
    removeLibraryMedia: makeRemoveLibraryMedia({ library: mediaLibrary, storage }),
    readLibraryMediaFile: makeReadLibraryMediaFile({ library: mediaLibrary, storage }),
  };
}

export type WebContainer = ReturnType<typeof createContainer>;

// Kept on globalThis so dev hot reloads reuse one container (one repository lock per project, one Postgres pool).
// A reload of this module (container.ts or a service it wires changed) brings a new `createContainer`: the old
// container then lacks the new services, so it is closed and rebuilt instead of reused.
const holder = globalThis as typeof globalThis & {
  __studioContainer?: { container: WebContainer; factory: typeof createContainer };
};

function replace(next: WebContainer | undefined): void {
  const previous = holder.__studioContainer?.container;
  if (previous && previous !== next) {
    previous.close().catch((error: unknown) => {
      console.error(error);
    });
  }
  if (next) holder.__studioContainer = { container: next, factory: createContainer };
  else delete holder.__studioContainer;
}

export function getContainer(): WebContainer {
  const cached = holder.__studioContainer;
  if (cached?.factory === createContainer) return cached.container;
  const container = createContainer(loadRepoEnv());
  replace(container);
  return container;
}

/** Tests only: forget the cached container so the next call re-reads the environment. */
export function resetContainer(overrides?: ContainerOverrides): void {
  replace(overrides ? createContainer(loadRepoEnv(), overrides) : undefined);
}
