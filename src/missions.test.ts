import { describe, expect, it } from "vitest";
import { SIMULATION_START } from "./app-clock";
import { createBank, type Bank } from "./bank";
import { fixedClock } from "./clock";
import { openTestDatabase } from "./db/database";
import type { MissionModel, MissionModelRequest, ModelFinding } from "./mission-model";
import { openTestBank, signInByName } from "./test-bank";

/**
 * A stand-in model that reads the Usual month, then returns whatever Finding `write` builds from that call's id, so
 * a test can hand the checks a Finding the scripted fake never would.
 */
function modelReturning(write: (usualMonthCallId: string, request: MissionModelRequest) => ModelFinding): MissionModel {
  return {
    async runMission(request) {
      const answer = await request.callTool("read_usual_month", {});
      return write(answer.toolCallId, request);
    },
  };
}

function bankWith(missionModel: MissionModel): Bank {
  return createBank({ db: openTestDatabase(), clock: fixedClock(SIMULATION_START), missionModel });
}

function finding(overrides: Partial<ModelFinding> & Pick<ModelFinding, "facts">): ModelFinding {
  return {
    title: "Your Usual month",
    options: [{ key: "not_now" }],
    agentsView: "I would pick Not now.",
    cantKnow: null,
    report: "The working.",
    ...overrides,
  };
}

describe("A Mission on the fake model", () => {
  it("reports one Finding whose every fact has a Source, and writes one Decision log entry", async () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const before = bank.readDecisionLog(sam).length;

    const { mission, ended } = bank.startMission(sam, "Am I on track for my House fund?");
    expect(mission).toMatchObject({ question: "Am I on track for my House fund?", state: "running" });

    const finished = await ended;

    expect(finished).toMatchObject({ id: mission.id, state: "reported" });
    const findings = bank.readFindings(sam).filter((finding) => finding.kind === "mission");
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding).toMatchObject({ missionId: mission.id, state: "open" });
    expect(finished.findingId).toBe(finding?.id);
    expect(finding?.facts.length).toBeGreaterThan(0);
    expect(finding?.facts.every((fact) => fact.source.length > 0)).toBe(true);
    expect(finding?.report).toBeTruthy();
    expect(finding?.agentsView).toBeTruthy();

    const log = bank.readDecisionLog(sam);
    expect(log).toHaveLength(before + 1);
    expect(log[0]).toMatchObject({
      actor: "agent",
      trigger: { description: "You asked: Am I on track for my House fund?" },
      rule: null,
      result: "Reported",
      missionId: mission.id,
      findingId: finding?.id,
    });
  });
});

describe("Mission Finding checks", () => {
  it("fail the Mission when a fact cites no tool call from it, keeping no Finding and logging once", async () => {
    const bank = bankWith(
      modelReturning((callId) =>
        finding({
          facts: [
            { label: "Usual month", value: "$7,020.00 in", toolCallId: callId },
            { label: "Your neighbour's rent", value: "$2,000.00", toolCallId: "call_99" },
          ],
        }),
      ),
    );
    const sam = signInByName(bank, "Sam Calloway");
    const before = bank.readDecisionLog(sam).length;

    const { ended } = bank.startMission(sam, "How does my rent compare?");
    const finished = await ended;

    expect(finished).toMatchObject({ state: "failed", findingId: null });
    expect(bank.readFindings(sam).filter((each) => each.kind === "mission")).toEqual([]);
    const log = bank.readDecisionLog(sam);
    expect(log).toHaveLength(before + 1);
    expect(log[0]).toMatchObject({
      actor: "agent",
      trigger: { description: "You asked: How does my rent compare?" },
      rule: null,
      result: "Failed",
      missionId: finished.id,
      findingId: null,
    });
  });
});

