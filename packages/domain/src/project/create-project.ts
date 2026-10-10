import { z } from "zod";

import { DomainError } from "../errors";
import { newId, type DomainContext } from "../ids";
import { DEFAULT_CAPTION_STYLE, DEFAULT_PROJECT_STYLE, MODE_PRESETS } from "./presets";
import {
  AutomationModeSchema,
  AutomationSettingsSchema,
  PROJECT_SCHEMA_VERSION,
  type AutomationMode,
  type AutomationSettings,
  type Project,
} from "./schema";

export const PROJECT_NAME_MAX_LENGTH = 120;

/** Validates create requests from the client; shared by the API route and the form. */
export const CreateProjectInputSchema = z.object({
  name: z.string().trim().min(1).max(PROJECT_NAME_MAX_LENGTH),
  mode: AutomationModeSchema,
  overrides: z.strictObject(AutomationSettingsSchema.partial().shape).optional(),
});

export interface CreateProjectInput {
  name: string;
  mode: AutomationMode;
  /** Advanced settings that override the mode preset. */
  overrides?: Partial<AutomationSettings>;
}

export function createProject(input: CreateProjectInput, ctx: DomainContext = {}): Project {
  const name = input.name.trim();
  if (name === "") throw new DomainError("INVALID_INPUT", "Project name must not be empty");

  const automationSettings: AutomationSettings = { ...MODE_PRESETS[input.mode] };
  const overrides = input.overrides ?? {};
  for (const key of Object.keys(automationSettings) as (keyof AutomationSettings)[]) {
    const value = overrides[key];
    if (value !== undefined) automationSettings[key] = value;
  }

  const now = ctx.now ?? new Date().toISOString();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: (ctx.newId ?? newId)("prj"),
    name,
    mode: input.mode,
    automationSettings,
    width: 1080,
    height: 1920,
    fps: 30,
    script: "",
    scenes: [],
    assets: [],
    style: { ...DEFAULT_PROJECT_STYLE, captions: { ...DEFAULT_CAPTION_STYLE } },
    createdAt: now,
    updatedAt: now,
  };
}
