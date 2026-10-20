import {
  createProject,
  MODE_PRESETS,
  type IdGenerator,
  type MediaAsset,
  type Project,
  type Scene,
} from "@studio/domain";
import { describe, expect, it } from "vitest";

import {
  canUndo,
  createEditorState,
  editorReducer,
  UNDO_LIMIT,
  type EditorAction,
  type EditorState,
} from "./model";

const NOW = "2026-01-01T00:00:00.000Z";

function ids(): IdGenerator {
  let n = 0;
  return (prefix) => `${prefix}_new${String(++n)}`;
}

const scene = (id: string, narration: string, extra: Partial<Scene> = {}): Scene => ({
  id,
  narration,
  status: "draft",
  ...extra,
});

function project(scenes: Scene[], script = ""): Project {
  return {
    ...createProject({ name: "Test", mode: "manual" }, { newId: () => "prj_1", now: NOW }),
    scenes,
    script,
  };
}

function run(state: EditorState, ...actions: EditorAction[]): EditorState {
  const newId = ids();
  return actions.reduce((s, action) => editorReducer(s, action, { newId }), state);
}

const narrations = (state: EditorState) => state.project.scenes.map((s) => s.narration);
const sceneIds = (state: EditorState) => state.project.scenes.map((s) => s.id);

const three = () =>
  createEditorState(project([scene("a", "Một hai ba."), scene("b", "Bốn năm sáu."), scene("c", "Bảy tám.")]));

