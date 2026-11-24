import { getAppBank } from "@/app-bank";
import { endToEndResetEnabled } from "@/e2e-reset";

/**
 * Moves the simulated clock straight to the time in the body, `{ "at": "2027-05-23T13:00:00Z" }`, posting nothing on
 * the dates it skips, so an end-to-end test can reach a date months away, such as a Consent's end. Like the reset
 * route, it answers 404 unless the app runs for end-to-end tests (PLINTH_E2E=1, never a production build).
 */
export async function POST(request: Request): Promise<Response> {
  if (!endToEndResetEnabled()) return new Response(null, { status: 404 });
  const body: unknown = await request.json().catch(() => null);
  const at = typeof body === "object" && body !== null && "at" in body && typeof body.at === "string" ? new Date(body.at) : null;
  if (at === null || Number.isNaN(at.getTime())) return new Response("Send { \"at\": <an ISO 8601 time> }", { status: 400 });
  getAppBank().clock.setTo(at);
  return new Response(null, { status: 204 });
}
