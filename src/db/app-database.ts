import fs from "node:fs";
import path from "node:path";
import { openDatabase, type Database } from "./database";

let appDatabase: Database | undefined;

/** The app's one database, at PLINTH_DB_PATH or data/plinth.db, opened and migrated on first use. */
export function getAppDatabase(): Database {
  if (!appDatabase) {
    const file = process.env.PLINTH_DB_PATH ?? path.join(process.cwd(), "data", "plinth.db");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    appDatabase = openDatabase(file);
  }
  return appDatabase;
}