describe("editor reducer", () => {
  it("splits the script into scenes, replacing the old ones", () => {
    const state = run(createEditorState(project([scene("old", "cũ")], "Đoạn một.\n\nĐoạn hai.")), {
      type: "splitScript",
      strategy: "auto",
      maxWordsPerScene: 18,
    });
    expect(narrations(state)).toEqual(["Đoạn một.", "Đoạn hai."]);
    expect(sceneIds(state)).toEqual(["scn_new1", "scn_new2"]);
  });

  it("honours the sentence strategy and word limit", () => {
    const state = run(createEditorState(project([], "Một hai. Ba bốn. Năm sáu.")), {
      type: "splitScript",
      strategy: "sentence",
      maxWordsPerScene: 4,
    });
    expect(narrations(state)).toEqual(["Một hai. Ba bốn.", "Năm sáu."]);
  });

  it("edits narration and manual duration through the domain", () => {
    const state = run(
      three(),
      { type: "editNarration", sceneId: "b", narration: "Mới." },
      { type: "setDuration", sceneId: "c", durationMs: 2500 },
    );
    expect(narrations(state)).toEqual(["Một hai ba.", "Mới.", "Bảy tám."]);
    expect(state.project.scenes[2]?.durationMs).toBe(2500);

    const cleared = run(state, { type: "setDuration", sceneId: "c", durationMs: null });
    expect(cleared.project.scenes[2]).not.toHaveProperty("durationMs");
  });

  it("inserts, deletes and reorders scenes", () => {
    const inserted = run(three(), { type: "insertAfter", afterSceneId: "a" });
    expect(sceneIds(inserted)).toEqual(["a", "scn_new1", "b", "c"]);
    expect(sceneIds(run(three(), { type: "insertAfter", afterSceneId: null }))[0]).toBe("scn_new1");

    expect(sceneIds(run(three(), { type: "delete", sceneId: "b" }))).toEqual(["a", "c"]);
    expect(sceneIds(run(three(), { type: "move", sceneId: "c", offset: -1 }))).toEqual(["a", "c", "b"]);
    expect(sceneIds(run(three(), { type: "move", sceneId: "a", offset: 1 }))).toEqual(["b", "a", "c"]);
  });

  it("treats moving past either end as a no-op without an undo step", () => {
    const start = three();
    const up = run(start, { type: "move", sceneId: "a", offset: -1 });
    const down = run(start, { type: "move", sceneId: "c", offset: 1 });
    expect(up.project).toBe(start.project);
    expect(down.project).toBe(start.project);
    expect(canUndo(up) || canUndo(down)).toBe(false);
  });

  it("splits and merges scenes", () => {
    const split = run(createEditorState(project([scene("a", "Câu thứ nhất dài, câu thứ hai cũng dài.")])), {
      type: "split",
      sceneId: "a",
    });
    expect(narrations(split)).toEqual(["Câu thứ nhất dài,", "câu thứ hai cũng dài."]);

    const merged = run(three(), { type: "mergeNext", sceneId: "a" });
    expect(narrations(merged)).toEqual(["Một hai ba. Bốn năm sáu.", "Bảy tám."]);
    expect(sceneIds(merged)).toEqual(["a", "c"]);
  });

  it("reports rejected operations without changing the project", () => {
    const start = createEditorState(project([scene("a", "Một"), scene("b", "Hai")]));
    const badMerge = run(start, { type: "mergeNext", sceneId: "b" });
    expect(badMerge.project).toBe(start.project);
    expect(badMerge.lastError).toBe("Cảnh cuối không có cảnh sau để gộp.");

    const badSplit = run(start, { type: "split", sceneId: "a" });
    expect(badSplit.project).toBe(start.project);
    expect(badSplit.lastError).toBe("Lời của cảnh quá ngắn để tách.");

    expect(run(badSplit, { type: "dismissError" }).lastError).toBeNull();
    expect(run(badSplit, { type: "delete", sceneId: "a" }).lastError).toBeNull();
  });

  it("undoes back to the exact previous content", () => {
    const start = three();
    const changed = run(start, { type: "delete", sceneId: "a" }, { type: "mergeNext", sceneId: "b" });
    const once = run(changed, { type: "undo" });
    expect(sceneIds(once)).toEqual(["b", "c"]);
    const twice = run(once, { type: "undo" });
    expect(twice.project).toEqual(start.project);
    expect(canUndo(twice)).toBe(false);
    expect(run(twice, { type: "undo" })).toBe(twice);
  });

  it("groups consecutive typing in one field into a single undo step", () => {
    const typed = run(
      three(),
      { type: "editNarration", sceneId: "a", narration: "M" },
      { type: "editNarration", sceneId: "a", narration: "Mư" },
      { type: "editNarration", sceneId: "a", narration: "Mười" },
    );
    expect(typed.past).toHaveLength(1);

    const otherField = run(typed, { type: "editNarration", sceneId: "b", narration: "X" });
    expect(otherField.past).toHaveLength(2);

    const afterBlur = run(
      typed,
      { type: "commitTyping" },
      { type: "editNarration", sceneId: "a", narration: "Mười một" },
    );
    expect(afterBlur.past).toHaveLength(2);
    expect(run(afterBlur, { type: "undo" }).project.scenes[0]?.narration).toBe("Mười");
  });

  it("caps the undo history", () => {
    let state = createEditorState(project([]));
    for (let i = 0; i < UNDO_LIMIT + 5; i++) {
      state = run(state, { type: "setScript", script: String(i) }, { type: "commitTyping" });
    }
    expect(state.past).toHaveLength(UNDO_LIMIT);
  });

  it("applies settings outside the undo history and keeps them on undo", () => {
    const edited = run(three(), { type: "delete", sceneId: "a" });
    const settings = {
      name: "Đổi tên",
      mode: "assisted" as const,
      automationSettings: MODE_PRESETS.assisted,
    };
    const withSettings = run(edited, { type: "applySettings", settings });
    expect(withSettings.past).toHaveLength(1);

    const undone = run(withSettings, { type: "undo" });
    expect(sceneIds(undone)).toEqual(["a", "b", "c"]);
    expect(undone.project.name).toBe("Đổi tên");
    expect(undone.project.mode).toBe("assisted");
  });
});

