import fs from "node:fs";
import path from "node:path";
import { openDatabase, type Database } from "./database";

// Next.js can load this module more than once in one server process, so the open database lives on globalThis,
// where every copy sees the same one.
const shared = globalThis as { plinthAppDatabase?: Database };

function appDatabaseFile(): string {
  return process.env.PLINTH_DB_PATH ?? path.join(process.cwd(), "data", "plinth.db");
}

/** The app's one database, at PLINTH_DB_PATH or data/plinth.db, opened and migrated on first use. */
export function getAppDatabase(): Database {
  if (!shared.plinthAppDatabase) {
    const file = appDatabaseFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    shared.plinthAppDatabase = openDatabase(file);
  }
  return shared.plinthAppDatabase;
}

/** Closes the app's database and deletes its file, so the next `getAppDatabase()` opens a fresh one. */
export function deleteAppDatabase(): void {
  shared.plinthAppDatabase?.$client.close();
  shared.plinthAppDatabase = undefined;
  const file = appDatabaseFile();
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(file + suffix, { force: true });
}
