export interface Clock {
  /** Current time as an ISO 8601 string. */
  now(): string;
}

export const systemClock: Clock = { now: () => new Date().toISOString() };