describe("Tool call ids", () => {
  it("are never reused, so a fact citing a failed call fails the Mission", async () => {
    const ids: string[] = [];
    const bank = bankWith({
      async runMission(request) {
        const failed = await request.callTool("read_transactions", { from: "not a date", to: "2026-11-19" });
        const usual = await request.callTool("read_usual_month", {});
        ids.push(failed.toolCallId, usual.toolCallId);
        return finding({
          facts: [
            { label: "Usual month", value: "$7,020.00 in", toolCallId: usual.toolCallId },
            { label: "Spent lately", value: "$900.00", toolCallId: failed.toolCallId },
          ],
        });
      },
    });
    const sam = signInByName(bank, "Sam Calloway");

    const finished = await bank.startMission(sam, "What did I spend?").ended;

    expect(ids[0]).not.toBe(ids[1]);
    expect(finished.state).toBe("failed");
    expect(bank.readDecisionLog(sam)[0]?.why).toContainEqual({
      label: "Why it stopped",
      value: "The fact “Spent lately” cites no tool call from this Mission",
    });
  });

  it("are unique across Missions", async () => {
    const ids: string[] = [];
    const bank = bankWith(
      modelReturning((callId) => {
        ids.push(callId);
        return finding({ facts: [{ label: "Usual month", value: "$7,020.00 in", toolCallId: callId }] });
      }),
    );
    const sam = signInByName(bank, "Sam Calloway");

    await bank.startMission(sam, "What's my Usual month?").ended;
    await bank.startMission(sam, "What's my Usual month?").ended;

    expect(new Set(ids).size).toBe(2);
  });
});

describe("A Mission whose Finding can't be stored", () => {
  it("fails, saying the Finding couldn't be saved rather than blaming the model", async () => {
    const bank = bankWith(
      modelReturning((callId) => finding({ facts: [{ label: "Usual month", value: "$7,020.00 in", toolCallId: callId }] })),
    );
    const sam = signInByName(bank, "Sam Calloway");
    bank.customerData.createFinding = () => {
      throw new Error("The disk is full");
    };

    const finished = await bank.startMission(sam, "What's my Usual month?").ended;

    expect(finished.state).toBe("failed");
    expect(bank.readDecisionLog(sam)[0]?.why).toContainEqual({
      label: "Why it stopped",
      value: "Your agent couldn't save what it found",
    });
  });
});

describe("What Plinth can't know", () => {
  async function missionSaying(cantKnow: string) {
    const bank = bankWith(
      modelReturning((callId) =>
        finding({ facts: [{ label: "Usual month", value: "$7,020.00 in", toolCallId: callId }], cantKnow }),
      ),
    );
    const sam = signInByName(bank, "Sam Calloway");
    const finished = await bank.startMission(sam, "How does my rent compare?").ended;
    return { bank, sam, finished };
  }

  it("fails the Mission when it states a money amount or a rate, since only cited facts may carry those", async () => {
    for (const cantKnow of [
      "Rents nearby average $2,100 a month.",
      "Mortgage rates are near 6.5%.",
      "Rates are around 6 percent.",
      "Rents are about 2100 dollars.",
      "Rates are around six percent.",
      "Rents average USD 2,100.",
      "Rents average 2,100 USD.",
    ]) {
      const { bank, sam, finished } = await missionSaying(cantKnow);

      expect(finished.state, cantKnow).toBe("failed");
      expect(bank.readDecisionLog(sam)[0]?.why, cantKnow).toContainEqual({
        label: "Why it stopped",
        value: "What Plinth can't know may not state a money amount or a rate",
      });
    }
  });

  it("allows other numbers, such as a year or an account kind", async () => {
    const { bank, sam, finished } = await missionSaying("Prices in 2027, and anything in a 401(k) held elsewhere.");

    expect(finished.state).toBe("reported");
    expect(bank.customerData.getFinding(sam, finished.findingId ?? -1)?.facts).toContainEqual({
      label: "What Plinth can't know",
      value: "Prices in 2027, and anything in a 401(k) held elsewhere.",
      source: "Not in your Plinth data",
    });
  });
});