describe("editor reducer: media", () => {
  const media = (id: string, kind: MediaAsset["kind"], durationMs?: number): MediaAsset => ({
    id,
    kind,
    source: "upload",
    fileName: `${id}.bin`,
    path: `media/${id}.bin`,
    createdAt: NOW,
    ...(durationMs !== undefined && { durationMs }),
  });
  const withAssets = () =>
    createEditorState({
      ...project([scene("a", "Một."), scene("b", "Hai.")]),
      assets: [media("vid", "video", 30_000), media("img", "image"), media("voice", "audio", 9000)],
    });

  it("adds uploaded assets outside the undo history, once", () => {
    const state = run(
      withAssets(),
      { type: "assetAdded", asset: media("new", "video") },
      { type: "assetAdded", asset: media("new", "video") },
    );
    expect(state.project.assets.map((a) => a.id)).toEqual(["vid", "img", "voice", "new"]);
    expect(canUndo(state)).toBe(false);
  });

  it("assigns, trims and clears scene media", () => {
    const assigned = run(withAssets(), { type: "assignMedia", sceneId: "a", assetId: "vid" });
    expect(assigned.project.scenes[0]?.media).toMatchObject({
      assetId: "vid",
      sourceStartMs: 0,
      fit: "cover",
    });

    const trimmed = run(assigned, {
      type: "updateMedia",
      sceneId: "a",
      patch: { sourceStartMs: 15_000, sourceEndMs: 22_000, focusX: 0.3 },
    });
    expect(trimmed.project.scenes[0]?.media).toMatchObject({
      sourceStartMs: 15_000,
      sourceEndMs: 22_000,
      focusX: 0.3,
    });
    expect(run(trimmed, { type: "clearMedia", sceneId: "a" }).project.scenes[0]?.media).toBeUndefined();
  });

  it("groups a slider drag into one undo step", () => {
    const assigned = run(withAssets(), { type: "assignMedia", sceneId: "a", assetId: "vid" });
    const dragged = run(
      assigned,
      { type: "updateMedia", sceneId: "a", patch: { focusX: 0.4 } },
      { type: "updateMedia", sceneId: "a", patch: { focusX: 0.3 } },
      { type: "updateMedia", sceneId: "a", patch: { focusX: 0.2 } },
      { type: "commitTyping" },
    );
    expect(dragged.past).toHaveLength(2);
    expect(run(dragged, { type: "undo" }).project.scenes[0]?.media?.focusX).toBe(0.5);
  });

  it("reports invalid media changes without touching the project", () => {
    const assigned = run(withAssets(), { type: "assignMedia", sceneId: "a", assetId: "vid" });
    const bad = run(assigned, {
      type: "updateMedia",
      sceneId: "a",
      patch: { sourceStartMs: 5000, sourceEndMs: 1000 },
    });
    expect(bad.project).toBe(assigned.project);
    expect(bad.lastError).toMatch(/kết thúc/u);
    expect(
      run(withAssets(), { type: "assignMedia", sceneId: "a", assetId: "voice" }).lastError,
    ).not.toBeNull();
  });

  it("sets the project voice and music, and undo brings back the previous state", () => {
    const state = run(
      withAssets(),
      { type: "setVoice", assetId: "voice" },
      { type: "setMusic", music: { assetId: "voice", volume: 0.2 } },
      { type: "setMusic", music: { assetId: "voice", volume: 0.1 } },
      { type: "commitTyping" },
    );
    expect(state.project.voiceAssetId).toBe("voice");
    expect(state.project.music).toEqual({ assetId: "voice", volume: 0.1 });

    const noMusic = run(state, { type: "undo" });
    expect(noMusic.project.music).toBeUndefined();
    expect("music" in noMusic.project).toBe(false);
    const noVoice = run(noMusic, { type: "undo" });
    expect("voiceAssetId" in noVoice.project).toBe(false);

    expect(run(withAssets(), { type: "setVoice", assetId: "vid" }).lastError).toBe(
      "Chỉ chọn được file âm thanh.",
    );
  });

  it("adds, adjusts and removes scene sound effects with one undo step per drag", () => {
    const added = run(withAssets(), { type: "addSfx", sceneId: "a", assetId: "voice" });
    const [effect] = added.project.scenes[0]?.sfx ?? [];
    expect(effect).toMatchObject({ assetId: "voice", offsetMs: 0 });
    if (!effect) return;

    const dragged = run(
      added,
      { type: "updateSfx", sceneId: "a", sfxId: effect.id, patch: { volume: 0.5 } },
      { type: "updateSfx", sceneId: "a", sfxId: effect.id, patch: { volume: 0.4 } },
      { type: "commitTyping" },
      { type: "updateSfx", sceneId: "a", sfxId: effect.id, patch: { offsetMs: 1500 } },
    );
    expect(dragged.project.scenes[0]?.sfx?.[0]).toMatchObject({ volume: 0.4, offsetMs: 1500 });
    expect(dragged.past).toHaveLength(3);

    const removed = run(dragged, { type: "removeSfx", sceneId: "a", sfxId: effect.id });
    expect(removed.project.scenes[0]?.sfx).toBeUndefined();
    expect(run(removed, { type: "undo" }).project.scenes[0]?.sfx).toHaveLength(1);
  });

  it("rejects a non-audio sound effect and invalid values", () => {
    expect(run(withAssets(), { type: "addSfx", sceneId: "a", assetId: "vid" }).lastError).toBe(
      "Chỉ chọn được file âm thanh.",
    );
    const added = run(withAssets(), { type: "addSfx", sceneId: "a", assetId: "voice" });
    const sfxId = added.project.scenes[0]?.sfx?.[0]?.id ?? "";
    const bad = run(added, { type: "updateSfx", sceneId: "a", sfxId, patch: { offsetMs: -5 } });
    expect(bad.project).toBe(added.project);
    expect(bad.lastError).toMatch(/hiệu ứng/u);
  });
});

