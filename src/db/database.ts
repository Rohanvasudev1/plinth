import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type Database = BetterSQLite3Database<typeof schema>;

const migrationsFolder = path.join(process.cwd(), "drizzle");

/** Opens the SQLite file at `file`, creating it if needed, and applies every pending migration. */
export function openDatabase(file: string): Database {
  const sqlite = new BetterSqlite3(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return db;
}

/** Opens a fresh, fully migrated in-memory database that no other test shares. */
export function openTestDatabase(): Database {
  return openDatabase(":memory:");
}
