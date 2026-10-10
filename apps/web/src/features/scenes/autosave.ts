// Debounced, serialized saving with no React in it, so the timing rules can be tested with fake timers.

export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export interface AutosaverOptions<T> {
  save: (value: T) => Promise<unknown>;
  onStatus: (status: AutosaveStatus) => void;
  delayMs?: number;
}

export interface Autosaver<T> {
  /** Records the latest value and restarts the debounce timer. */
  schedule: (value: T) => void;
  /** Saves the latest value now. Resolves false when that save failed. */
  flush: () => Promise<boolean>;
  /** True while a change is waiting or being written; used to warn before leaving the page. */
  hasUnsaved: () => boolean;
  dispose: () => void;
}

export const AUTOSAVE_DELAY_MS = 800;

export function createAutosaver<T>(options: AutosaverOptions<T>): Autosaver<T> {
  const delayMs = options.delayMs ?? AUTOSAVE_DELAY_MS;
  let pending: { value: T } | null = null;
  let inFlight: Promise<boolean> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  async function drain(): Promise<boolean> {
    // Only one request at a time: a stale save finishing after a newer one would overwrite it on disk.
    // No await sits between this check and assigning `inFlight`, so concurrent drains cannot both start.
    while (inFlight) await inFlight;
    const current = pending;
    if (!current) return true;
    pending = null;
    options.onStatus("saving");

    inFlight = options.save(current.value).then(
      () => {
        options.onStatus(pending ? "pending" : "saved");
        return true;
      },
      () => {
        // Keep the failed value for a retry unless the user has already made a newer change.
        pending ??= current;
        options.onStatus("error");
        return false;
      },
    );
    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  }

  return {
    schedule(value) {
      pending = { value };
      options.onStatus("pending");
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        void drain();
      }, delayMs);
    },
    flush() {
      clearTimer();
      return drain();
    },
    hasUnsaved: () => pending !== null || inFlight !== null,
    dispose: clearTimer,
  };
}
