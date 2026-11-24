import { deleteAppDatabase } from "@/db/app-database";
import { endToEndResetEnabled } from "@/e2e-reset";

/**
 * Restores the seed and the simulated clock, so each end-to-end test starts from the same state. The ledger is
 * append-only (ADR 0001), so this replaces the whole database: the next request opens a fresh one, seeds it and
 * starts the clock at the simulation start. Playwright starts the app with PLINTH_E2E=1. In any other run, the
 * route answers 404 as if it weren't there.
 */
export async function POST(): Promise<Response> {
  if (!endToEndResetEnabled()) return new Response(null, { status: 404 });
  deleteAppDatabase();
  return new Response(null, { status: 204 });
}
