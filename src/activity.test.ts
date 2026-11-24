import { describe, expect, it } from "vitest";
import { cents } from "./money";
import type { Bank } from "./bank";
import { openTestBank, signInByName } from "./test-bank";

function samWithAccounts(bank: Bank) {
  const sam = signInByName(bank, "Sam Calloway");
  const [checking, houseFund] = bank.customerData.listAccounts(sam);
  if (!checking || !houseFund) throw new Error("Sam's seeded accounts are missing");
  return { sam, checking, houseFund };
}

/** Each Activity row as its counterparty or description, with whether it carries the "Agent" tag. */
function agentTags(bank: Bank, customer: ReturnType<typeof samWithAccounts>["sam"]) {
  return bank.readActivity(customer).map((row) => [row.counterparty ?? row.description, row.byAgent]);
}

describe("Activity", () => {
  it("lists the customer's ledger transactions newest first, with date, counterparty, Category and signed amount", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const [checking] = bank.customerData.listAccounts(sam);
    if (!checking) throw new Error("Sam's checking account is missing");

    bank.cardPurchase(sam, {
      accountId: checking.id,
      merchant: "lantern-noodle-bar",
      amount: cents(18_40),
      idempotencyKey: "card:noodles",
    });
    // Friday 20 November: Sam's paycheck lands, then the agent sweeps to the House fund. Without the $18.40
    // purchase the sweep would be $340. Sweeps move whole dollars, so this one moves $321.
    bank.advanceClock();

    const rows = bank.readActivity(sam).map(({ date, counterparty, category, amount }) => ({
      date,
      counterparty,
      category,
      amount,
    }));
    expect(rows.slice(0, 3)).toEqual([
      { date: "2026-11-20", counterparty: "House fund", category: "Savings", amount: -321_00 },
      { date: "2026-11-20", counterparty: "Acme Corp", category: "Income", amount: 3_240_00 },
      { date: "2026-11-19", counterparty: "Lantern Noodle Bar", category: "Eating out", amount: -18_40 },
    ]);
  });

  it("tags the agent's sweep, but not paychecks, Card purchases, opening balances, the customer's transfers or an Undo", () => {
    const bank = openTestBank();
    const { sam, checking, houseFund } = samWithAccounts(bank);
    bank.cardPurchase(sam, { accountId: checking.id, merchant: "cityline-transit", amount: cents(2_90), idempotencyKey: "card:bus" });
    bank.customerData.postLedgerTransaction(sam, {
      idempotencyKey: "transfer:1",
      description: "Transfer to Checking",
      counterparty: "Checking",
      category: "Savings",
      entries: [
        { accountId: houseFund.id, amount: cents(-100_00) },
        { accountId: checking.id, amount: cents(100_00) },
      ],
    });

    bank.advanceClock();
    const sweep = bank.readDecisionLog(sam).find((entry) => entry.actor === "agent");
    if (!sweep) throw new Error("The agent didn't sweep");
    bank.undo(sam, sweep.id);

    const tags = agentTags(bank, sam);
    expect(tags.slice(0, 5)).toEqual([
      ["Checking", false],
      ["House fund", true],
      ["Acme Corp", false],
      ["Checking", false],
      ["Cityline Transit", false],
    ]);
    // The rest is the seeded history and opening balances, none of it the agent's.
    expect(tags.slice(5).filter(([, byAgent]) => byAgent)).toEqual([]);
    expect(tags.slice(-2)).toEqual([
      ["Opening balance of House fund", false],
      ["Opening balance of Checking", false],
    ]);
  });

  it("tags a Move the customer picked on a Finding, but not Scheduled bills", () => {
    const bank = openTestBank();
    const { sam } = samWithAccounts(bank);
    bank.changeSettings(sam, { autonomyLevel: "ask_first" });
    bank.advanceClock();
    const [finding] = bank.readFindings(sam);
    if (!finding) throw new Error("The agent didn't ask about the paycheck");

    bank.chooseOption(sam, finding.id, "move");
    // From Friday 20 November to Tuesday 1 December passes Rent on the 1st.
    for (let day = 0; day < 11; day++) bank.advanceClock();

    expect(agentTags(bank, sam).slice(0, 3)).toEqual([
      ["Rent", false],
      ["House fund", true],
      ["Acme Corp", false],
    ]);
  });

  it("Priya can't read Sam's Activity", () => {
    const bank = openTestBank();
    const { sam, checking } = samWithAccounts(bank);
    const priya = signInByName(bank, "Priya Natarajan");
    bank.cardPurchase(sam, { accountId: checking.id, merchant: "bright-reel-cinema", amount: cents(14_00), idempotencyKey: "card:film" });
    bank.advanceClock();
    const samsTransactionIds = bank.readActivity(sam).map((row) => row.ledgerTransactionId);

    const priyasActivity = bank.readActivity(priya);

    expect(priyasActivity.length).toBeGreaterThan(0);
    expect(priyasActivity.filter((row) => samsTransactionIds.includes(row.ledgerTransactionId))).toEqual([]);
    expect(priyasActivity.filter((row) => row.counterparty === "Bright Reel Cinema" && row.date === "2026-11-19")).toEqual([]);
    expect(priyasActivity.filter((row) => row.byAgent)).toEqual([]);
  });
});
