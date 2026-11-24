import { getAppBank } from "@/app-bank";
import { endToEndResetEnabled } from "@/e2e-reset";
import { AUTONOMY_LEVELS, type AutonomyLevel } from "@/settings";

/**
 * Sets a seeded customer's Autonomy level, so an end-to-end test can set up the state it needs before the
 * Setup survey can change it. The body is `{ "customer": "<name>", "autonomyLevel": "<level>" }`. Like the reset
 * route, it answers 404 unless the app runs for end-to-end tests.
 */
export async function POST(request: Request): Promise<Response> {
  if (!endToEndResetEnabled()) return new Response(null, { status: 404 });
  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null) return new Response(null, { status: 400 });
  const { customer: name, autonomyLevel } = body as Record<string, unknown>;
  const bank = getAppBank();
  const customer = bank.listCustomers().find((candidate) => candidate.name === name);
  if (!customer || !(AUTONOMY_LEVELS as readonly unknown[]).includes(autonomyLevel)) {
    return new Response(null, { status: 400 });
  }
  bank.changeSettings(customer, { autonomyLevel: autonomyLevel as AutonomyLevel });
  return new Response(null, { status: 204 });
}
