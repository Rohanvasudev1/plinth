import { getAppClock } from "./app-clock";
import { createBank, type Bank } from "./bank";
import { getAppDatabase } from "./db/app-database";
import type { Database } from "./db/database";
import { createFakeMissionModel } from "./fake-mission-model";

/**
 * How long the fake model waits before each tool call in the app, so Discoveries shows a running Mission's progress.
 * Tests call the bank directly and don't wait.
 */
const APP_FAKE_TOOL_CALL_MS = 700;

let appBank: { db: Database; bank: Bank } | undefined;

/** The bank the pages call, on the app database and simulated clock, seeded when the database is new. */
export function getAppBank(): Bank {
  const db = getAppDatabase();
  if (appBank?.db !== db) {
    const clock = getAppClock();
    // The Anthropic SDK adapter (#58) takes over when ANTHROPIC_API_KEY is set; until then every Mission runs on the fake.
    const missionModel = createFakeMissionModel({ clock, toolCallDelayMs: APP_FAKE_TOOL_CALL_MS });
    appBank = { db, bank: createBank({ db, clock, missionModel }) };
  }
  return appBank.bank;
}
