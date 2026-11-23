import { describe, expect, it } from "vitest";
import { openTestDatabase } from "./db/database";
import { simulatedClock } from "./simulated-clock";

const start = new Date("2026-03-02T09:00:00Z");

describe("simulatedClock", () => {
  it("starts at the given time and does not move on its own", () => {
    const clock = simulatedClock(openTestDatabase(), start);

    expect(clock.now().toISOString()).toBe("2026-03-02T09:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-03-02T09:00:00.000Z");
  });

  it("keeps a time that was set, for every clock on the same database", () => {
    const db = openTestDatabase();
    simulatedClock(db, start).setTo(new Date("2026-03-15T17:30:00Z"));

    const later = simulatedClock(db, start);

    expect(later.now().toISOString()).toBe("2026-03-15T17:30:00.000Z");
  });

  it("gives each test database its own time", () => {
    simulatedClock(openTestDatabase(), start).setTo(new Date("2027-01-01T00:00:00Z"));

    const fresh = simulatedClock(openTestDatabase(), start);

    expect(fresh.now().toISOString()).toBe("2026-03-02T09:00:00.000Z");
  });
});
