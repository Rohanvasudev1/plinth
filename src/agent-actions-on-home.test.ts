import { describe, expect, it } from "vitest";
import { createBank, type Bank } from "./bank";
import { fixedClock } from "./clock";
import { openTestDatabase } from "./db/database";
import { signInByName } from "./test-bank";

function bankOnPayday(): Bank {
  return createBank({ db: openTestDatabase(), clock: fixedClock(new Date("2026-11-20T14:00:00Z")) });
}

describe("What your agent did, on Home", () => {
  it("lists the customer's agent actions, newest first, with their state, and not their own Undo entries", () => {
    const bank = bankOnPayday();
    const sam = signInByName(bank, "Sam Calloway");
    bank.postPaycheck();
    for (let day = 0; day < 14; day++) bank.advanceClock();
    const [secondSweep, firstSweep] = bank.readDecisionLog(sam);
    if (!firstSweep || !secondSweep) throw new Error("Expected two sweeps");

    bank.undo(sam, firstSweep.id);

    expect(bank.readHome(sam).agentActions.map(({ decision, state }) => [decision.id, decision.action, state])).toEqual([
      [secondSweep.id, secondSweep.action, "Done"],
      [firstSweep.id, "Moved $340 to House fund", "Reversed"],
    ]);
  });

  it("shows a Refused action as Refused", () => {
    const bank = createBank({ db: openTestDatabase(), clock: fixedClock(new Date("2026-11-25T14:00:00Z")) });
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");
    const [, samsHouseFund] = bank.customerData.listAccounts(sam);
    const [seeded] = bank.customerData.listRules(priya);
    if (!samsHouseFund || !seeded) throw new Error("Seed data is missing");
    bank.customerData.switchRule(priya, seeded.id, false);
    bank.customerData.createRule(priya, {
      kind: "buffer",
      parameters: { ...seeded.parameters, savingsAccountId: samsHouseFund.id },
      on: true,
    });

    bank.postPaycheck();

    expect(bank.readHome(priya).agentActions.map(({ state }) => state)).toEqual(["Refused"]);
  });

  it("toasts unseen agent actions once: after they are marked seen, Home has none to show", () => {
    const bank = bankOnPayday();
    const sam = signInByName(bank, "Sam Calloway");
    expect(bank.readHome(sam).unseenAgentActions).toEqual([]);
    bank.postPaycheck();
    const [sweep] = bank.readDecisionLog(sam);
    if (!sweep) throw new Error("The paycheck didn't sweep");

    expect(bank.readHome(sam).unseenAgentActions).toEqual([sweep]);
    bank.markAgentActionsSeen(sam, [sweep.id]);

    expect(bank.readHome(sam).unseenAgentActions).toEqual([]);
    bank.undo(sam, sweep.id);
    expect(bank.readHome(sam).unseenAgentActions).toEqual([]);
  });

  it("a customer can't mark another customer's actions seen", () => {
    const bank = bankOnPayday();
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");
    bank.postPaycheck();
    const [sweep] = bank.readDecisionLog(sam);
    if (!sweep) throw new Error("The paycheck didn't sweep");

    bank.markAgentActionsSeen(priya, [sweep.id]);

    expect(bank.readHome(sam).unseenAgentActions).toEqual([sweep]);
    expect(bank.readHome(priya).agentActions).toEqual([]);
  });
});
