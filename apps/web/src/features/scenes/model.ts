import {
  addSceneSfx,
  applyScenePlan,
  applyVisualPlans,
  assignMedia,
  clearMedia,
  deleteScene,
  insertSceneAfter,
  isDomainError,
  mergeWithNext,
  moveScene,
  removeSceneSfx,
  scriptToScenes,
  setAiSkill,
  setProjectLanguage,
  setMediaRankingMode,
  setMusic,
  setProjectVoice,
  setVoiceSettings,
  setVoiceTrack,
  splitScene,
  updateScene,
  updateSceneMedia,
  updateSceneSfx,
  updateStyle,
  type ContentLanguage,
  type DomainContext,
  type MediaAsset,
  type MediaRankingMode,
  type SkillId,
  type Music,
  type Project,
  type ScenePlanSuggestion,
  type SceneMediaPatch,
  type SceneStatus,
  type SceneSfxPatch,
  type ScriptSplitStrategy,
  type StylePatch,
  type VisualPlan,
  type VisualPlansSuggestion,
  type VoiceSettings,
  type VoiceTrack,
} from "@studio/domain";

// Pure state transitions for the script, scene and media editor. Every scene change goes through the domain
// operations; the hook only holds this state and autosaves `project`.

export const UNDO_LIMIT = 20;

/**
 * The part of the project the editor owns. Undo restores only this, never the project settings or the
 * asset list (assets are added by the server when an upload finishes).
 */
export type EditorContent = Pick<
  Project,
  "script" | "scenes" | "voiceAssetId" | "music" | "style" | "voice" | "voiceTrack"
>;

export type ProjectSettingsPatch = Pick<Project, "name" | "mode" | "automationSettings">;

export interface EditorState {
  project: Project;
  past: EditorContent[];
  /** Consecutive actions with the same key (typing in one field) share a single undo step. */
  coalesceKey: string | null;
  lastError: string | null;
}

export type EditorAction =
  | { type: "setScript"; script: string }
  | { type: "applyScript"; script: string }
  | { type: "applyScenePlan"; suggestion: ScenePlanSuggestion }
  | { type: "applyVisualPlans"; suggestion: VisualPlansSuggestion }
  | { type: "setVisualPlan"; sceneId: string; visualPlan: VisualPlan | null }
  | { type: "splitScript"; strategy: ScriptSplitStrategy; maxWordsPerScene: number }
  | { type: "editNarration"; sceneId: string; narration: string }
  | { type: "setSceneStatus"; sceneId: string; status: SceneStatus }
  | { type: "setDuration"; sceneId: string; durationMs: number | null }
  | { type: "insertAfter"; afterSceneId: string | null }
  | { type: "delete"; sceneId: string }
  | { type: "move"; sceneId: string; offset: -1 | 1 }
  | { type: "split"; sceneId: string }
  | { type: "mergeNext"; sceneId: string }
  | { type: "assignMedia"; sceneId: string; assetId: string }
  | { type: "updateMedia"; sceneId: string; patch: SceneMediaPatch }
  | { type: "clearMedia"; sceneId: string }
  | { type: "addSfx"; sceneId: string; assetId: string }
  | { type: "updateSfx"; sceneId: string; sfxId: string; patch: SceneSfxPatch }
  | { type: "removeSfx"; sceneId: string; sfxId: string }
  | { type: "setVoice"; assetId: string | null }
  | { type: "setSceneVoice"; sceneId: string; voiceAssetId: string | null }
  | { type: "setMusic"; music: Music | null }
  | { type: "updateStyle"; patch: StylePatch }
  | { type: "setVoiceSettings"; settings: VoiceSettings | null }
  | { type: "setVoiceTrack"; track: VoiceTrack }
  | { type: "assetAdded"; asset: MediaAsset }
  | { type: "voicesGenerated"; server: Project; sceneIds: readonly string[] }
  | { type: "applySettings"; settings: ProjectSettingsPatch }
  | { type: "setMediaRankingMode"; mode: MediaRankingMode }
  | { type: "setAiSkill"; skillId: SkillId | undefined }
  | { type: "setLanguage"; language: ContentLanguage }
  | { type: "commitTyping" }
  | { type: "undo" }
  | { type: "dismissError" };

type ContentAction = Exclude<
  EditorAction,
  {
    type:
      | "applySettings"
      | "setMediaRankingMode"
      | "setAiSkill"
      | "setLanguage"
      | "assetAdded"
      | "voicesGenerated"
      | "commitTyping"
      | "undo"
      | "dismissError";
  }