describe("Mission Finding Options", () => {
  it("drop an Option not on the list, any Move (the Move Option comes later), a repeat and a past reminder", async () => {
    const priyasAccounts: number[] = [];
    const bank = bankWith(
      modelReturning((callId) =>
        finding({
          facts: [{ label: "Usual month", value: "$7,020.00 in", toolCallId: callId }],
          options: [
            { key: "cancel_subscription" },
            { key: "move", amount: 100_00, fromAccountId: priyasAccounts[0], toAccountId: priyasAccounts[1] },
            { key: "remind_me", date: "2026-11-01" },
            { key: "remind_me", date: "2027-02-01" },
            { key: "not_now" },
            { key: "not_now" },
          ],
        }),
      ),
    );
    const sam = signInByName(bank, "Sam Calloway");
    priyasAccounts.push(...bank.customerData.listAccounts(signInByName(bank, "Priya Natarajan")).map((each) => each.id));

    const finished = await bank.startMission(sam, "What's my Usual month?").ended;

    expect(finished.state).toBe("reported");
    expect(bank.customerData.getFinding(sam, finished.findingId ?? -1)?.options).toEqual([
      { key: "remind_me", date: "2027-02-01" },
      { key: "not_now" },
    ]);
  });

  it("are Read the full report and Not now when none survive the checks", async () => {
    const bank = bankWith(
      modelReturning((callId) =>
        finding({
          facts: [{ label: "Usual month", value: "$7,020.00 in", toolCallId: callId }],
          options: [{ key: "cancel_subscription" }, { key: "remind_me", date: "not a date" }],
          report: null,
        }),
      ),
    );
    const sam = signInByName(bank, "Sam Calloway");

    const finished = await bank.startMission(sam, "What's my Usual month?").ended;

    const stored = bank.customerData.getFinding(sam, finished.findingId ?? -1);
    expect(stored?.options).toEqual([{ key: "read_report" }, { key: "not_now" }]);
    expect(stored?.report).toContain("Usual month: $7,020.00 in (From your Usual month and On pace)");
    expect(bank.chooseOption(sam, stored?.id ?? -1, "read_report")).toMatchObject({ ok: true });
  });
});

