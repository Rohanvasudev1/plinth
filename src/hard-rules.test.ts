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
];

describe("hard rules", () => {
  for (const { rule, pattern, allowed } of rules) {
    it(rule, () => {
      const offenders = files
        .filter((file) => !allowed.includes(file.name) && pattern.test(file.text))
        .map((file) => file.name);
      expect(offenders).toEqual([]);
    });
  }
});
