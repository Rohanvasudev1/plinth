import { describe, expect, it } from "vitest";
import { createBank, UnknownCustomerError } from "./bank";
import { fixedClock } from "./clock";
import { openTestDatabase } from "./db/database";
import { openTestBank, signInByName } from "./test-bank";

describe("Sign in as", () => {
  it("lists the seeded customers", () => {
    const bank = openTestBank();

    expect(bank.listCustomers().map((customer) => customer.name)).toEqual(["Sam Calloway", "Priya Natarajan"]);
  });

  it("refuses a customer that doesn't exist", () => {
    const bank = openTestBank();

    expect(() => bank.signIn(9999)).toThrow(UnknownCustomerError);
  });
});

describe("Home", () => {
  it("shows Sam's seeded Checking balance and House fund Goal progress", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");

    const home = bank.readHome(sam);

    expect(home.customerName).toBe("Sam Calloway");
    expect(home.checking).toMatchObject({ name: "Checking", balance: 227_00 });
    expect(home.savings).toEqual([
      expect.objectContaining({
        name: "House fund",
        balance: 12_400_00,
        goal: { target: 40_000_00, percentReached: 31 },
      }),
    ]);
  });

  it("shows today as the simulated clock's time", () => {
    const bank = createBank({ db: openTestDatabase(), clock: fixedClock(new Date("2026-12-04T15:00:00Z")) });
    const sam = signInByName(bank, "Sam Calloway");

    expect(bank.readHome(sam).today.toISOString()).toBe("2026-12-04T15:00:00.000Z");
  });
});

describe("seed", () => {
  it("seeds a database only once", () => {
    const db = openTestDatabase();
    const clock = fixedClock(new Date("2026-11-19T14:00:00Z"));
    createBank({ db, clock });

    const reopened = createBank({ db, clock });
    const sam = signInByName(reopened, "Sam Calloway");

    expect(reopened.listCustomers()).toHaveLength(2);
    expect(reopened.customerData.listAccounts(sam).map((account) => account.balance)).toEqual([227_00, 12_400_00]);
  });

  it("keeps the clearing accounts for Acme Corp payroll, Biller and Merchant out of every customer's accounts", () => {
    const bank = openTestBank();
    const clearing = (["acmePayroll", "biller", "merchant"] as const).map((key) => bank.systemData.systemAccountId(key));
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");

    expect(new Set(clearing).size).toBe(3);
    const visible = [sam, priya].flatMap((customer) => bank.customerData.listAccounts(customer).map((a) => a.id));
    expect(visible.filter((id) => clearing.includes(id))).toEqual([]);
  });
});
