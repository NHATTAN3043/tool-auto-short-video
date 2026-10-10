import { describe, expect, it } from "vitest";

import { loadEnv } from "./env";

describe("loadEnv", () => {
  it("applies defaults and treats empty values as unset", () => {
    expect(loadEnv({ STUDIO_BROWSER_EXECUTABLE: "", STUDIO_STORAGE_DIR: "" })).toEqual({
      STUDIO_STORAGE_DIR: "./storage",
      STUDIO_FFMPEG_PATH: "ffmpeg",
      STUDIO_FFPROBE_PATH: "ffprobe",
      STUDIO_MAX_UPLOAD_MB: 1024,
      ELEVENLABS_DEFAULT_MODEL_ID: "eleven_flash_v2_5",
      ELEVENLABS_USD_PER_CREDIT: 0.0006,
      AI_MODEL: "claude-sonnet-5-5",
      BUDGET_MAX_USD_PER_CALL: 0.5,
      BUDGET_MAX_USD_PER_DAY: 2,
      BUDGET_MAX_USD_PER_MONTH: 20,
      BUDGET_MAX_USD_PER_PROJECT: 1,
    });
  });

  it("reads provided values", () => {
    expect(
      loadEnv({
        STUDIO_STORAGE_DIR: "/data",
        STUDIO_FFMPEG_PATH: "C:/ffmpeg/bin/ffmpeg.exe",
        STUDIO_FFPROBE_PATH: "C:/ffmpeg/bin/ffprobe.exe",
        STUDIO_BROWSER_EXECUTABLE: "/usr/bin/chromium",
        STUDIO_MAX_UPLOAD_MB: "200",
        UNRELATED: "x",
      }),
    ).toEqual({
      STUDIO_STORAGE_DIR: "/data",
      STUDIO_FFMPEG_PATH: "C:/ffmpeg/bin/ffmpeg.exe",
      STUDIO_FFPROBE_PATH: "C:/ffmpeg/bin/ffprobe.exe",
      STUDIO_BROWSER_EXECUTABLE: "/usr/bin/chromium",
      STUDIO_MAX_UPLOAD_MB: 200,
      ELEVENLABS_DEFAULT_MODEL_ID: "eleven_flash_v2_5",
      ELEVENLABS_USD_PER_CREDIT: 0.0006,
      AI_MODEL: "claude-sonnet-5-5",
      BUDGET_MAX_USD_PER_CALL: 0.5,
      BUDGET_MAX_USD_PER_DAY: 2,
      BUDGET_MAX_USD_PER_MONTH: 20,
      BUDGET_MAX_USD_PER_PROJECT: 1,
    });
  });

  it("rejects an invalid upload limit", () => {
    expect(() => loadEnv({ STUDIO_MAX_UPLOAD_MB: "lots" })).toThrow(/STUDIO_MAX_UPLOAD_MB/u);
    expect(() => loadEnv({ STUDIO_MAX_UPLOAD_MB: "0" })).toThrow(/STUDIO_MAX_UPLOAD_MB/u);
  });

  it("accepts Postgres URLs and treats empty ones as unset", () => {
    const env = loadEnv({
      DATABASE_URL: "postgres://studio:secret@localhost:5432/shorts_studio",
      TEST_DATABASE_URL: "",
    });
    expect(env.DATABASE_URL).toBe("postgres://studio:secret@localhost:5432/shorts_studio");
    expect(env.TEST_DATABASE_URL).toBeUndefined();
    expect(loadEnv({ DATABASE_URL: "postgresql://localhost/db" }).DATABASE_URL).toBe(
      "postgresql://localhost/db",
    );
  });

  it("reads ElevenLabs settings and treats an empty key as unset", () => {
    const env = loadEnv({
      ELEVENLABS_API_KEY: "sk_1",
      ELEVENLABS_DEFAULT_VOICE_ID: "voice",
      ELEVENLABS_DEFAULT_MODEL_ID: "eleven_v3",
      ELEVENLABS_USD_PER_CREDIT: "0.0005",
    });
    expect(env).toMatchObject({
      ELEVENLABS_API_KEY: "sk_1",
      ELEVENLABS_DEFAULT_VOICE_ID: "voice",
      ELEVENLABS_DEFAULT_MODEL_ID: "eleven_v3",
      ELEVENLABS_USD_PER_CREDIT: 0.0005,
    });
    expect(loadEnv({ ELEVENLABS_API_KEY: "" }).ELEVENLABS_API_KEY).toBeUndefined();
    expect(() => loadEnv({ ELEVENLABS_USD_PER_CREDIT: "free" })).toThrow(/ELEVENLABS_USD_PER_CREDIT/u);
  });

  it("reads the Claude settings", () => {
    expect(loadEnv({ ANTHROPIC_API_KEY: "sk-ant-1", AI_MODEL: "claude-haiku-4-5" })).toMatchObject({
      ANTHROPIC_API_KEY: "sk-ant-1",
      AI_MODEL: "claude-haiku-4-5",
    });
    expect(loadEnv({ ANTHROPIC_API_KEY: "" }).ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("reads budget defaults: a number, none for no limit, 0 to block", () => {
    expect(
      loadEnv({
        BUDGET_MAX_USD_PER_CALL: "0.25",
        BUDGET_MAX_USD_PER_DAY: "none",
        BUDGET_MAX_USD_PER_MONTH: "0",
        BUDGET_MAX_USD_PER_PROJECT: "",
      }),
    ).toMatchObject({
      BUDGET_MAX_USD_PER_CALL: 0.25,
      BUDGET_MAX_USD_PER_DAY: null,
      BUDGET_MAX_USD_PER_MONTH: 0,
      BUDGET_MAX_USD_PER_PROJECT: 1,
    });
    expect(() => loadEnv({ BUDGET_MAX_USD_PER_DAY: "-1" })).toThrow(/BUDGET_MAX_USD_PER_DAY/u);
    expect(() => loadEnv({ BUDGET_MAX_USD_PER_MONTH: "lots" })).toThrow(/BUDGET_MAX_USD_PER_MONTH/u);
  });

  it("rejects a database URL that is not Postgres", () => {
    expect(() => loadEnv({ DATABASE_URL: "mysql://localhost/db" })).toThrow(/DATABASE_URL/u);
  });

  it("reads process.env by default", () => {
    expect(loadEnv().STUDIO_FFMPEG_PATH.length).toBeGreaterThan(0);
  });
});
