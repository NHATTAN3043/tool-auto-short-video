import type { RenderJob, Scene } from "@studio/domain";
import { describe, expect, it } from "vitest";

import { downloadName, isActive, isOutputJob, kindOf, slugify, upsertJob, warningMessages } from "./jobs";

const job = (id: string, status: RenderJob["status"] = "QUEUED"): RenderJob => ({
  id,
  projectId: "prj_1",
  status,
  progress: 0,
  createdAt: "2026-10-04T14:30:12.000Z",
});

const scene = (id: string): Scene => ({ id, narration: "x", status: "draft" });

describe("render panel rules", () => {
  it("knows which jobs still need polling", () => {
    expect(isActive(job("a", "QUEUED"))).toBe(true);
    expect(isActive(job("a", "PROCESSING"))).toBe(true);
    for (const status of ["COMPLETED", "FAILED", "CANCELLED"] as const)
      expect(isActive(job("a", status))).toBe(false);
  });

  it("updates a known job in place and puts a new one first", () => {
    const list = [job("b"), job("a")];
    expect(upsertJob(list, job("a", "COMPLETED")).map((j) => [j.id, j.status])).toEqual([
      ["b", "QUEUED"],
      ["a", "COMPLETED"],
    ]);
    expect(upsertJob(list, job("c")).map((j) => j.id)).toEqual(["c", "b", "a"]);
  });

  it("names downloads after the project, in ASCII", () => {
    expect(slugify("Video đầu tiên — Đà Lạt!")).toBe("video-dau-tien-da-lat");
    expect(slugify("???")).toBe("video");
    expect(downloadName("Video đầu tiên", job("a"), "mp4")).toBe("video-dau-tien-2026-10-04-1430.mp4");
    expect(downloadName("Video đầu tiên", job("a"), "srt")).toBe("video-dau-tien-2026-10-04-1430.srt");
    expect(downloadName("Video đầu tiên", job("a"), "zip")).toBe("video-dau-tien-2026-10-04-1430-capcut.zip");
  });

  it("keeps voice jobs out of the render panel", () => {
    expect(isOutputJob(job("a"))).toBe(true);
    expect(isOutputJob({ ...job("a"), kind: "capcut" })).toBe(true);
    expect(isOutputJob({ ...job("a"), kind: "tts", sceneIds: ["s"] })).toBe(false);
    expect(isOutputJob({ ...job("a"), kind: "ai" })).toBe(false);
  });

  it("treats jobs without a kind as video renders", () => {
    expect(kindOf(job("a"))).toBe("video");
    expect(kindOf({ ...job("a"), kind: "capcut" })).toBe("capcut");
  });

  it("explains warnings with scene numbers", () => {
    const scenes = [scene("a"), scene("b"), scene("c")];
    expect(
      warningMessages(
        [
          { code: "SCENE_WITHOUT_MEDIA", sceneIds: ["c", "a"] },
          { code: "VIDEO_TOO_LONG", durationMs: 200_400, limitMs: 180_000 },
        ],
        scenes,
      ),
    ).toEqual(["Cảnh 1, 3 chưa có media (sẽ hiện nền tối).", "Video dài 200 giây, quá 3 phút."]);
  });
});
