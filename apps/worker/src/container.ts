import { createRequire } from "node:module";
import path from "node:path";

import {
  BudgetCostGuard,
  ClaudeAi,
  createPgDatabase,
  ElevenLabsTts,
  FfmpegAudioNormalizer,
  FfmpegClipCutter,
  FetchRemoteFiles,
  FfmpegMediaProbe,
  FileJobQueue,
  GuardedAi,
  GuardedTts,
  JsonApiUsageLog,
  JsonBudgetSettings,
  JsonMediaLibrary,
  JsonProjectRepository,
  LocalStorage,
  PgApiUsageLog,
  PgBudgetSettings,
  PgJobQueue,
  PgMediaLibrary,
  PgProjectRepository,
  PexelsSearch,
  PixabaySearch,
  RemotionRenderer,
  ZipArchive,
} from "@studio/adapters";
import { budgetDefaults, findRepoRoot, loadRepoEnv, resolveStorageDir, type Env } from "@studio/config";
import {
  makeExportCapcut,
  makeFailStaleJobs,
  makeGenerateSceneVoices,
  makeNormalizeSceneVoices,
  makeImportCandidate,
  makeResolveRankImages,
  makeRunFullAi,
  makeSearchMedia,
  makeRunAiTask,
  makeRenderProject,
  makeRunNextRenderJob,
  systemClock,
  type ApiUsageLog,
  type BudgetSettingsStore,
  type Clock,
  type JobQueuePort,
  type MediaLibraryRepository,
  type PaidCallContext,
  type MediaSearchPort,
  type ProjectRepository,
} from "@studio/services";
import { COMPOSITION_ID } from "@studio/video/meta";

export const REPO_ROOT = findRepoRoot(import.meta.dirname);

function videoPackagePaths() {
  const videoDir = path.dirname(createRequire(import.meta.url).resolve("@studio/video/package.json"));
  return { entryPoint: path.join(videoDir, "src", "entry.ts"), publicDir: path.join(videoDir, "public") };
}

interface Persistence {
  repo: ProjectRepository;
  queue: JobQueuePort;
  usage: ApiUsageLog;
  budget: BudgetSettingsStore;
  mediaLibrary: MediaLibraryRepository;
  /** Human-readable source of the data, for logs. */
  source: string;
  close: () => Promise<void>;
}

/** Postgres when DATABASE_URL is set (ADR 0005), otherwise the JSON files of ADR 0001. */
function createPersistence(env: Env, storageDir: string, clock: Clock): Persistence {
  if (env.DATABASE_URL !== undefined) {
    const { db, close } = createPgDatabase(env.DATABASE_URL);
    return {
      repo: new PgProjectRepository(db),
      queue: new PgJobQueue(db, clock),
      usage: new PgApiUsageLog(db),
      budget: new PgBudgetSettings(db),
      mediaLibrary: new PgMediaLibrary(db),
      source: "postgres",
      close,
    };
  }
  return {
    repo: new JsonProjectRepository(storageDir),
    queue: new FileJobQueue(storageDir, clock),
    usage: new JsonApiUsageLog(storageDir),
    budget: new JsonBudgetSettings(storageDir),
    mediaLibrary: new JsonMediaLibrary(storageDir),
    source: `${storageDir}/jobs`,
    close: () => Promise.resolve(),
  };
}

