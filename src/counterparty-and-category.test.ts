import { describe, expect, it } from "vitest";
import type { Bank } from "./bank";
import { cents } from "./money";
import { CardDeclinedError, type MerchantKey } from "./simulator";
import { openTestBank, signInByName } from "./test-bank";

function samWithAccounts(bank: Bank) {
  const sam = signInByName(bank, "Sam Calloway");
  const [checking, houseFund] = bank.customerData.listAccounts(sam);
  if (!checking || !houseFund) throw new Error("Sam's seeded accounts are missing");
  return { sam, checking, houseFund };
}

/** Switches every buffer Rule off, so the ledger holds only what the Simulator posted. */
function withoutSweeps(bank: Bank): Bank {
  for (const customer of bank.listCustomers()) {
    for (const rule of bank.customerData.listRules(customer)) bank.switchRule(customer, rule.id, false);
  }
  return bank;
}

/** Sam's newest ledger transaction. */
function samsLatest(bank: Bank) {
  return bank.customerData.listLedgerTransactions(signInByName(bank, "Sam Calloway")).at(-1);
}

describe("Counterparty and Category on ledger transactions", () => {
  it("takes a Card purchase's counterparty and Category from the Merchant", () => {
    const bank = openTestBank();
    const { sam, checking } = samWithAccounts(bank);

    bank.cardPurchase(sam, {
      accountId: checking.id,
      merchant: "lantern-noodle-bar",
      amount: cents(18_40),
      idempotencyKey: "card:noodles",
    });

    expect(samsLatest(bank)).toMatchObject({ counterparty: "Lantern Noodle Bar", category: "Eating out" });
  });

  it("declines a Card purchase at a Merchant that isn't on the list, moving nothing", () => {
    const bank = openTestBank();
    const { sam, checking } = samWithAccounts(bank);

    expect(() =>
      bank.cardPurchase(sam, {
        accountId: checking.id,
        merchant: "no-such-shop" as MerchantKey,
        amount: cents(5_00),
        idempotencyKey: "card:nowhere",
      }),
    ).toThrow(CardDeclinedError);
    expect(bank.customerData.getAccount(sam, checking.id)?.balance).toBe(227_00);
  });

  it("gives a paycheck the Category Income with the employer's name", () => {
    const bank = withoutSweeps(openTestBank());

    bank.advanceClock();

    expect(samsLatest(bank)).toMatchObject({ counterparty: "Acme Corp", category: "Income" });
  });

  it("takes a Scheduled bill's counterparty and Category from the bill: rent is Housing, internet, phone and power are Utilities", () => {
    const bank = withoutSweeps(openTestBank());
    const sam = signInByName(bank, "Sam Calloway");

    // From Thursday 19 November to Thursday 3 December passes Rent on the 1st, Internet on the 2nd, and Phone and Power on the 3rd.
    for (let day = 0; day < 14; day++) bank.advanceClock();

    const bills = bank.customerData
      .listLedgerTransactions(sam)
      .filter((transaction) => transaction.idempotencyKey.startsWith("bill:"))
      .map(({ counterparty, category }) => ({ counterparty, category }));
    expect(bills).toEqual([
      { counterparty: "Rent", category: "Housing" },
      { counterparty: "Internet", category: "Utilities" },
      { counterparty: "Phone", category: "Utilities" },
      { counterparty: "Power", category: "Utilities" },
    ]);
  });

  it("gives the agent's sweep the Category Savings, with the account it went to", () => {
    const bank = openTestBank();

    bank.advanceClock();

    expect(samsLatest(bank)).toMatchObject({
      description: "Sweep to House fund",
      counterparty: "House fund",
      category: "Savings",
    });
  });

  it("gives a picked Move the Category Savings, with the account it went to", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    bank.changeSettings(sam, { autonomyLevel: "ask_first" });
    bank.advanceClock();
    const [finding] = bank.readFindings(sam);
    if (!finding) throw new Error("Expected a sweep Finding");

    bank.chooseOption(sam, finding.id, "move");

    expect(samsLatest(bank)).toMatchObject({
      idempotencyKey: `finding:${finding.id}`,
      counterparty: "House fund",
      category: "Savings",
    });
  });

  it("gives an Undo the Category Savings, with the account the money went back to", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    bank.advanceClock();
    const [sweep] = bank.readDecisionLog(sam).filter((entry) => entry.actor === "agent");
    if (!sweep) throw new Error("Expected the agent's sweep");

    bank.undo(sam, sweep.id);

    expect(samsLatest(bank)).toMatchObject({
      idempotencyKey: `undo:${sweep.id}`,
      counterparty: "Checking",
      category: "Savings",
    });
  });
});
