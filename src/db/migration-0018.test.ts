import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it } from "vitest";

// 0018 rebuilds the decisions table to let a Mission's entry lose its link once Close and delete deletes the Mission,
// and adds the closed marker to customers. Both tables hold rows on any database in use.

const MIGRATIONS = path.join(process.cwd(), "drizzle");
let folders: string[] = [];

/** A copy of the migrations folder holding only the migrations before `tag`. */
function migrationsBefore(tag: string): string {
  const folder = mkdtempSync(path.join(tmpdir(), "plinth-migrations-"));
  folders.push(folder);
  cpSync(MIGRATIONS, folder, { recursive: true });
  const journalFile = path.join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalFile, "utf8")) as { entries: { tag: string }[] };
  const index = journal.entries.findIndex((entry) => entry.tag === tag);
  writeFileSync(journalFile, JSON.stringify({ ...journal, entries: journal.entries.slice(0, index) }));
  return folder;
}

afterEach(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
  folders = [];
});

describe("migration 0018_close_and_delete", () => {
  it("keeps every Decision log entry, its links and the customers, who start open", () => {
    const sqlite = new BetterSqlite3(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: migrationsBefore("0018_close_and_delete") });
    sqlite.exec(`
      INSERT INTO customers (id, name) VALUES (1, 'Test Customer');
      INSERT INTO rules (id, customer_id, kind) VALUES (1, 1, 'buffer');
      INSERT INTO missions (id, customer_id, question, state, progress_label, read_list, started_at_ms, ended_at_ms)
        VALUES (1, 1, 'Where did my money go?', 'stopped', 'Reading transactions', '[]', 1000, 2000);
      INSERT INTO decisions (id, customer_id, created_at_ms, actor, trigger_description, rule_id, rule_version, action,
        amount_cents, result, why)
        VALUES (1, 1, 1000, 'agent', 'Paycheck', 1, 1, 'Moved $340', 34000, 'Done', '[]');
      INSERT INTO decisions (id, customer_id, created_at_ms, actor, trigger_description, action, amount_cents, result,
        why, reverses_decision_id)
        VALUES (2, 1, 1500, 'customer', 'You undid it', 'Undid', 34000, 'Reversed', '[]', 1);
      INSERT INTO decisions (id, customer_id, created_at_ms, actor, trigger_description, action, amount_cents, result,
        why, mission_id)
        VALUES (3, 1, 2000, 'agent', 'Mission', 'Stopped your Mission', 0, 'Stopped', '[{"label":"Trigger","value":"x"}]', 1);
    `);
    const before = sqlite.prepare("SELECT * FROM decisions ORDER BY id").all();

    migrate(db, { migrationsFolder: MIGRATIONS });

    expect(sqlite.prepare("SELECT * FROM decisions ORDER BY id").all()).toEqual(before);
    expect(sqlite.prepare("SELECT id, name, closed_at_ms FROM customers").all()).toEqual([
      { id: 1, name: "Test Customer", closed_at_ms: null },
    ]);
    // A Mission's entry may now lose its link; an agent action under a Rule still may not.
    sqlite.exec("UPDATE decisions SET mission_id = NULL WHERE id = 3");
    expect(() => sqlite.exec("UPDATE decisions SET rule_id = NULL, rule_version = NULL WHERE id = 1")).toThrow(/CHECK/);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    const table = sqlite.prepare("SELECT sql FROM sqlite_master WHERE name = 'decisions'").get() as { sql: string };
    expect(table.sql).toMatch(/FOREIGN KEY \(`reverses_decision_id`\) REFERENCES `?"?decisions"?`?\(`id`\)/);
    expect(table.sql).not.toContain("__new_decisions");
  });
});