describe("editor reducer: style", () => {
  it("changes captions and transition as one undo step per drag", () => {
    const start = createEditorState(project([scene("a", "Một.")]));
    const dragged = run(
      start,
      { type: "updateStyle", patch: { captions: { positionY: 0.6 } } },
      { type: "updateStyle", patch: { captions: { positionY: 0.55 } } },
      { type: "commitTyping" },
      { type: "updateStyle", patch: { transition: "none", transitionMs: 300 } },
      { type: "commitTyping" },
    );
    expect(dragged.project.style).toMatchObject({ transition: "none", transitionMs: 300 });
    expect(dragged.project.style.captions.positionY).toBe(0.55);
    expect(dragged.past).toHaveLength(2);

    const once = run(dragged, { type: "undo" });
    expect(once.project.style.transition).toBe("fade");
    expect(once.project.style.captions.positionY).toBe(0.55);
    expect(run(once, { type: "undo" }).project.style).toEqual(start.project.style);
  });

  it("rejects invalid values with a message", () => {
    const state = run(createEditorState(project([])), {
      type: "updateStyle",
      patch: { captions: { fontSize: 0 } },
    });
    expect(state.lastError).toMatch(/không hợp lệ/u);
    expect(state.project.style.captions.fontSize).toBeGreaterThan(0);
  });
});

describe("editor reducer: voice", () => {
  const settings = {
    provider: "elevenlabs",
    voiceId: "v1",
    modelId: "eleven_flash_v2_5",
    stability: 0.5,
    similarityBoost: 0.75,
    speed: 1,
  };
  const tts = (id: string): MediaAsset => ({
    id,
    kind: "audio",
    source: "tts",
    fileName: `${id}.mp3`,
    path: `media/${id}.mp3`,
    createdAt: NOW,
  });

  it("changes voice settings as one undo step per drag and rejects invalid ones", () => {
    const state = run(
      three(),
      { type: "setVoiceSettings", settings },
      { type: "setVoiceSettings", settings: { ...settings, speed: 1.1 } },
      { type: "commitTyping" },
      { type: "setVoiceTrack", track: "scenes" },
    );
    expect(state.project.voice?.speed).toBe(1.1);
    expect(state.project.voiceTrack).toBe("scenes");
    const undone = run(state, { type: "undo" });
    expect(undone.project.voiceTrack).toBeUndefined();
    expect(run(undone, { type: "undo" }).project.voice).toBeUndefined();

    const invalid = run(state, { type: "setVoiceSettings", settings: { ...settings, speed: 5 } });
    expect(invalid.lastError).toMatch(/giọng/u);
    expect(invalid.project.voice?.speed).toBe(1.1);
  });

  it("takes generated voices from the server without losing local edits", () => {
    const local = run(three(), { type: "editNarration", sceneId: "c", narration: "Sửa tại chỗ." });
    const server: Project = {
      ...local.project,
      scenes: [
        scene("a", "Một hai ba.", { voiceAssetId: "ast_a" }),
        scene("b", "Bốn năm sáu.", { voiceAssetId: "ast_b" }),
        scene("c", "Bảy tám.", { voiceAssetId: "ast_c" }),
      ],
      assets: [tts("ast_a"), tts("ast_b"), tts("ast_c")],
    };
    const state = run(local, { type: "voicesGenerated", server, sceneIds: ["a", "c"] });
    expect(state.project.scenes.map((s) => s.voiceAssetId)).toEqual(["ast_a", undefined, "ast_c"]);
    expect(narrations(state)).toEqual(["Một hai ba.", "Bốn năm sáu.", "Sửa tại chỗ."]);
    expect(state.project.assets.map((a) => a.id)).toEqual(["ast_a", "ast_b", "ast_c"]);
    expect(state.past).toBe(local.past);
  });

  it("picks, clears and undoes a scene's own voice file", () => {
    const upload: MediaAsset = { ...tts("ast_up"), source: "upload", fileName: "doc-tay.mp3" };
    const image: MediaAsset = { ...tts("ast_img"), kind: "image", fileName: "anh.jpg" };
    const start = createEditorState({ ...three().project, assets: [upload, image] });

    const picked = run(start, { type: "setSceneVoice", sceneId: "b", voiceAssetId: "ast_up" });
    expect(picked.project.scenes.map((s) => s.voiceAssetId)).toEqual([undefined, "ast_up", undefined]);

    const cleared = run(picked, { type: "setSceneVoice", sceneId: "b", voiceAssetId: null });
    expect("voiceAssetId" in (cleared.project.scenes[1] ?? {})).toBe(false);
    expect(run(cleared, { type: "undo" }).project.scenes[1]?.voiceAssetId).toBe("ast_up");

    const rejected = run(start, { type: "setSceneVoice", sceneId: "b", voiceAssetId: "ast_img" });
    expect(rejected.lastError).toMatch(/âm thanh/u);
    expect(rejected.project.scenes[1]?.voiceAssetId).toBeUndefined();
  });
});

