import { createProject, CreateProjectInputSchema, MODE_PRESETS } from "@studio/domain";
import { describe, expect, it } from "vitest";

import {
  draftFromProject,
  isCustomized,
  isDirty,
  nameError,
  newDraft,
  selectMode,
  SETTING_KEYS,
  toCreateInput,
  toggleSetting,
} from "./model";

describe("project form model", () => {
  it("starts from the manual preset and lists every toggle once", () => {
    expect(newDraft()).toEqual({ name: "", mode: "manual", automationSettings: MODE_PRESETS.manual });
    expect([...SETTING_KEYS].sort()).toEqual(Object.keys(MODE_PRESETS.manual).sort());
  });

  it("applies the preset when the mode changes, discarding custom toggles", () => {
    const custom = toggleSetting(newDraft(), "mediaSearch", true);
    expect(isCustomized(custom)).toBe(true);
    const assisted = selectMode(custom, "assisted");
    expect(assisted.automationSettings).toEqual(MODE_PRESETS.assisted);
    expect(isCustomized(assisted)).toBe(false);
  });

  it("does not share preset objects with drafts", () => {
    const draft = newDraft("full_ai");
    draft.automationSettings.mediaSearch = false;
    expect(MODE_PRESETS.full_ai.mediaSearch).toBe(true);
  });

  it("sends only toggles that differ from the preset", () => {
    const draft = toggleSetting(
      { ...selectMode(newDraft(), "assisted"), name: "  Video  " },
      "voiceGeneration",
      false,
    );
    const input = toCreateInput(draft);
    expect(input).toEqual({ name: "Video", mode: "assisted", overrides: { voiceGeneration: false } });
    expect(CreateProjectInputSchema.parse(input)).toEqual(input);
    expect(toCreateInput({ ...newDraft(), name: "A" })).toEqual({ name: "A", mode: "manual" });
  });

  it("validates the name in Vietnamese", () => {
    expect(nameError("  ")).toBe("Hãy đặt tên cho dự án.");
    expect(nameError("x".repeat(121))).toMatch(/120/u);
    expect(nameError(" Video ")).toBeNull();
  });

  it("tracks unsaved changes against the saved project", () => {
    const project = createProject({ name: "A", mode: "manual" });
    const draft = draftFromProject(project);
    expect(isDirty(draft, project)).toBe(false);
    expect(isDirty({ ...draft, name: " A " }, project)).toBe(false);
    expect(isDirty({ ...draft, name: "B" }, project)).toBe(true);
    expect(isDirty(selectMode(draft, "full_ai"), project)).toBe(true);
    expect(isDirty(toggleSetting(draft, "mediaSearch", true), project)).toBe(true);
  });
});
