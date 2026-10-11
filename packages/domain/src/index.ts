export { DomainError, isDomainError, type DomainErrorCode } from "./errors";
export { newId, type DomainContext, type IdGenerator, type IdPrefix } from "./ids";

export * from "./media/schema";
export * from "./scene/schema";
export * from "./project/schema";
export * from "./render/schema";
export * from "./voice/schema";
export * from "./ai/schema";
export * from "./cost/schema";
export * from "./full-ai/schema";

export {
  ACCEPTED_EXTENSIONS,
  contentTypeForFileName,
  fileExtension,
  mediaKindFromFileName,
} from "./media/accepted-files";
export { parseByteRange, type ByteRange } from "./media/byte-range";
export { addAsset, findMissingAssetIds } from "./media/operations";
export * from "./media/sfx-library";
export * from "./media/media-library";
export * from "./media/search";

export {
  DEFAULT_CAPTION_STYLE,
  DEFAULT_MAX_WORDS_PER_SCENE,
  DEFAULT_PROJECT_STYLE,
  MODE_PRESETS,
} from "./project/presets";
export {
  createProject,
  CreateProjectInputSchema,
  PROJECT_NAME_MAX_LENGTH,
  type CreateProjectInput,
} from "./project/create-project";
export { migrateProject } from "./project/migrations";
export { setMusic, setProjectVoice, updateStyle, type StylePatch } from "./project/operations";
export { RECOMMENDED_MAX_DURATION_MS, reviewProject, type ProjectWarning } from "./project/review";

export {
  scriptToScenes,
  type ScriptSplitStrategy,
  type ScriptToScenesOptions,
} from "./scene/script-to-scenes";
export {
  assignMedia,
  clearMedia,
  deleteScene,
  insertSceneAfter,
  mergeWithNext,
  moveScene,
  splitScene,
  updateScene,
  updateSceneMedia,
  addSceneSfx,
  updateSceneSfx,
  removeSceneSfx,
  DEFAULT_SFX_VOLUME,
  type SceneSfxInput,
  type SceneSfxPatch,
  type NewSceneInit,
  type SceneMediaInput,
  type SceneMediaPatch,
  type ScenePatch,
} from "./scene/operations";

export { countWords, estimateSpeechMs, speechWeight } from "./text/words";
export {
  computeTimeline,
  timelineDurationMs,
  type DurationSource,
  type TimelineEntry,
} from "./timeline/compute-timeline";
export { buildCaptions, captionsToSrt, chunkNarration, type Caption } from "./timeline/captions";

export { narrationForSpeech, voiceContentHash } from "./voice/content-hash";
export {
  activeVoiceTrack,
  hasVoiceConflict,
  sceneVoiceStatus,
  scenesNeedingLoudness,
  scenesNeedingVoice,
  type SceneVoiceStatus,
} from "./voice/voice-status";
export {
  DEFAULT_VOICE_TUNING,
  initialVoiceSettings,
  setSceneVoice,
  setVoiceSettings,
  setVoiceTrack,
} from "./voice/operations";

export { AI_TASK_TOGGLES, applyScenePlan, applyVisualPlans, assertAiTaskAllowed } from "./ai/apply";
export { orderByRanking, toRankCandidate } from "./ai/rank";
export {
  normalizeMediaRanking,
  normalizeQueries,
  normalizeScenePlan,
  normalizeSceneRewrite,
  normalizeScriptSuggestion,
  normalizeVisualPlan,
  normalizeVisualPlans,
} from "./ai/normalize";
export * from "./cost/budget";
export {
  assertFullAiRequest,
  FULL_AI_STEP_LABELS,
  fullAiSteps,
  isPaidFullAiStep,
  setMediaRankingMode,
} from "./full-ai/plan";

export { buildRenderPlan, type ResolveUrl } from "./render-plan/build-render-plan";
export type * from "./render-plan/types";
export {
  ALL_LAYERS,
  filterRenderPlan,
  hasAudibleAudio,
  type RenderLayers,
} from "./render-plan/filter-render-plan";
