/**
 * The only way code reads the current time, so tests can pin it.
 * Each call to `now()` returns a new Date that the caller may mutate.
 */
export interface Clock {
  now(): Date;
}

/** A clock for tests that always reports `at`. */
export function fixedClock(at: Date): Clock {
  const millis = at.getTime();
  return { now: () => new Date(millis) };
}