describe("editor reducer: AI suggestions", () => {
  const visual = { intent: "Mèo", preferredMedia: "video" as const, searchQueries: ["cat"] };

  it("applies an AI script as its own undo step, separate from typing", () => {
    const typed = run(three(), { type: "setScript", script: "Tay" });
    const state = run(typed, { type: "applyScript", script: "AI viết." });
    expect(state.project.script).toBe("AI viết.");
    expect(run(state, { type: "undo" }).project.script).toBe("Tay");
  });

  it("replaces scenes with an AI plan and restores them on undo", () => {
    const state = run(three(), {
      type: "applyScenePlan",
      suggestion: { scenes: [{ narration: "Mới.", visualPlan: visual }] },
    });
    expect(state.project.scenes).toEqual([
      { id: "scn_new1", narration: "Mới.", status: "draft", visualPlan: visual },
    ]);
    expect(sceneIds(run(state, { type: "undo" }))).toEqual(["a", "b", "c"]);
  });

  it("sets visual plans from AI and edits or clears one by hand", () => {
    const applied = run(three(), {
      type: "applyVisualPlans",
      suggestion: { plans: [{ sceneId: "b", visualPlan: visual }] },
    });
    expect(applied.project.scenes.map((s) => s.visualPlan?.intent)).toEqual([undefined, "Mèo", undefined]);
    const edited = run(
      applied,
      { type: "setVisualPlan", sceneId: "b", visualPlan: { ...visual, searchQueries: ["cat", "kitten"] } },
      { type: "setVisualPlan", sceneId: "b", visualPlan: { ...visual, searchQueries: ["kitten"] } },
    );
    expect(edited.project.scenes[1]?.visualPlan?.searchQueries).toEqual(["kitten"]);
    expect(run(edited, { type: "undo" }).project.scenes[1]?.visualPlan?.searchQueries).toEqual(["cat"]);
    const cleared = run(edited, { type: "setVisualPlan", sceneId: "b", visualPlan: null });
    expect(cleared.project.scenes[1]).not.toHaveProperty("visualPlan");
  });
});

describe("editor reducer: Full AI review", () => {
  it("approves a scene as one undo step and remembers the ranking mode without one", () => {
    const start = createEditorState(project([scene("a", "Một.")]));
    const approved = editorReducer(start, { type: "setSceneStatus", sceneId: "a", status: "approved" });
    expect(approved.project.scenes[0]?.status).toBe("approved");
    expect(editorReducer(approved, { type: "undo" }).project.scenes[0]?.status).toBe("draft");

    const remembered = editorReducer(start, { type: "setMediaRankingMode", mode: "vision" });
    expect(remembered.project.mediaRankingMode).toBe("vision");
    expect(canUndo(remembered)).toBe(false);
  });

  it("remembers the skill without an undo step, and forgets it on none", () => {
    const start = createEditorState(project([scene("a", "Một.")]));
    const chosen = editorReducer(start, { type: "setAiSkill", skillId: "viral-hooks" });
    expect(chosen.project.aiSkillId).toBe("viral-hooks");
    expect(canUndo(chosen)).toBe(false);
    const cleared = editorReducer(chosen, { type: "setAiSkill", skillId: undefined });
    expect("aiSkillId" in cleared.project).toBe(false);
  });

  it("sets the project language without an undo step", () => {
    const start = createEditorState(project([scene("a", "Một.")]));
    const english = editorReducer(start, { type: "setLanguage", language: "en" });
    expect(english.project.language).toBe("en");
    expect(canUndo(english)).toBe(false);
  });
});
