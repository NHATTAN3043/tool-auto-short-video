import { describe, expect, it } from "vitest";

import { KeyedLock } from "../shared/keyed-lock";
import { FakeClock, InMemoryJobQueue, InMemoryStorage } from "./fakes";

const job = (id: string, createdAt: string, projectId = "prj_1") => ({
  id,
  projectId,
  status: "QUEUED" as const,
  progress: 0,
  createdAt,
});

describe("KeyedLock", () => {
  it("serializes tasks per key and keeps going after a failure", async () => {
    const lock = new KeyedLock();
    const order: string[] = [];
    const slow = (label: string) => async () => {
      order.push(`start ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(`end ${label}`);
      return label;
    };
    const failing = lock.run("a", () => Promise.reject(new Error("boom")));
    const results = await Promise.all([lock.run("a", slow("1")), lock.run("a", slow("2"))]);
    await expect(failing).rejects.toThrow("boom");
    expect(results).toEqual(["1", "2"]);
    expect(order).toEqual(["start 1", "end 1", "start 2", "end 2"]);
  });

  it("runs different keys independently", async () => {
    const lock = new KeyedLock();
    const order: string[] = [];
    await Promise.all([
      lock.run("a", async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push("a");
      }),
      lock.run("b", () => {
        order.push("b");
        return Promise.resolve();
      }),
    ]);
    expect(order).toEqual(["b", "a"]);
  });
});

describe("InMemoryJobQueue", () => {
  it("claims the oldest queued job first and returns null when empty", async () => {
    const queue = new InMemoryJobQueue(new FakeClock("2026-05-01T00:00:00.000Z"));
    await queue.enqueue(job("job_b", "2026-01-02T00:00:00.000Z"));
    await queue.enqueue(job("job_a", "2026-01-01T00:00:00.000Z", "prj_2"));
    await expect(queue.enqueue(job("job_a", "2026-01-01T00:00:00.000Z"))).rejects.toMatchObject({
      code: "INVALID_OPERATION",
    });

    expect(await queue.claimNext()).toMatchObject({
      id: "job_a",
      status: "PROCESSING",
      startedAt: "2026-05-01T00:00:00.000Z",
    });
    expect((await queue.list({ projectId: "prj_1" })).map((j) => j.id)).toEqual(["job_b"]);
    expect((await queue.claimNext())?.id).toBe("job_b");
    expect(await queue.claimNext()).toBeNull();
    await expect(queue.get("job_x")).rejects.toMatchObject({ code: "JOB_NOT_FOUND" });
  });
});

describe("InMemoryStorage", () => {
  it("rejects keys that escape the root", async () => {
    const storage = new InMemoryStorage();
    expect(() => storage.resolvePath("../x")).toThrow();
    expect(() => storage.resolvePath("/etc/passwd")).toThrow();
    await expect(storage.exists("a")).resolves.toBe(false);
  });
});
