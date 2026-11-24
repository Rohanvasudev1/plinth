import { describe, expect, it } from "vitest";
import { SIMULATION_START } from "./app-clock";
import { createBank, type Bank } from "./bank";
import { fixedClock } from "./clock";
import type { Customer } from "./customer-data";
import { openTestDatabase } from "./db/database";
import type { MissionModel } from "./mission-model";
import { cents } from "./money";
import { agentEntriesIn, openTestBank, signInByName } from "./test-bank";

/**
 * Sam the day after the simulation starts, with "Ask me before everything", so his paycheck stays in Checking as a
 * sweep Finding: $3,467.00 in Checking and $12,400.00 in the House fund.
 */
function samAfterPayday(bank: Bank = openTestBank()): { bank: Bank; sam: Customer } {
  const sam = signInByName(bank, "Sam Calloway");
  bank.changeSettings(sam, { autonomyLevel: "ask_first" });
  bank.advanceClock();
  return { bank, sam };
}

function balancesOf(bank: Bank, sam: Customer) {
  const accounts = bank.customerData.listAccounts(sam);
  const balance = (name: string) => accounts.find((account) => account.name === name)?.balance;
  return { checking: balance("Checking"), houseFund: balance("House fund") };
}

/** Sam's Mission about his House fund, on the fake model, reported with a Finding offering Move. */
async function samsMoveFinding(setup: { bank: Bank; sam: Customer } = samAfterPayday()) {
  const { bank, sam } = setup;
  const mission = await bank.startMission(sam, "Am I on track for my House fund?").ended;
  const finding = bank.customerData.getFinding(sam, mission.findingId ?? -1);
  if (!finding) throw new Error("The Mission reported no Finding");
  return { bank, sam, finding };
}

/** A model whose Finding offers one Move, named by account names as the tools name them. */
function modelOffering(move: { amountCents: number; from: string; to: string }): MissionModel {
  return {
    async runMission(request) {
      const goals = await request.callTool("read_goals", {});
      return {
        title: "Your Goals",
        facts: [{ label: "Goals read", value: "Yes", toolCallId: goals.toolCallId }],
        options: [{ key: "move", ...move }, { key: "not_now" }],
        agentsView: null,
        cantKnow: null,
        report: null,
      };
    },
  };
}

describe("The fake model's House fund script", () => {
  it("offers to Move what Checking holds above its Buffer and a month of Scheduled bills", async () => {
    const { bank, sam, finding } = await samsMoveFinding();
    const accountId = (name: string) => bank.customerData.listAccounts(sam).find((each) => each.name === name)?.id;

    expect(finding.options[0]).toEqual({
      key: "move",
      amount: 340_00,
      fromAccountId: accountId("Checking"),
      toAccountId: accountId("House fund"),
    });
    expect(finding.facts).toContainEqual({
      label: "Checking today",
      value: "$3,467.00, with a $1,500.00 Buffer",
      source: "From your 30-day Forecast",
    });
    expect(finding.facts).toContainEqual({
      label: "Scheduled bills from Checking each month",
      value: "$1,627.00",
      source: "From your Scheduled bills",
    });
    expect(finding.agentsView).toBe(
      "I would pick Move $340.00 to House fund: Checking keeps its Buffer and a month of bills, and the Goal grows now.",
    );
  });

  it("offers no Move when Checking holds nothing above its Buffer", async () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");

    const { finding } = await samsMoveFinding({ bank, sam });

    expect(finding.options.map((option) => option.key)).toEqual(["read_report", "remind_me", "not_now"]);
  });
});

