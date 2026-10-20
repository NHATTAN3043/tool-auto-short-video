import { z } from "zod";

// `.env` files often contain `KEY=` for unused options; treat an empty value as "not set".
const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);
const optionalPostgresUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z
    .string()
    .regex(/^postgres(ql)?:\/\/\S+$/u, "must be a postgres:// or postgresql:// connection URL")
    .optional(),
);
/** A USD budget default: empty → `fallback`, "none" → no limit (null), otherwise a non-negative number. */
const budgetWithDefault = (fallback: number) =>
  z.preprocess(
    (value) => (value === "" || value === undefined ? fallback : value === "none" ? null : value),
    z.coerce.number().nonnegative().nullable(),
  );
const stringWithDefault = (fallback: string) =>
  z.preprocess((value) => (value === "" ? undefined : value), z.string().min(1).default(fallback));

export const EnvSchema = z.object({
  /** Root for projects/, jobs/ and the shared library. */
  STUDIO_STORAGE_DIR: stringWithDefault("./storage"),
  STUDIO_FFMPEG_PATH: stringWithDefault("ffmpeg"),
  STUDIO_FFPROBE_PATH: stringWithDefault("ffprobe"),
  STUDIO_BROWSER_EXECUTABLE: optionalString,
  /** Skills offered to Full AI and rewrites (ADR 0012), one folder each with a SKILL.md. */
  STUDIO_SKILLS_DIR: stringWithDefault("./.claude/skills"),
  /** Largest accepted upload, in megabytes. */
  STUDIO_MAX_UPLOAD_MB: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().positive().default(1024),
  ),
  /** ElevenLabs TTS (M8). Unset → voice generation is hidden; Manual mode needs no key. */
  ELEVENLABS_API_KEY: optionalString,
  /** Voice preselected for projects that have not chosen one yet. */
  ELEVENLABS_DEFAULT_VOICE_ID: optionalString,
  ELEVENLABS_DEFAULT_MODEL_ID: stringWithDefault("eleven_flash_v2_5"),
  /** Plan price of one credit, for cost estimates: 6 USD / 10 000 credits = 0.0006. */
  ELEVENLABS_USD_PER_CREDIT: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().positive().default(0.0006),
  ),
  /** Claude API (M9). Unset → AI suggestions are hidden; Manual mode needs no key. */
  ANTHROPIC_API_KEY: optionalString,
  AI_MODEL: stringWithDefault("claude-sonnet-5-5"),
  /**
   * Default budgets for every paid call (AI and TTS), in USD, until they are saved on the settings page
   * (M11, ADR 0009). "none" = no limit; "0" blocks every paid call.
   */
  BUDGET_MAX_USD_PER_CALL: budgetWithDefault(0.5),
  /** Rolling 24 hours. */
  BUDGET_MAX_USD_PER_DAY: budgetWithDefault(2),
  /** Calendar month, Vietnam time. */
  BUDGET_MAX_USD_PER_MONTH: budgetWithDefault(20),
  /** All-time spend of each project. */
  BUDGET_MAX_USD_PER_PROJECT: budgetWithDefault(1),
  /** Free stock media (M10). Each unset key hides that provider; the shared library works without keys. */
  PEXELS_API_KEY: optionalString,
  PIXABAY_API_KEY: optionalString,
  /** Postgres connection (ADR 0005). Unset → projects, jobs and the library stay in JSON files. */
  DATABASE_URL: optionalPostgresUrl,
  /** Tests only: a server where the Postgres adapter tests may create and drop temporary databases. */
  TEST_DATABASE_URL: optionalPostgresUrl,
});
export type Env = z.infer<typeof EnvSchema>;

/** Validates the environment at startup and fails fast with every problem listed. Server-side only. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  return result.data;
}

/** The budget defaults of the environment, in the shape of the domain's BudgetLimits. */
export function budgetDefaults(env: Env): {
  perCallUsd: number | null;
  perDayUsd: number | null;
  perMonthUsd: number | null;
  perProjectUsd: number | null;
} {
  return {
    perCallUsd: env.BUDGET_MAX_USD_PER_CALL,
    perDayUsd: env.BUDGET_MAX_USD_PER_DAY,
    perMonthUsd: env.BUDGET_MAX_USD_PER_MONTH,
    perProjectUsd: env.BUDGET_MAX_USD_PER_PROJECT,
  };
}
