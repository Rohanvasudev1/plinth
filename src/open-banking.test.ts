import { describe, expect, it } from "vitest";
import { localDate } from "./calendar";
import { openBankingAdapter } from "./open-banking";

const sam = { id: 1, name: "Sam Calloway" };
const priya = { id: 2, name: "Priya Natarajan" };

function balancesOn(date: string) {
  return Object.fromEntries(
    openBankingAdapter.listAccounts(sam).map((account) => [account.institution, openBankingAdapter.balanceOn(sam, account.key, localDate(date))]),
  );
}

describe("the open banking adapter", () => {
  it("lists Sam's five Institution accounts with their Institution and type", () => {
    expect(openBankingAdapter.listAccounts(sam).map(({ institution, type }) => ({ institution, type }))).toEqual([
      { institution: "Summit Card", type: "credit_card" },
      { institution: "Northwind", type: "retirement" },
      { institution: "Keystone Student Lending", type: "loan" },
      { institution: "Harbor Credit Union", type: "checking" },
      { institution: "Lakeside Bank", type: "savings" },
    ]);
  });

  it("lists only the two accounts every customer holds for Priya", () => {
    expect(openBankingAdapter.listAccounts(priya).map((account) => account.institution)).toEqual([
      "Harbor Credit Union",
      "Lakeside Bank",
    ]);
  });

  it("returns the spec's balances on 19 Nov 2026", () => {
    expect(balancesOn("2026-11-19")).toEqual({
      "Summit Card": -2_310_55,
      Northwind: 41_200_00,
      "Keystone Student Lending": -14_800_00,
      "Harbor Credit Union": 2_140_00,
      "Lakeside Bank": 5_200_00,
    });
  });

  it("adds a day of card spending on Summit Card by 20 Nov", () => {
    expect(balancesOn("2026-11-20")["Summit Card"]).toBe(-2_355_55);
  });

  it("adds Northwind's monthly contribution on 1 Dec", () => {
    expect(balancesOn("2026-12-01")).toMatchObject({ Northwind: 41_470_00, "Keystone Student Lending": -14_800_00 });
  });

  it("takes Summit Card's payment on 3 Dec, after 14 days of spending", () => {
    expect(balancesOn("2026-12-03")["Summit Card"]).toBe(-1_590_55);
  });

  it("pays Keystone down on 15 Dec, and keeps Harbor and Lakeside flat", () => {
    expect(balancesOn("2026-12-15")).toMatchObject({
      "Keystone Student Lending": -14_490_00,
      "Harbor Credit Union": 2_140_00,
      "Lakeside Bank": 5_200_00,
    });
  });

  it("refuses a date before 19 Nov 2026, and an account the customer doesn't hold", () => {
    expect(() => openBankingAdapter.balanceOn(sam, "summit-card", localDate("2026-11-18"))).toThrow(RangeError);
    expect(() => openBankingAdapter.balanceOn(priya, "summit-card", localDate("2026-11-19"))).toThrow();
  });
});
