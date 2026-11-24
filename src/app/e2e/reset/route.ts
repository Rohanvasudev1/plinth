import { endToEndResetEnabled, restoreSeed } from "@/e2e-reset";

/**
 * Restores the seed and the simulated clock, so each end-to-end test starts from the same state.
 * Playwright starts the app with PLINTH_E2E=1. In any other run, the route answers 404 as if it weren't there.
 */
export async function POST(): Promise<Response> {
  if (!endToEndResetEnabled()) return new Response(null, { status: 404 });
  restoreSeed();
  return new Response(null, { status: 204 });
}
