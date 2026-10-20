/** `ols` = a scene of a Full AI outline draft (ADR 0015), before it becomes a real scene. */
export type IdPrefix = "prj" | "scn" | "ast" | "job" | "sfx" | "lib" | "use" | "ols";

export type IdGenerator = (prefix: IdPrefix) => string;

// globalThis.crypto exists in Node 22 and every browser, so the domain stays free of node imports.
export const newId: IdGenerator = (prefix) => `${prefix}_${globalThis.crypto.randomUUID()}`;

/** Lets callers (mostly tests) make id and time generation deterministic. */
export interface DomainContext {
  newId?: IdGenerator;
  now?: string;
}
