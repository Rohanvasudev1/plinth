import { describe, expect, it } from "vitest";
import { cents } from "./money";
import { openTestBank, signInByName } from "./test-bank";

describe("customer scoping", () => {
  it("Priya can't read Sam's accounts", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");
    const samsAccountIds = bank.customerData.listAccounts(sam).map((account) => account.id);

    const priyasAccounts = bank.customerData.listAccounts(priya);

    expect(samsAccountIds).toHaveLength(2);
    expect(priyasAccounts.map((account) => account.name)).toEqual(["Checking", "Travel fund"]);
    for (const accountId of samsAccountIds) {
      expect(priyasAccounts.map((account) => account.id)).not.toContain(accountId);
      expect(bank.customerData.getAccount(priya, accountId)).toBeUndefined();
    }
  });

  it("Priya's Home shows her own balances, not Sam's", () => {
    const bank = openTestBank();
    const priya = signInByName(bank, "Priya Natarajan");

    const home = bank.readHome(priya);

    expect(home.customerName).toBe("Priya Natarajan");
    expect(home.checking).toMatchObject({ name: "Checking", balance: 1_836_42 });
    expect(home.savings).toEqual([
      expect.objectContaining({ name: "Travel fund", balance: 2_150_00, goal: { target: 6_000_00, percentReached: 35 } }),
    ]);
  });

  it("Priya can't read Sam's ledger transactions", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");
    const samsAccountIds = new Set(bank.customerData.listAccounts(sam).map((account) => account.id));

    const priyasEntries = bank.customerData.listLedgerTransactions(priya).flatMap((transaction) => transaction.entries);

    expect(priyasEntries.length).toBeGreaterThan(0);
    expect(priyasEntries.filter((entry) => samsAccountIds.has(entry.accountId))).toEqual([]);
  });

  it("Priya can't move money out of Sam's account", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");
    const [samsChecking] = bank.customerData.listAccounts(sam);
    const [priyasChecking] = bank.customerData.listAccounts(priya);
    if (!samsChecking || !priyasChecking) throw new Error("Seeded accounts are missing");

    expect(() =>
      bank.customerData.postLedgerTransaction(priya, {
        idempotencyKey: "test:steal",
        description: "Take Sam's money",
        entries: [
          { accountId: samsChecking.id, amount: cents(-100_00) },
          { accountId: priyasChecking.id, amount: cents(100_00) },
        ],
      }),
    ).toThrow(/own account/);
    expect(bank.customerData.getAccount(sam, samsChecking.id)?.balance).toBe(227_00);
  });

  it("Priya can't reuse an idempotency key from Sam's ledger transaction to learn about it", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");
    const [samsFirst] = bank.customerData.listLedgerTransactions(sam);
    const [priyasChecking, priyasTravelFund] = bank.customerData.listAccounts(priya);
    if (!samsFirst || !priyasChecking || !priyasTravelFund) throw new Error("Seed data is missing");

    expect(() =>
      bank.customerData.postLedgerTransaction(priya, {
        idempotencyKey: samsFirst.idempotencyKey,
        description: "Collide",
        entries: [
          { accountId: priyasChecking.id, amount: cents(-1_00) },
          { accountId: priyasTravelFund.id, amount: cents(1_00) },
        ],
      }),
    ).toThrow(/another customer/);
  });
});
