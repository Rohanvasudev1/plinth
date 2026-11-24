import { getAppClock } from "./app-clock";
import { createBank, type Bank } from "./bank";
import { getAppDatabase } from "./db/app-database";
import type { Database } from "./db/database";

let appBank: { db: Database; bank: Bank } | undefined;

/** The bank the pages call, on the app database and simulated clock, seeded when the database is new. */
export function getAppBank(): Bank {
  const db = getAppDatabase();
  if (appBank?.db !== db) appBank = { db, bank: createBank({ db, clock: getAppClock() }) };
  return appBank.bank;
}
