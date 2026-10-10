"use client";

import type { AutomationMode, AutomationSettings, Project } from "@studio/domain";
import { useState } from "react";

import {
  draftFromProject,
  isDirty,
  nameError,
  selectMode,
  toggleSetting,
  type ProjectSettingsDraft,
} from "../model";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * The project itself is owned by the page editor (which also autosaves scenes); this hook only keeps the
 * settings draft and hands it to `onSave`, so two copies of the project can never overwrite each other.
 */
export function useProjectSettings(
  project: Project,
  onSave: (settings: ProjectSettingsDraft) => Promise<void>,
) {
  const [draft, setDraft] = useState(() => draftFromProject(project));
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [presetNotice, setPresetNotice] = useState<AutomationMode | null>(null);

  const validation = nameError(draft.name);
  const dirty = isDirty(draft, project);

  async function save() {
    if (validation || !dirty) return;
    setStatus("saving");
    setError(null);
    try {
      const next = { ...draft, name: draft.name.trim() };
      await onSave(next);
      setDraft(next);
      setPresetNotice(null);
      setStatus("saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được.");
      setStatus("error");
    }
  }

  return {
    draft,
    dirty,
    status,
    error,
    nameError: validation,
    presetNotice,
    setName: (name: string) => {
      setDraft((d) => ({ ...d, name }));
    },
    selectMode: (mode: AutomationMode) => {
      if (mode === draft.mode) return;
      setDraft((d) => selectMode(d, mode));
      setPresetNotice(mode);
    },
    toggle: (key: keyof AutomationSettings, value: boolean) => {
      setDraft((d) => toggleSetting(d, key, value));
    },
    save,
  };
}