describe("Mission tools", () => {
  it("read only the asking customer's data: Sam's and Priya's Missions each hold only their own accounts and figures", async () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");

    const [samsMission, priyasMission] = await Promise.all([
      bank.startMission(sam, "Am I on track for my House fund?").ended,
      bank.startMission(priya, "Am I on track for my House fund?").ended,
    ]);

    const samsFinding = bank.customerData.getFinding(sam, samsMission.findingId ?? -1);
    const priyasFinding = bank.customerData.getFinding(priya, priyasMission.findingId ?? -1);
    const samsText = JSON.stringify(samsFinding);
    const priyasText = JSON.stringify(priyasFinding);
    expect(samsText).toContain("House fund");
    expect(samsText).toContain("$12,400.00 of $40,000.00");
    expect(samsText).not.toContain("Travel fund");
    expect(priyasText).toContain("Travel fund");
    expect(priyasText).not.toContain("House fund");
    expect(priyasText).not.toContain("$12,400.00");
    expect(bank.readFindings(priya).some((each) => each.missionId === samsMission.id)).toBe(false);
    expect(bank.readMission(priya, samsMission.id)).toBeUndefined();
    expect(samsMission.readList.map((read) => read.tool)).toEqual([
      "read_transactions",
      "read_usual_month",
      "read_goals",
      "read_projection",
    ]);
    expect(JSON.stringify(samsMission.readList)).not.toMatch(/Travel fund|Priya/);
    expect(JSON.stringify(priyasMission.readList)).not.toMatch(/House fund|Sam/);
    expect(samsMission.readList.find((read) => read.tool === "read_transactions")?.item).toBe("Fri 21 Aug to Thu 19 Nov");
  });

  /** Runs every Mission tool for the customer and returns their raw results as JSON text. */
  async function rawToolResults(bank: Bank, customer: ReturnType<typeof signInByName>): Promise<string> {
    const results: unknown[] = [];
    const reader: MissionModel = {
      async runMission(request) {
        for (const tool of request.tools) {
          const input = tool.name === "read_transactions" ? { from: "2026-01-01", to: "2026-11-19" } : {};
          const answer = await request.callTool(tool.name, input);
          expect(answer, tool.name).not.toHaveProperty("error");
          results.push(answer);
        }
        throw new Error("Done reading");
      },
    };
    readerFor.current = reader;
    await bank.startMission(customer, "Read everything").ended;
    expect(results).toHaveLength(6);
    return JSON.stringify(results);
  }
  const readerFor: { current: MissionModel | undefined } = { current: undefined };

  it("return results that carry no customer name and no account id, for Sam and for Priya", async () => {
    const bank = bankWith({ runMission: (request) => (readerFor.current as MissionModel).runMission(request) });
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");

    for (const customer of [sam, priya]) {
      const text = await rawToolResults(bank, customer);
      for (const part of customer.name.split(" ")) expect(text, customer.name).not.toContain(part);
      expect(text, customer.name).not.toMatch(/"(id|accountId|customerId|fromAccountId|toAccountId)"/);
    }
  });

  it("give Priya results that hold none of Sam's accounts or figures, and Sam none of Priya's", async () => {
    const bank = bankWith({ runMission: (request) => (readerFor.current as MissionModel).runMission(request) });
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");

    const samsText = await rawToolResults(bank, sam);
    const priyasText = await rawToolResults(bank, priya);

    // Sam: House fund holds $12,400.00 of a $40,000.00 target, and his Usual month income is $7,020.00.
    expect(samsText).toContain("House fund");
    expect(samsText).toContain('"balanceCents":1240000');
    expect(priyasText).not.toContain("House fund");
    expect(priyasText).not.toContain("1240000");
    expect(priyasText).not.toContain("4000000");
    expect(priyasText).not.toContain('"incomeCents":702000');
    // Priya: Travel fund, with a $6,000.00 target.
    expect(priyasText).toContain("Travel fund");
    expect(priyasText).toContain('"targetCents":600000');
    expect(samsText).not.toContain("Travel fund");
    expect(samsText).not.toContain('"targetCents":600000');
  });

  it("record the progress label and what was read while the Mission runs", async () => {
    const seen: unknown[] = [];
    const bank: Bank = bankWith({
      async runMission(request) {
        await request.callTool("read_goals", {});
        seen.push(bank.customerData.listMissions(sam)[0]);
        const usual = await request.callTool("read_usual_month", {});
        seen.push(bank.customerData.listMissions(sam)[0]);
        return finding({ facts: [{ label: "Usual month", value: "$7,020.00 in", toolCallId: usual.toolCallId }] });
      },
    });
    const sam = signInByName(bank, "Sam Calloway");

    const started = bank.startMission(sam, "What's my Usual month?");
    await started.ended;

    expect(seen).toMatchObject([
      { state: "running", progressLabel: "Checking your Forecast and Goals", readList: [{ tool: "read_goals", item: "Goals" }] },
      {
        state: "running",
        progressLabel: "Checking your Usual month and this month's pace",
        readList: [
          { tool: "read_goals", item: "Goals" },
          { tool: "read_usual_month", item: "Usual month and On pace" },
        ],
      },
    ]);
    expect(bank.readMission(sam, started.mission.id)).toMatchObject({ state: "reported", progressLabel: "Writing up what it found" });
  });
});

