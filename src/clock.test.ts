import { describe, expect, it } from "vitest";
import { fixedClock } from "./clock";

describe("fixedClock", () => {
  it("always reports the time it was given", () => {
    const clock = fixedClock(new Date("2026-03-02T09:00:00Z"));

    expect(clock.now().toISOString()).toBe("2026-03-02T09:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-03-02T09:00:00.000Z");
  });

  it("can't be changed by mutating a returned date", () => {
    const clock = fixedClock(new Date("2026-03-02T09:00:00Z"));

    clock.now().setUTCFullYear(1999);

    expect(clock.now().toISOString()).toBe("2026-03-02T09:00:00.000Z");
  });
});