>;

export function createEditorState(project: Project): EditorState {
  return { project, past: [], coalesceKey: null, lastError: null };
}

export function canUndo(state: EditorState): boolean {
  return state.past.length > 0;
}

function contentOf(project: Project): EditorContent {
  const { script, scenes, voiceAssetId, music, style, voice, voiceTrack } = project;
  return { script, scenes, voiceAssetId, music, style, voice, voiceTrack };
}

function restoreContent(project: Project, content: EditorContent): Project {
  const next: Project = { ...project, script: content.script, scenes: content.scenes, style: content.style };
  delete next.voiceAssetId;
  delete next.music;
  delete next.voice;
  delete next.voiceTrack;
  if (content.voiceAssetId !== undefined) next.voiceAssetId = content.voiceAssetId;
  if (content.music !== undefined) next.music = content.music;
  if (content.voice !== undefined) next.voice = content.voice;
  if (content.voiceTrack !== undefined) next.voiceTrack = content.voiceTrack;
  return next;
}

/**
 * The worker attached new voices on the server. Takes the server's assets and, for the generated scenes
 * that still exist here, the server's voice reference; everything else keeps the local edits.
 */
function applyGeneratedVoices(project: Project, server: Project, sceneIds: readonly string[]): Project {
  const known = new Set(project.assets.map((asset) => asset.id));
  const assets = [...project.assets, ...server.assets.filter((asset) => !known.has(asset.id))];
  const serverVoices = new Map(server.scenes.map((scene) => [scene.id, scene.voiceAssetId]));
  const wanted = new Set(sceneIds);
  const scenes = project.scenes.map((scene) => {
    const voiceAssetId = serverVoices.get(scene.id);
    if (!wanted.has(scene.id) || voiceAssetId === undefined || voiceAssetId === scene.voiceAssetId) {
      return scene;
    }
    return { ...scene, voiceAssetId };
  });
  return { ...project, assets, scenes };
}

function coalesceKeyOf(action: ContentAction): string | null {
  if (action.type === "setScript") return "script";
  if (action.type === "editNarration") return `narration:${action.sceneId}`;
  if (action.type === "setVisualPlan") return `visual:${action.sceneId}`;
  // Dragging a slider fires many updates; they form one undo step until the drag ends.
  if (action.type === "updateMedia") return `media:${action.sceneId}`;
  if (action.type === "updateSfx") return `sfx:${action.sfxId}`;
  if (action.type === "setMusic" && action.music !== null) return "music";
  if (action.type === "updateStyle") return "style";
  if (action.type === "setVoiceSettings" && action.settings !== null) return "voice";
  return null;
}

/** Vietnamese message shown when the domain rejects an action. */
function failureMessage(action: ContentAction): string {
  switch (action.type) {
    case "split":
      return "Lời của cảnh quá ngắn để tách.";
    case "mergeNext":
      return "Cảnh cuối không có cảnh sau để gộp.";
    case "setDuration":
      return "Thời lượng phải lớn hơn 0.";
    case "splitScript":
      return "Số từ tối đa mỗi cảnh không hợp lệ.";
    case "assignMedia":
      return "Không gán được media này cho cảnh.";
    case "updateMedia":
      return "Đoạn video không hợp lệ: điểm kết thúc phải sau điểm bắt đầu.";
    case "setVoice":
    case "setSceneVoice":
    case "setMusic":
    case "addSfx":
      return "Chỉ chọn được file âm thanh.";
    case "updateSfx":
      return "Thời điểm hoặc âm lượng hiệu ứng không hợp lệ.";
    case "updateStyle":
      return "Giá trị cài đặt phụ đề hoặc chuyển cảnh không hợp lệ.";
    case "applyScenePlan":
    case "applyVisualPlans":
      return "Gợi ý của AI không còn khớp với dự án, không áp dụng được.";
    case "setVoiceSettings":
      return "Cài đặt giọng đọc không hợp lệ.";
    default:
      return "Không thể thực hiện thao tác này.";
  }
}

