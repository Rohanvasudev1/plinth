import { getAppDatabase } from "./db/app-database";
import { simulatedClock, type SimulatedClock } from "./simulated-clock";

/** When a new app database's simulated time begins: Monday 23 November 2026, 9am UTC. */
export const SIMULATION_START = new Date("2026-11-23T09:00:00Z");

let appClock: SimulatedClock | undefined;

/** The clock the app reads time from, created once per server process. */
export function getAppClock(): SimulatedClock {
  appClock ??= simulatedClock(getAppDatabase(), SIMULATION_START);
  return appClock;
}
