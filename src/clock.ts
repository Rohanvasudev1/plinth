/**
 * The only way code reads the current time, so tests can pin it.
 * Each call to `now()` returns a new Date that the caller may mutate.
 */
export interface Clock {
  now(): Date;
}

/** A clock that only moves when told to, such as the app's simulated clock. */
export interface SettableClock extends Clock {
  /** Moves the clock to `at`. */
  setTo(at: Date): void;
}

/** A clock for tests that reports `at` until `setTo` moves it. */
export function fixedClock(at: Date): SettableClock {
  let millis = at.getTime();
  return {
    now: () => new Date(millis),
    setTo(next) {
      millis = next.getTime();
    },
  };
}