function applyContent(project: Project, action: ContentAction, ctx: DomainContext): Project {
  const indexOf = (sceneId: string) => project.scenes.findIndex((scene) => scene.id === sceneId);
  switch (action.type) {
    case "setScript":
    case "applyScript":
      return { ...project, script: action.script };
    case "applyScenePlan":
      return applyScenePlan(project, action.suggestion, ctx);
    case "applyVisualPlans":
      return applyVisualPlans(project, action.suggestion);
    case "setVisualPlan":
      return updateScene(project, action.sceneId, { visualPlan: action.visualPlan });
    case "splitScript":
      return {
        ...project,
        scenes: scriptToScenes(
          project.script,
          { strategy: action.strategy, maxWordsPerScene: action.maxWordsPerScene },
          ctx,
        ),
      };
    case "editNarration":
      return updateScene(project, action.sceneId, { narration: action.narration });
    case "setSceneStatus":
      return updateScene(project, action.sceneId, { status: action.status });
    case "setDuration":
      return updateScene(project, action.sceneId, { durationMs: action.durationMs });
    case "insertAfter":
      return insertSceneAfter(project, action.afterSceneId, {}, ctx);
    case "delete":
      return deleteScene(project, action.sceneId);
    case "move":
      return moveScene(project, action.sceneId, indexOf(action.sceneId) + action.offset);
    case "split":
      return splitScene(project, action.sceneId, ctx);
    case "mergeNext":
      return mergeWithNext(project, action.sceneId);
    case "assignMedia":
      return assignMedia(project, action.sceneId, { assetId: action.assetId });
    case "updateMedia":
      return updateSceneMedia(project, action.sceneId, action.patch);
    case "clearMedia":
      return clearMedia(project, action.sceneId);
    case "addSfx":
      return addSceneSfx(project, action.sceneId, { assetId: action.assetId }, ctx);
    case "updateSfx":
      return updateSceneSfx(project, action.sceneId, action.sfxId, action.patch);
    case "removeSfx":
      return removeSceneSfx(project, action.sceneId, action.sfxId);
    case "setVoice":
      return setProjectVoice(project, action.assetId);
    case "setSceneVoice":
      return updateScene(project, action.sceneId, { voiceAssetId: action.voiceAssetId });
    case "setMusic":
      return setMusic(project, action.music);
    case "updateStyle":
      return updateStyle(project, action.patch);
    case "setVoiceSettings":
      return setVoiceSettings(project, action.settings);
    case "setVoiceTrack":
      return setVoiceTrack(project, action.track);
  }
}

function reduceContent(state: EditorState, action: ContentAction, ctx: DomainContext): EditorState {
  let next: Project;
  try {
    next = applyContent(state.project, action, ctx);
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { ...state, lastError: failureMessage(action), coalesceKey: null };
  }
  // Domain operations return the same object when nothing changes (e.g. moving the first scene up).
  if (next === state.project) return { ...state, lastError: null };

  const key = coalesceKeyOf(action);
  const coalesce = key !== null && key === state.coalesceKey;
  const past = coalesce ? state.past : [...state.past, contentOf(state.project)].slice(-UNDO_LIMIT);
  return { project: next, past, coalesceKey: key, lastError: null };
}

export function editorReducer(
  state: EditorState,
  action: EditorAction,
  ctx: DomainContext = {},
): EditorState {
  switch (action.type) {
    case "applySettings":
      return { ...state, project: { ...state.project, ...action.settings } };
    // A preference, like the settings: saved, but not an undo step.
    case "setMediaRankingMode":
      return { ...state, project: setMediaRankingMode(state.project, action.mode) };
    case "setAiSkill":
      return { ...state, project: setAiSkill(state.project, action.skillId) };
    // Also a preference: switching back restores the voices' status, nothing is lost.
    case "setLanguage":
      return { ...state, project: setProjectLanguage(state.project, action.language) };
    case "assetAdded":
      if (state.project.assets.some((asset) => asset.id === action.asset.id)) return state;
      return { ...state, project: { ...state.project, assets: [...state.project.assets, action.asset] } };
    case "voicesGenerated":
      return {
        ...state,
        project: applyGeneratedVoices(state.project, action.server, action.sceneIds),
      };
    case "commitTyping":
      return state.coalesceKey === null ? state : { ...state, coalesceKey: null };
    case "dismissError":
      return state.lastError === null ? state : { ...state, lastError: null };
    case "undo": {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        project: restoreContent(state.project, previous),
        past: state.past.slice(0, -1),
        coalesceKey: null,
        lastError: null,
      };
    }
    default:
      return reduceContent(state, action, ctx);
  }
}
