import { describe, expect, it } from "vitest";
import { cents, formatDollars } from "./money";

describe("money", () => {
  it("formats cents as dollars with thousands separators", () => {
    expect(formatDollars(cents(123456))).toBe("$1,234.56");
    expect(formatDollars(cents(5))).toBe("$0.05");
    expect(formatDollars(cents(0))).toBe("$0.00");
  });

  it("puts the minus sign before the dollar sign", () => {
    expect(formatDollars(cents(-250075))).toBe("-$2,500.75");
  });

  it("refuses amounts that are not whole cents", () => {
    expect(() => cents(12.5)).toThrow(RangeError);
    expect(() => cents(Number.NaN)).toThrow(RangeError);
    expect(() => cents(2 ** 53)).toThrow(RangeError);
  });
});
