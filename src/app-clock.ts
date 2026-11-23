import { getAppDatabase } from "./db/app-database";
import { simulatedClock, type SimulatedClock } from "./simulated-clock";

/** When a new app database's simulated time begins: Thursday 19 November 2026, 9am in New York (EST). */
export const SIMULATION_START = new Date("2026-11-19T14:00:00Z");

/** The time zone the app shows dates and times in. */
export const DISPLAY_TIME_ZONE = "America/New_York";

let appClock: SimulatedClock | undefined;

/** The clock the app reads time from, created once per server process. */
export function getAppClock(): SimulatedClock {
  appClock ??= simulatedClock(getAppDatabase(), SIMULATION_START);
  return appClock;
}
