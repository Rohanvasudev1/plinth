import { getAppClock } from "./app-clock";
import { createBank, type Bank } from "./bank";
import { getAppDatabase } from "./db/app-database";

let appBank: Bank | undefined;

/** The bank the pages call, on the app database and simulated clock, seeded on first use. */
export function getAppBank(): Bank {
  appBank ??= createBank({ db: getAppDatabase(), clock: getAppClock() });
  return appBank;
}
