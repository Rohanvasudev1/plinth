import { getAppDatabase } from "./db/app-database";
import { simulatedClock, type SimulatedClock } from "./simulated-clock";

/** When a new app database's simulated time begins: Monday 23 November 2026, 9am UTC. */
export const SIMULATION_START = new Date("2026-11-23T09:00:00Z");

/** The clock the app reads time from. */
export function getAppClock(): SimulatedClock {
  return simulatedClock(getAppDatabase(), { start: SIMULATION_START });
}