describe("Picking a Mission Finding's Move", () => {
  it("moves the money under key finding:<id>, writes a Done entry, closes the Finding, and can be undone", async () => {
    const { bank, sam, finding } = await samsMoveFinding();

    const outcome = bank.chooseOption(sam, finding.id, "move");

    expect(outcome).toMatchObject({ ok: true, finding: { state: "chosen", chosenOption: "move" } });
    expect(balancesOf(bank, sam)).toEqual({ checking: 3_127_00, houseFund: 12_740_00 });
    const posted = bank.customerData.findLedgerTransaction(sam, `finding:${finding.id}`);
    expect(posted).toBeDefined();
    const [done] = agentEntriesIn(bank, sam);
    expect(done).toMatchObject({
      action: "Moved $340 to House fund",
      result: "Done",
      trigger: { description: "You chose this Option" },
      ledgerTransactionId: posted?.id,
      amount: 340_00,
    });
    expect(done?.why).toContainEqual({ label: "Trigger", value: "You picked “Move $340 to House fund”" });

    expect(bank.undo(sam, done?.id ?? -1)).toMatchObject({ ok: true });
    expect(balancesOf(bank, sam)).toEqual({ checking: 3_467_00, houseFund: 12_400_00 });
  });

  it("moves money once when picked twice", async () => {
    const { bank, sam, finding } = await samsMoveFinding();

    bank.chooseOption(sam, finding.id, "move");
    expect(bank.chooseOption(sam, finding.id, "move")).toMatchObject({ ok: false });

    expect(balancesOf(bank, sam)).toEqual({ checking: 3_127_00, houseFund: 12_740_00 });
  });

  it("runs the guardrails: Buffer kept refuses it after a card purchase, moving nothing and leaving the Finding open", async () => {
    const { bank, sam, finding } = await samsMoveFinding();
    const checking = bank.customerData.listAccounts(sam).find((each) => each.name === "Checking");
    bank.cardPurchase(sam, {
      accountId: checking?.id ?? -1,
      merchant: "green-basket-market",
      amount: cents(100_00),
      idempotencyKey: "card:groceries",
    });

    const outcome = bank.chooseOption(sam, finding.id, "move");

    expect(outcome).toMatchObject({
      ok: false,
      reason: "checking would fall below the $1,500.00 Buffer plus $1,627.00 of bills",
      finding: { state: "open", refusal: { guardrail: "Buffer kept" } },
    });
    expect(balancesOf(bank, sam)).toEqual({ checking: 3_367_00, houseFund: 12_400_00 });
    expect(agentEntriesIn(bank, sam)[0]).toMatchObject({ result: "Refused", refusedBy: "Buffer kept" });
  });

  it("runs the same guardrails as a sweep Finding's Move, under Pause and a Payment limit below the amount", async () => {
    const { bank, sam, finding } = await samsMoveFinding();
    const sweepFinding = bank.readFindings(sam).find((each) => each.kind === "sweep" && each.state === "open");
    const paymentLimit = bank.customerData.listRules(sam).find((rule) => rule.kind === "payment_limit");
    bank.setPaymentLimit(sam, paymentLimit?.id ?? -1, cents(100_00));
    bank.setAgentPaused(sam, true);

    const fromSweep = bank.chooseOption(sam, sweepFinding?.id ?? -1, "move");
    const sweepChecks = agentEntriesIn(bank, sam)[0]?.why.find((row) => row.label === "Checked by");
    bank.undo(sam, agentEntriesIn(bank, sam)[0]?.id ?? -1);
    const fromMission = bank.chooseOption(sam, finding.id, "move");
    const missionChecks = agentEntriesIn(bank, sam)[0]?.why.find((row) => row.label === "Checked by");

    expect(fromMission.ok).toBe(fromSweep.ok);
    expect(missionChecks).toEqual(sweepChecks);
  });

  it("is refused, moving nothing, when no buffer Rule covers the account it moves from", async () => {
    const bank = createBank({
      db: openTestDatabase(),
      clock: fixedClock(SIMULATION_START),
      missionModel: modelOffering({ amountCents: 100_00, from: "House fund", to: "Checking" }),
    });
    const { sam } = samAfterPayday(bank);
    const mission = await bank.startMission(sam, "Can I have some back?").ended;
    const findingId = mission.findingId ?? -1;

    const outcome = bank.chooseOption(sam, findingId, "move");

    expect(outcome).toMatchObject({ ok: false, finding: { state: "open", refusal: { guardrail: "Rule on" } } });
    expect(balancesOf(bank, sam)).toEqual({ checking: 3_467_00, houseFund: 12_400_00 });
    expect(agentEntriesIn(bank, sam)[0]).toMatchObject({
      result: "Refused",
      refusedBy: "Rule on",
      missionId: mission.id,
      findingId,
      amount: 100_00,
    });
  });
});
