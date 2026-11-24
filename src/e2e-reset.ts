import { deleteAppDatabase } from "./db/app-database";

/**
 * Puts the app back to the seed and the simulation start time, for end-to-end tests only. The ledger is
 * append-only (ADR 0001), so this replaces the whole database: the next request opens a fresh one and seeds it.
 */
export function restoreSeed(): void {
  deleteAppDatabase();
}

/** True only when the app runs for end-to-end tests: PLINTH_E2E=1 and never a production build. */
export function endToEndResetEnabled(): boolean {
  return process.env.PLINTH_E2E === "1" && process.env.NODE_ENV !== "production";
}