describe("The fake model's scripts", () => {
  async function samAsks(question: string) {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const mission = await bank.startMission(sam, question).ended;
    const stored = bank.customerData.getFinding(sam, mission.findingId ?? -1);
    if (!stored) throw new Error(`No Finding for “${question}”`);
    return stored;
  }

  const cantKnow = (finding: { facts: { label: string; value: string; source: string }[] }) =>
    finding.facts.find((fact) => fact.label === "What Plinth can't know");

  it("answer “Could I take 3 months off work next summer?” from Sam's Usual month and Goals, saying what Plinth can't know", async () => {
    const answer = await samAsks("Could I take 3 months off work next summer?");

    expect(answer.title).toBe("3 months without pay would take about $15,324.00 of spending");
    expect(answer.facts).toContainEqual({
      label: "Saved in your Goals today",
      value: "$12,400.00",
      source: "From your Goals",
    });
    expect(cantKnow(answer)).toMatchObject({ source: "Not in your Plinth data" });
    expect(answer.options.map((option) => option.key)).toEqual(["read_report", "remind_me", "not_now"]);
    expect(answer.agentsView).toMatch(/^I would pick Remind me/);
  });

  it("answer “What would a $500 a month raise change?” with Left to save before and after, saying what Plinth can't know", async () => {
    const answer = await samAsks("What would a $500 a month raise change?");

    expect(answer.facts).toContainEqual({
      label: "Left to save in a Usual month now",
      value: "$1,912.00",
      source: "From your Usual month and On pace",
    });
    expect(answer.facts).toContainEqual(
      expect.objectContaining({ label: "With $500.00 more a month", value: "$2,412.00" }),
    );
    expect(cantKnow(answer)?.value).toContain("after tax");
    expect(answer.agentsView).toBeTruthy();
  });

  it("answer “Am I on track for my House fund?” from the Goal and the Usual month, with nothing outside to know", async () => {
    const answer = await samAsks("Am I on track for my House fund?");

    expect(answer.title).toBe("House fund is at 31%, about 15 months from its target");
    expect(answer.facts).toContainEqual({
      label: "House fund",
      value: "$12,400.00 of $40,000.00 (31%)",
      source: "From your Goals",
    });
    expect(cantKnow(answer)).toBeUndefined();
  });

  it("answer any other question from recent transactions, citing the period read", async () => {
    const answer = await samAsks("Where does my money go?");

    expect(answer.title).toBe("What your last 90 days of spending show");
    expect(answer.facts[0]?.source).toBe("From your transactions, Fri 21 Aug to Thu 19 Nov");
    expect(cantKnow(answer)).toBeDefined();
  });

  it("tell a customer with no history there isn't enough to go on", async () => {
    const bank = openTestBank();
    const alex = signInByName(bank, "Alex Okafor");

    const mission = await bank.startMission(alex, "Could I take 3 months off work next summer?").ended;

    expect(mission.state).toBe("reported");
    const answer = bank.customerData.getFinding(alex, mission.findingId ?? -1);
    expect(answer).toMatchObject({ title: "Not enough history to answer this yet" });
    expect(answer?.options).toEqual([{ key: "read_report" }, { key: "not_now" }]);
  });
});

describe("Starting a Mission", () => {
  it("refuses a blank question, starting nothing", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");

    expect(() => bank.startMission(sam, "   ")).toThrow("Type a question");
    expect(bank.customerData.listMissions(sam)).toEqual([]);
  });
});

describe("Discoveries with Missions", () => {
  it("shows running Missions with their progress label, and the Finding once one reports", async () => {
    let release: () => void = () => {};
    const bank: Bank = bankWith({
      async runMission(request) {
        const usual = await request.callTool("read_usual_month", {});
        await new Promise<void>((resolve) => (release = resolve));
        return finding({ facts: [{ label: "Usual month", value: "$7,020.00 in", toolCallId: usual.toolCallId }] });
      },
    });
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");
    const started = bank.startMission(sam, "What's my Usual month?");
    await Promise.resolve();

    const running = bank.readDiscoveries(sam);
    expect(running.runningMissions).toEqual([
      expect.objectContaining({
        question: "What's my Usual month?",
        progressLabel: "Checking your Usual month and this month's pace",
      }),
    ]);
    expect(bank.readDiscoveries(priya).runningMissions).toEqual([]);

    release();
    await started.ended;

    const reported = bank.readDiscoveries(sam);
    expect(reported.runningMissions).toEqual([]);
    expect(reported.findings[0]).toMatchObject({ kind: "mission", title: "Your Usual month", report: "The working." });
  });
});
