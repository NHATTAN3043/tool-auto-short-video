import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAutosaver, type AutosaveStatus } from "./autosave";

interface Deferred {
  resolve: () => void;
  reject: (error: Error) => void;
}

/** A save function whose calls stay open until the test settles them. */
function controlledSave() {
  const calls: { value: string; deferred: Deferred }[] = [];
  const save = (value: string) =>
    new Promise<void>((resolve, reject) => {
      calls.push({ value, deferred: { resolve, reject } });
    });
  return { calls, save };
}

describe("createAutosaver", () => {
  let statuses: AutosaveStatus[] = [];
  const onStatus = (status: AutosaveStatus) => statuses.push(status);

  beforeEach(() => {
    vi.useFakeTimers();
    statuses = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves once with the latest value after the debounce delay", async () => {
    const { calls, save } = controlledSave();
    const saver = createAutosaver({ save, onStatus, delayMs: 800 });
    saver.schedule("a");
    await vi.advanceTimersByTimeAsync(500);
    saver.schedule("ab");
    await vi.advanceTimersByTimeAsync(799);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.map((c) => c.value)).toEqual(["ab"]);

    calls[0]?.deferred.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses.at(-1)).toBe("saved");
    expect(saver.hasUnsaved()).toBe(false);
  });

  it("never runs two saves at once and saves changes made during a save", async () => {
    const { calls, save } = controlledSave();
    const saver = createAutosaver({ save, onStatus, delayMs: 800 });
    saver.schedule("v1");
    await vi.advanceTimersByTimeAsync(800);
    saver.schedule("v2");
    await vi.advanceTimersByTimeAsync(800);
    expect(calls.map((c) => c.value)).toEqual(["v1"]);
    expect(saver.hasUnsaved()).toBe(true);

    calls[0]?.deferred.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.map((c) => c.value)).toEqual(["v1", "v2"]);
    calls[1]?.deferred.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses.at(-1)).toBe("saved");
  });

  it("keeps a failed value for a retry", async () => {
    const { calls, save } = controlledSave();
    const saver = createAutosaver({ save, onStatus, delayMs: 800 });
    saver.schedule("v1");
    await vi.advanceTimersByTimeAsync(800);
    calls[0]?.deferred.reject(new Error("offline"));
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses.at(-1)).toBe("error");
    expect(saver.hasUnsaved()).toBe(true);

    const retry = saver.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.map((c) => c.value)).toEqual(["v1", "v1"]);
    calls[1]?.deferred.resolve();
    await expect(retry).resolves.toBe(true);
    expect(statuses.at(-1)).toBe("saved");
  });

  it("does not resend a failed value once a newer change exists", async () => {
    const { calls, save } = controlledSave();
    const saver = createAutosaver({ save, onStatus, delayMs: 800 });
    saver.schedule("v1");
    await vi.advanceTimersByTimeAsync(800);
    saver.schedule("v2");
    calls[0]?.deferred.reject(new Error("500"));
    await vi.advanceTimersByTimeAsync(800);
    expect(calls.map((c) => c.value)).toEqual(["v1", "v2"]);
  });

  it("flush saves immediately and reports failure", async () => {
    const { calls, save } = controlledSave();
    const saver = createAutosaver({ save, onStatus, delayMs: 800 });
    saver.schedule("now");
    const result = saver.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.map((c) => c.value)).toEqual(["now"]);
    calls[0]?.deferred.reject(new Error("boom"));
    await expect(result).resolves.toBe(false);

    // The cancelled debounce timer must not fire a second request.
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(1);
  });

  it("flush with nothing pending resolves without saving", async () => {
    const { calls, save } = controlledSave();
    const saver = createAutosaver({ save, onStatus });
    await expect(saver.flush()).resolves.toBe(true);
    expect(calls).toHaveLength(0);
    expect(statuses).toEqual([]);
  });
});