/** Composition root for the worker: the only place adapters are created and wired into services. */
export function createContainer(env: Env = loadRepoEnv(REPO_ROOT), clock: Clock = systemClock) {
  const storageDir = resolveStorageDir(env, REPO_ROOT);
  const { repo, queue, usage, budget, mediaLibrary, source, close } = createPersistence(
    env,
    storageDir,
    clock,
  );
  // Every paid call goes through CostGuard (rule 7): the providers below are only used wrapped per job.
  const costGuard = new BudgetCostGuard({
    log: usage,
    settings: budget,
    defaults: budgetDefaults(env),
    clock,
  });
  const storage = new LocalStorage(storageDir);
  const probe = new FfmpegMediaProbe({
    ffmpegPath: env.STUDIO_FFMPEG_PATH,
    ffprobePath: env.STUDIO_FFPROBE_PATH,
  });
  const renderer = new RemotionRenderer({
    ...videoPackagePaths(),
    compositionId: COMPOSITION_ID,
    ...(env.STUDIO_BROWSER_EXECUTABLE !== undefined && { browserExecutable: env.STUDIO_BROWSER_EXECUTABLE }),
  });
  const renderProject = makeRenderProject({ repo, storage, renderer });
  const exportCapcut = makeExportCapcut({
    repo,
    storage,
    renderer,
    cutter: new FfmpegClipCutter({ ffmpegPath: env.STUDIO_FFMPEG_PATH }),
    archive: new ZipArchive(),
  });

  // No key → tts jobs fail with a clear message; renders work as before.
  const tts =
    env.ELEVENLABS_API_KEY === undefined
      ? null
      : new ElevenLabsTts({ apiKey: env.ELEVENLABS_API_KEY, usdPerCredit: env.ELEVENLABS_USD_PER_CREDIT });
  // Every scene voice is stored at one loudness; also used by "Cân bằng âm lượng" for older voices.
  const normalizer = new FfmpegAudioNormalizer({ ffmpegPath: env.STUDIO_FFMPEG_PATH });
  const generateSceneVoices = tts
    ? makeGenerateSceneVoices({
        repo,
        storage,
        probe,
        tts: (context) => new GuardedTts(tts, costGuard, context),
        clock,
        normalizer,
      })
    : null;
  // Free: balances voices already made, so it works without a TTS key.
  const normalizeSceneVoices = makeNormalizeSceneVoices({ repo, storage, probe, normalizer, clock });

  // No key → ai jobs fail with a clear message.
  const ai =
    env.ANTHROPIC_API_KEY === undefined
      ? null
      : new ClaudeAi({ apiKey: env.ANTHROPIC_API_KEY, model: env.AI_MODEL });
  // Full AI searches and downloads media in the worker too (ADR 0010); without keys only the library is used.
  const providers: MediaSearchPort[] = [];
  if (env.PEXELS_API_KEY !== undefined) providers.push(new PexelsSearch({ apiKey: env.PEXELS_API_KEY }));
  if (env.PIXABAY_API_KEY !== undefined) providers.push(new PixabaySearch({ apiKey: env.PIXABAY_API_KEY }));
  const rankImages = makeResolveRankImages({ library: mediaLibrary, storage, providers });
  const guardedAi = ai ? (context: PaidCallContext) => new GuardedAi(ai, costGuard, context) : null;
  const runAiTask = guardedAi ? makeRunAiTask({ ai: guardedAi, storage, rankImages }) : null;
  const runFullAi = guardedAi
    ? makeRunFullAi({
        repo,
        storage,
        clock,
        ai: guardedAi,
        searchMedia: makeSearchMedia({ repo, library: mediaLibrary, providers }),
        importCandidate: makeImportCandidate({
          repo,
          library: mediaLibrary,
          providers,
          storage,
          probe,
          remote: new FetchRemoteFiles(),
          clock,
          maxBytes: env.STUDIO_MAX_UPLOAD_MB * 1024 * 1024,
        }),
        rankImages,
        voices:
          tts && generateSceneVoices
            ? {
                tts,
                generate: generateSceneVoices,
                defaults: {
                  modelId: env.ELEVENLABS_DEFAULT_MODEL_ID,
                  ...(env.ELEVENLABS_DEFAULT_VOICE_ID !== undefined && {
                    voiceId: env.ELEVENLABS_DEFAULT_VOICE_ID,
                  }),
                },
              }
            : null,
      })
    : null;

  return {
    env,
    storageDir,
    /** Where render jobs are read from, for logs. */
    jobSource: source,
    /** Releases the database connections; call once before the process exits. */
    close,
    repo,
    storage,
    queue,
    probe,
    costGuard,
    renderProject,
    exportCapcut,
    generateSceneVoices,
    runNextRenderJob: makeRunNextRenderJob({
      queue,
      renderProject,
      exportCapcut,
      generateSceneVoices,
      normalizeSceneVoices,
      runAiTask,
      runFullAi,
      clock,
    }),
    failStaleJobs: makeFailStaleJobs({ queue, clock }),
  };
}

export type WorkerContainer = ReturnType<typeof createContainer>;
