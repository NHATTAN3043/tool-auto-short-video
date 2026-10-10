import { describe, expect, it } from "vitest";

import { ACCEPT_ATTRIBUTE, nextUpload, rejectReason, uploadsReducer, type UploadItem } from "./uploads";

const add = (items: UploadItem[], ...names: string[]) =>
  uploadsReducer(items, {
    type: "add",
    files: names.map((fileName, i) => ({ id: `u${String(items.length + i)}`, fileName, size: 10 })),
  });

describe("upload queue", () => {
  it("queues accepted files and fails unsupported ones immediately", () => {
    const items = add([], "a.mp4", "virus.exe", "b.PNG");
    expect(items.map((i) => i.status)).toEqual(["queued", "error", "queued"]);
    expect(items[1]?.error).toMatch(/Định dạng không hỗ trợ/u);
  });

  it("sends files one at a time, in order", () => {
    let items = add([], "a.mp4", "b.mp3");
    expect(nextUpload(items)?.fileName).toBe("a.mp4");
    items = uploadsReducer(items, { type: "start", id: "u0" });
    expect(nextUpload(items)).toBeNull();
    items = uploadsReducer(items, { type: "progress", id: "u0", fraction: 1.4 });
    expect(items[0]?.progress).toBe(1);
    items = uploadsReducer(items, { type: "done", id: "u0" });
    expect(nextUpload(items)?.fileName).toBe("b.mp3");
    items = uploadsReducer(items, { type: "fail", id: "u1", error: "File quá lớn" });
    expect(nextUpload(items)).toBeNull();
    expect(uploadsReducer(items, { type: "clearFinished" })).toEqual([]);
  });

  it("builds the file input accept list from the domain", () => {
    expect(ACCEPT_ATTRIBUTE).toContain(".mp4");
    expect(ACCEPT_ATTRIBUTE).toContain(".m4a");
    expect(rejectReason("x.webp")).toBeNull();
  });
});
