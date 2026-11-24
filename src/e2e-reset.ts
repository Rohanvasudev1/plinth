/**
 * True only when the app runs for end-to-end tests: PLINTH_E2E=1 and never a production build.
 * The reset route answers 404 otherwise.
 */
export function endToEndResetEnabled(): boolean {
  return process.env.PLINTH_E2E === "1" && process.env.NODE_ENV !== "production";
}
