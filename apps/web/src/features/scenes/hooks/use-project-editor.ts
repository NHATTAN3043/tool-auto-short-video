"use client";

import {
  computeTimeline,
  type MediaAsset,
  type MediaRankingMode,
  type ContentLanguage,
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
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { saveProject } from "@/features/project/api";

import { createAutosaver, type AutosaveStatus } from "../autosave";
import {
  canUndo,
  createEditorState,
  editorReducer,
  type EditorAction,
  type ProjectSettingsPatch,
} from "../model";

interface FlushWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
}

/** Single owner of the project on the page: settings, script and scenes all edit this one copy. */
export function useProjectEditor(initial: Project) {
  const [state, dispatch] = useReducer(
    (s: ReturnType<typeof createEditorState>, a: EditorAction) => editorReducer(s, a),
    initial,
    createEditorState,
  );
  const [saveStatus, setSaveStatus] = useState<AutosaveStatus>("idle");
  const [saver] = useState(() => createAutosaver<Project>({ save: saveProject, onStatus: setSaveStatus }));
  const lastScheduled = useRef(initial);
  const flushWaiters = useRef<FlushWaiter[]>([]);

  useEffect(() => {
    if (state.project !== lastScheduled.current) {
      lastScheduled.current = state.project;
      saver.schedule(state.project);
    }
    const waiters = flushWaiters.current.splice(0);
    if (waiters.length === 0) return;
    void saver.flush().then((ok) => {
      for (const waiter of waiters) {
        if (ok) waiter.resolve();
        else waiter.reject(new Error("Không lưu được. Vui lòng thử lại."));
      }
    });
  }, [state.project, saver]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (saver.hasUnsaved()) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      // Leaving the page inside the app: write what is still pending instead of dropping it.
      saver.dispose();
      void saver.flush();
    };
  }, [saver]);

  const timeline = useMemo(() => computeTimeline(state.project), [state.project]);

  /** Applies the settings and saves right away; rejects when the save fails. */
  const saveSettings = useCallback(
    (settings: ProjectSettingsPatch) =>
      new Promise<void>((resolve, reject) => {
        flushWaiters.current.push({ resolve, reject });
        dispatch({ type: "applySettings", settings });
      }),
    [],
  );

  /**
   * Sets voice settings the project does not have yet and saves right away, so a voice run that follows
   * reads them from the server. Rejects when the save fails.
   */
  const saveVoiceSettings = useCallback(
    (settings: VoiceSettings) =>
      new Promise<void>((resolve, reject) => {
        flushWaiters.current.push({ resolve, reject });
        dispatch({ type: "setVoiceSettings", settings });
      }),
    [],
  );

  /** Resolves once everything edited so far is saved on the server; rejects when saving fails. */
  const flushSave = useCallback(async () => {
    if (!(await saver.flush())) throw new Error("Không lưu được. Vui lòng thử lại.");
  }, [saver]);

  return {
    project: state.project,
    timeline,
    lastError: state.lastError,
    canUndo: canUndo(state),
    saveStatus,
    retrySave: () => {
      void saver.flush();
    },
    saveSettings,
    saveVoiceSettings,
    flushSave,
    setScript: (script: string) => {
      dispatch({ type: "setScript", script });
    },
    /** AI suggestions, applied after review; each is one undo step. */
    applyScript: (script: string) => {
      dispatch({ type: "applyScript", script });
    },
    applyScenePlan: (suggestion: ScenePlanSuggestion) => {
      dispatch({ type: "applyScenePlan", suggestion });
    },
    applyVisualPlans: (suggestion: VisualPlansSuggestion) => {
      dispatch({ type: "applyVisualPlans", suggestion });
    },
    setVisualPlan: (sceneId: string, visualPlan: VisualPlan | null) => {
      dispatch({ type: "setVisualPlan", sceneId, visualPlan });
    },
    splitScript: (strategy: ScriptSplitStrategy, maxWordsPerScene: number) => {
      dispatch({ type: "splitScript", strategy, maxWordsPerScene });
    },
    editNarration: (sceneId: string, narration: string) => {
      dispatch({ type: "editNarration", sceneId, narration });
    },
    /** "Giữ cảnh" on the review screen approves a scene; it can be set back to draft. */
    setSceneStatus: (sceneId: string, status: SceneStatus) => {
      dispatch({ type: "setSceneStatus", sceneId, status });
    },
    setMediaRankingMode: (mode: MediaRankingMode) => {
      dispatch({ type: "setMediaRankingMode", mode });
    },
    setAiSkill: (skillId: SkillId | undefined) => {
      dispatch({ type: "setAiSkill", skillId });
    },
    setLanguage: (language: ContentLanguage) => {
      dispatch({ type: "setLanguage", language });
    },
    setDuration: (sceneId: string, durationMs: number | null) => {
      dispatch({ type: "setDuration", sceneId, durationMs });
    },
    insertAfter: (afterSceneId: string | null) => {
      dispatch({ type: "insertAfter", afterSceneId });
    },
    deleteScene: (sceneId: string) => {
      dispatch({ type: "delete", sceneId });
    },
    moveScene: (sceneId: string, offset: -1 | 1) => {
      dispatch({ type: "move", sceneId, offset });
    },
    splitScene: (sceneId: string) => {
      dispatch({ type: "split", sceneId });
    },
    mergeWithNext: (sceneId: string) => {
      dispatch({ type: "mergeNext", sceneId });
    },
    /** `sourceStartMs`: where the scene starts in a video, e.g. the start of a picked shot. */
    assignMedia: (sceneId: string, assetId: string, sourceStartMs?: number) => {
      dispatch({
        type: "assignMedia",
        sceneId,
        assetId,
        ...(sourceStartMs !== undefined && { sourceStartMs }),
      });
    },
    updateMedia: (sceneId: string, patch: SceneMediaPatch) => {
      dispatch({ type: "updateMedia", sceneId, patch });
    },
    clearMedia: (sceneId: string) => {
      dispatch({ type: "clearMedia", sceneId });
    },
    addSfx: (sceneId: string, assetId: string) => {
      dispatch({ type: "addSfx", sceneId, assetId });
    },
    updateSfx: (sceneId: string, sfxId: string, patch: SceneSfxPatch) => {
      dispatch({ type: "updateSfx", sceneId, sfxId, patch });
    },
    removeSfx: (sceneId: string, sfxId: string) => {
      dispatch({ type: "removeSfx", sceneId, sfxId });
    },
    setVoice: (assetId: string | null) => {
      dispatch({ type: "setVoice", assetId });
    },
    setSceneVoice: (sceneId: string, voiceAssetId: string | null) => {
      dispatch({ type: "setSceneVoice", sceneId, voiceAssetId });
    },
    setMusic: (music: Music | null) => {
      dispatch({ type: "setMusic", music });
    },
    updateStyle: (patch: StylePatch) => {
      dispatch({ type: "updateStyle", patch });
    },
    setVoiceSettings: (settings: VoiceSettings | null) => {
      dispatch({ type: "setVoiceSettings", settings });
    },
    setVoiceTrack: (track: VoiceTrack) => {
      dispatch({ type: "setVoiceTrack", track });
    },
    /** A voice job finished: take the voices it attached on the server into the local copy. */
    voicesGenerated: (server: Project, sceneIds: readonly string[]) => {
      dispatch({ type: "voicesGenerated", server, sceneIds });
    },
    /** An upload finished on the server; the asset is already stored there. */
    assetAdded: (asset: MediaAsset) => {
      dispatch({ type: "assetAdded", asset });
    },
    commitTyping: () => {
      dispatch({ type: "commitTyping" });
    },
    undo: () => {
      dispatch({ type: "undo" });
    },
    dismissError: () => {
      dispatch({ type: "dismissError" });
    },
  };
}

export type ProjectEditor = ReturnType<typeof useProjectEditor>;
