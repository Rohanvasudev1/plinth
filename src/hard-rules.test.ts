import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Mechanical checks for the hard rules in CLAUDE.md and ADR 0004. Each rule lists the files allowed to break it.

const SRC = path.join(__dirname);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const files = sourceFiles(SRC).map((file) => ({
  name: path.relative(SRC, file),
  text: readFileSync(file, "utf8"),
}));

const rules = [
  {
    rule: "reads the current time only through the Clock interface",
    pattern: /Date\.now\(|new Date\(\s*\)/,
    allowed: [] as string[],
  },
  {
    rule: "keeps money in integer cents, with no floating-point parsing or formatting",
    pattern: /parseFloat\(|\.toFixed\(/,
    allowed: [],
  },
  {
    rule: "touches database tables only inside the data-access layer (ADR 0004)",
    pattern: /from ["'](\.\/|\.\.\/|@\/)*db\/schema["']/,
    allowed: ["customer-data.ts", "system-data.ts", "simulated-clock.ts", path.join("db", "database.ts")],
  },
  {
    rule: "changes customer choices only in the modules that also write the Decision log entry (ADR 0007)",
    pattern: /customerData\.(reviseRule|createRule|saveSettings|savePause|setGoalTarget)\(/,
    allowed: ["rule-changes.ts", "settings-changes.ts", "goal-changes.ts", "pause.ts", "setup.ts", "seed.ts"],
  },
  {
    rule: "links, renews and unlinks Linked accounts only in the module that also writes the Decision log entry",
    pattern: /customerData\.(createLinkedAccount|saveConsent|deleteLinkedAccount)\(/,
    allowed: ["linked-account-changes.ts"],
  },
  {
    rule: "writes negative amounts with formatDollars, never a hand-typed minus sign (U+2212)",
    pattern: /\u2212/,
    allowed: [],
  },
];

/**
 * ADR 0010: an action that writes a Decision log entry, a Finding or a Mission ending also writes its own access log
 * entry. The exceptions record only a change the customer made, which is not a read by someone else; the seed; and
 * the sweep module, which both the buffer agent and a picked Move call, so the buffer agent writes the sweep check's
 * entry. The closure module is not an exception.
 */
const RECORDS_AN_ACTION = /customerData\.(recordDecision|createFinding|endMission)\(/;
const WRITES_ACCESS_LOG = /customerData\.recordAccess\(/;
const NO_ACCESS_LOG_NEEDED = [
  "settings-changes.ts",
  "goal-changes.ts",
  "pause.ts",
  "rule-changes.ts",
  "setup.ts",
  "undo.ts",
  "finding-choices.ts",
  "finding-reminders.ts",
  "seed.ts",
  "sweep.ts",
];

const E2E = path.join(__dirname, "..", "e2e");
const e2eSpecs = readdirSync(E2E)
  .filter((name) => name.endsWith(".spec.ts"))
  .map((name) => ({ name, text: readFileSync(path.join(E2E, name), "utf8") }));

describe("hard rules", () => {
  for (const { rule, pattern, allowed } of rules) {
    it(rule, () => {
      const offenders = files
        .filter((file) => !allowed.includes(file.name) && pattern.test(file.text))
        .map((file) => file.name);
      expect(offenders).toEqual([]);
    });
  }

  it("writes an access log entry in every module that writes a Decision log entry, a Finding or a Mission ending (ADR 0010)", () => {
    const offenders = files
      .filter((file) => !NO_ACCESS_LOG_NEEDED.includes(file.name))
      .filter((file) => RECORDS_AN_ACTION.test(file.text) && !WRITES_ACCESS_LOG.test(file.text))
      .map((file) => file.name);
    expect(offenders).toEqual([]);
  });

  it("guards every test-only route under src/app/e2e with endToEndResetEnabled, so it answers 404 outside end-to-end runs", () => {
    const unguarded = files
      .filter((file) => file.name.startsWith(path.join("app", "e2e") + path.sep) && file.name.endsWith("route.ts"))
      .filter((file) => !file.text.includes("endToEndResetEnabled()"))
      .map((file) => file.name);
    expect(unguarded).toEqual([]);
  });

  it("checks sideways scrolling in end-to-end tests only through expectNoHorizontalScroll in e2e/page-checks.ts", () => {
    expect(e2eSpecs.filter((spec) => spec.text.includes("scrollWidth")).map((spec) => spec.name)).toEqual([]);
  });
});
