import { describe, expect, it } from "vitest";
import { cents, formatDollars, formatDollarsForInput, parseDollars } from "./money";

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

describe("parseDollars", () => {
  it("reads a dollar amount typed into a form as whole cents", () => {
    expect(parseDollars("12")).toBe(12_00);
    expect(parseDollars("12.5")).toBe(12_50);
    expect(parseDollars(" $1,234.05 ")).toBe(1_234_05);
    expect(parseDollars("0.07")).toBe(7);
    expect(parseDollars(".99")).toBe(99);
  });

  it("rejects text that isn't a dollar amount to the cent", () => {
    for (const text of ["", "abc", "1.234", "-5", "1e3", "12.3.4", "$"]) {
      expect(() => parseDollars(text), text).toThrow(RangeError);
    }
  });
});

describe("formatDollarsForInput", () => {
  it("writes amounts that parseDollars reads back", () => {
    expect(formatDollarsForInput(cents(1_500_00))).toBe("1500");
    expect(formatDollarsForInput(cents(1_839_50))).toBe("1839.50");
    expect(formatDollarsForInput(cents(5))).toBe("0.05");
    expect(parseDollars(formatDollarsForInput(cents(1_839_50)))).toBe(1_839_50);
  });
});
