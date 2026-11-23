import { eq } from "drizzle-orm";
import type { Clock } from "./clock";
import type { Database } from "./db/database";
import { simulatedClock as simulatedClockTable } from "./db/schema";

const ROW_ID = 1;

export interface SimulatedClock extends Clock {
  /** Moves the simulated time to `at` for everyone who reads this database. */
  setTo(at: Date): void;
}

/**
 * The app's clock. Its time lives in the database so every request sees the same moment,
 * and it only moves when `setTo` is called. A database with no stored time starts at `start`.
 */
export function simulatedClock(db: Database, options: { start: Date }): SimulatedClock {
  db.insert(simulatedClockTable)
    .values({ id: ROW_ID, nowMs: options.start.getTime() })
    .onConflictDoNothing()
    .run();

  return {
    now() {
      const row = db
        .select({ nowMs: simulatedClockTable.nowMs })
        .from(simulatedClockTable)
        .where(eq(simulatedClockTable.id, ROW_ID))
        .get();
      if (!row) throw new Error("The simulated clock row is missing");
      return new Date(row.nowMs);
    },
    setTo(at) {
      db.update(simulatedClockTable)
        .set({ nowMs: at.getTime() })
        .where(eq(simulatedClockTable.id, ROW_ID))
        .run();
    },
  };
}
