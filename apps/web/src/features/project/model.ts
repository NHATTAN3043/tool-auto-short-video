import {
  MODE_PRESETS,
  PROJECT_NAME_MAX_LENGTH,
  type AutomationMode,
  type AutomationSettings,
  type CreateProjectInput,
  type Project,
} from "@studio/domain";

// Pure state transitions for the project forms. Hooks hold the state; components only render it.

export interface ProjectSettingsDraft {
  name: string;
  mode: AutomationMode;
  automationSettings: AutomationSettings;
}

/** Display order of the toggles, following the pipeline: script → scenes → voice → media. */
export const SETTING_KEYS: readonly (keyof AutomationSettings)[] = [
  "scriptGeneration",
  "scenePlanning",
  "visualKeywords",
  "voiceGeneration",
  "mediaSearch",
  "mediaRanking",
  "autoMediaSelection",
];

/** Toggles grouped by what they act on, for display. Covers every key of SETTING_KEYS exactly once. */
export const SETTING_GROUPS: readonly { title: string; keys: readonly (keyof AutomationSettings)[] }[] = [
  { title: "Script", keys: ["scriptGeneration", "scenePlanning"] },
  { title: "Hình ảnh", keys: ["visualKeywords", "mediaSearch", "mediaRanking", "autoMediaSelection"] },
  { title: "Giọng đọc", keys: ["voiceGeneration"] },
];

export function enabledCount(settings: AutomationSettings): number {
  return SETTING_KEYS.filter((key) => settings[key]).length;
}

export function newDraft(mode: AutomationMode = "manual"): ProjectSettingsDraft {
  return { name: "", mode, automationSettings: { ...MODE_PRESETS[mode] } };
}

export function draftFromProject(project: Project): ProjectSettingsDraft {
  return { name: project.name, mode: project.mode, automationSettings: { ...project.automationSettings } };
}

/** Choosing a mode resets the toggles to its preset; the user can still adjust them afterwards. */
export function selectMode(draft: ProjectSettingsDraft, mode: AutomationMode): ProjectSettingsDraft {
  return { ...draft, mode, automationSettings: { ...MODE_PRESETS[mode] } };
}

export function toggleSetting(
  draft: ProjectSettingsDraft,
  key: keyof AutomationSettings,
  value: boolean,
): ProjectSettingsDraft {
  return { ...draft, automationSettings: { ...draft.automationSettings, [key]: value } };
}

export function isCustomized(draft: ProjectSettingsDraft): boolean {
  const preset = MODE_PRESETS[draft.mode];
  return SETTING_KEYS.some((key) => draft.automationSettings[key] !== preset[key]);
}

/** Vietnamese validation message for the name field, or null when valid. */
export function nameError(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return "Hãy đặt tên cho dự án.";
  if (trimmed.length > PROJECT_NAME_MAX_LENGTH) {
    return `Tên dự án tối đa ${String(PROJECT_NAME_MAX_LENGTH)} ký tự.`;
  }
  return null;
}

/** Sends only the toggles that differ from the preset, so the server stays the source of preset values. */
export function toCreateInput(draft: ProjectSettingsDraft): CreateProjectInput {
  const preset = MODE_PRESETS[draft.mode];
  const overrides: Partial<AutomationSettings> = {};
  for (const key of SETTING_KEYS) {
    if (draft.automationSettings[key] !== preset[key]) overrides[key] = draft.automationSettings[key];
  }
  return {
    name: draft.name.trim(),
    mode: draft.mode,
    ...(Object.keys(overrides).length > 0 && { overrides }),
  };
}

export function isDirty(draft: ProjectSettingsDraft, project: Project): boolean {
  return (
    draft.name.trim() !== project.name ||
    draft.mode !== project.mode ||
    SETTING_KEYS.some((key) => draft.automationSettings[key] !== project.automationSettings[key])
  );
}
