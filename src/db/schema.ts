import { integer, sqliteTable } from "drizzle-orm/sqlite-core";

/** The app's simulated time. It holds at most one row, with id 1. */
export const simulatedClockTable = sqliteTable("simulated_clock", {
  id: integer("id").primaryKey(),
  nowMs: integer("now_ms").notNull(),
});
