import { getAppClock } from "./app-clock";
import { createBank, type Bank } from "./bank";
import { getAppDatabase } from "./db/app-database";
import type { Database } from "./db/database";
import { chooseMissionModel } from "./anthropic-mission-model";

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
    // The Anthropic SDK adapter when ANTHROPIC_API_KEY is set, outside the end-to-end suite; the fake otherwise.
    const { model: missionModel } = chooseMissionModel({ env: process.env, clock, fakeToolCallDelayMs: APP_FAKE_TOOL_CALL_MS });
    appBank = { db, bank: createBank({ db, clock, missionModel }) };
  }
  return appBank.bank;
}
