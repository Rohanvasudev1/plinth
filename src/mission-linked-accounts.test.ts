import { describe, expect, it } from "vitest";
import { SIMULATION_START } from "./app-clock";
import { createBank, type Bank } from "./bank";
import { fixedClock } from "./clock";
import type { Customer } from "./customer-data";
import { openTestDatabase } from "./db/database";
import type { MissionModel, MissionToolAnswer } from "./mission-model";
import { openTestBank, signInByName } from "./test-bank";

// The seventh Mission tool, read_linked_accounts (#73): a Mission reads the customer's Linked accounts whose Consent
// lasts, as Institution, type and balance only.

/** A seeded bank whose Missions call read_linked_accounts once, keep its answer, and report a Finding citing it. */
function bankReadingLinkedAccounts(): { bank: Bank; answers: MissionToolAnswer[] } {
  const answers: MissionToolAnswer[] = [];
  const model: MissionModel = {
    async runMission(request) {
      const answer = await request.callTool("read_linked_accounts", {});
      answers.push(answer);
      return {
        title: "What you owe",
        facts: [{ label: "Linked accounts", value: "Read", toolCallId: answer.toolCallId }],
        options: [{ key: "not_now" }],
        agentsView: null,
        cantKnow: null,
        report: null,
      };
    },
  };
  return { bank: createBank({ db: openTestDatabase(), clock: fixedClock(SIMULATION_START), missionModel: model }), answers };
}

async function ask(bank: Bank, customer: Customer, question = "What do I owe?") {
  const mission = await bank.startMission(customer, question).ended;
  return { mission, finding: bank.customerData.getFinding(customer, mission.findingId ?? -1) };
}

/** 9am in New York (EDT) on 23 May 2027, the day Sam's seeded Consents end. */
const MAY_23_2027_9AM = new Date("2027-05-23T13:00:00Z");

describe("The Linked accounts Mission tool", () => {
  it("returns Institution, type and balance in cents for each of Sam's Linked accounts, and reads as “Linked accounts”", async () => {
    const { bank, answers } = bankReadingLinkedAccounts();
    const sam = signInByName(bank, "Sam Calloway");

    const { mission } = await ask(bank, sam);

    expect(answers[0]).toMatchObject({
      result: {
        linkedAccounts: [
          { institution: "Summit Card", type: "credit_card", balanceCents: -2_310_55 },
          { institution: "Northwind", type: "retirement", balanceCents: 41_200_00 },
          { institution: "Keystone Student Lending", type: "loan", balanceCents: -14_800_00 },
        ],
      },
    });
    expect(mission.state).toBe("reported");
    expect(mission.readList).toEqual([{ tool: "read_linked_accounts", item: "Linked accounts" }]);
  });

  it("leaves out Linked accounts whose Consent has ended", async () => {
    const { bank, answers } = bankReadingLinkedAccounts();
    const sam = signInByName(bank, "Sam Calloway");
    bank.linkAccount(sam, "harbor-credit-union");
    bank.clock.setTo(MAY_23_2027_9AM);

    await ask(bank, sam);

    expect(answers[0]).toMatchObject({
      result: { linkedAccounts: [{ institution: "Harbor Credit Union", type: "checking", balanceCents: 2_140_00 }] },
    });
  });

  it("gives facts citing it a Source naming the Institutions and the last Sync date, which pass the Finding checks", async () => {
    const { bank } = bankReadingLinkedAccounts();
    const sam = signInByName(bank, "Sam Calloway");

    const { finding } = await ask(bank, sam);

    expect(finding?.facts).toEqual([
      {
        label: "Linked accounts",
        value: "Read",
        source: "From your Linked accounts at Summit Card, Northwind and Keystone Student Lending, last synced Thu 19 Nov",
      },
    ]);
  });

  it("names the latest Sync in its Source once a Linked account syncs later than the others", async () => {
    const { bank } = bankReadingLinkedAccounts();
    const sam = signInByName(bank, "Sam Calloway");
    bank.clock.setTo(new Date("2026-11-21T14:00:00Z"));
    bank.linkAccount(sam, "harbor-credit-union");

    const { finding } = await ask(bank, sam);

    expect(finding?.facts[0]?.source).toBe(
      "From your Linked accounts at Summit Card, Northwind, Keystone Student Lending and Harbor Credit Union, last synced Sat 21 Nov",
    );
  });

  it("says in its Source when the customer has no Linked account to read", async () => {
    const { bank, answers } = bankReadingLinkedAccounts();
    const priya = signInByName(bank, "Priya Natarajan");

    const { finding } = await ask(bank, priya);

    expect(answers[0]).toMatchObject({ result: { linkedAccounts: [] } });
    expect(finding?.facts[0]?.source).toBe("From your Linked accounts: none with a Consent that lasts");
  });

  it("is listed in the Mission's access log entry by Your agent", async () => {
    const { bank } = bankReadingLinkedAccounts();
    const sam = signInByName(bank, "Sam Calloway");
    const agentEntries = () => bank.readPrivacy(sam).accessLog.filter((entry) => entry.who === "agent");
    const before = agentEntries().length;

    await ask(bank, sam);

    expect(agentEntries()).toHaveLength(before + 1);
    expect(agentEntries()).toContainEqual(
      expect.objectContaining({ who: "agent", what: "Linked accounts", why: "To answer your Mission: “What do I owe?”" }),
    );
  });

  it("sends the model only Institution, type and balance: no customer name and no ids", async () => {
    const { bank, answers } = bankReadingLinkedAccounts();
    const sam = signInByName(bank, "Sam Calloway");
    bank.linkAccount(sam, "harbor-credit-union");

    await ask(bank, sam);

    const answer = answers[0];
    if (!answer || !("result" in answer)) throw new Error("read_linked_accounts gave no result");
    const { linkedAccounts } = answer.result as { linkedAccounts: Record<string, unknown>[] };
    expect(linkedAccounts).toHaveLength(4);
    for (const linked of linkedAccounts) expect(Object.keys(linked).sort()).toEqual(["balanceCents", "institution", "type"]);
    const text = JSON.stringify(answer.result);
    for (const part of sam.name.split(" ")) expect(text).not.toContain(part);
    expect(text).not.toMatch(/"(id|customerId|institutionAccount)"|summit-card|harbor-credit-union/);
  });

  it("reads only the asking customer's Linked accounts: Sam and Priya each link different accounts", async () => {
    const { bank, answers } = bankReadingLinkedAccounts();
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");
    bank.linkAccount(sam, "lakeside-bank");
    bank.linkAccount(priya, "harbor-credit-union");

    const [samsMission, priyasMission] = await Promise.all([ask(bank, sam), ask(bank, priya)]);

    const institutionsIn = (answer: MissionToolAnswer | undefined) =>
      answer && "result" in answer
        ? (answer.result as { linkedAccounts: { institution: string }[] }).linkedAccounts.map((linked) => linked.institution)
        : [];
    expect(institutionsIn(answers[0])).toEqual(["Summit Card", "Northwind", "Keystone Student Lending", "Lakeside Bank"]);
    expect(institutionsIn(answers[1])).toEqual(["Harbor Credit Union"]);
    expect(samsMission.finding?.facts[0]?.source).not.toContain("Harbor Credit Union");
    expect(priyasMission.finding?.facts[0]?.source).toBe("From your Linked accounts at Harbor Credit Union, last synced Thu 19 Nov");
    expect(JSON.stringify(bank.readPrivacy(priya).accessLog)).not.toMatch(/Summit|Northwind|Keystone|Lakeside/);
  });
});

describe("The fake model's script for “What do I owe?”", () => {
  it("reads Sam's Linked accounts and reports what he owes on each, citing them", async () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");

    const { mission, finding } = await ask(bank, sam);

    expect(mission.readList).toEqual([{ tool: "read_linked_accounts", item: "Linked accounts" }]);
    const source = "From your Linked accounts at Summit Card, Northwind and Keystone Student Lending, last synced Thu 19 Nov";
    expect(finding).toMatchObject({
      title: "You owe $17,110.55 across 2 Linked accounts",
      facts: [
        { label: "Summit Card credit card", value: "$2,310.55 owed", source },
        { label: "Keystone Student Lending loan", value: "$14,800.00 owed", source },
        { label: "Owed in all", value: "$17,110.55", source },
        { label: "Held in your other Linked accounts", value: "$41,200.00", source },
        { label: "What Plinth can't know", source: "Not in your Plinth data" },
      ],
    });
    expect(finding?.options.map((option) => option.key)).toEqual(["read_report", "not_now"]);
    expect(finding?.report).toContain("Summit Card credit card: $2,310.55 owed");
  });

  it("tells Priya, with no Linked accounts, that there is nothing to read", async () => {
    const bank = openTestBank();
    const priya = signInByName(bank, "Priya Natarajan");

    const { mission, finding } = await ask(bank, priya, "How much debt do I have?");

    expect(mission.state).toBe("reported");
    expect(finding).toMatchObject({
      title: "You have no Linked accounts for your agent to read",
      facts: [
        { label: "Linked accounts with a Consent that lasts", value: "None", source: "From your Linked accounts: none with a Consent that lasts" },
      ],
    });
  });
});

describe("The Forecast and the Projection", () => {
  it("stay Plinth-only: linking an account changes neither what read_forecast nor what read_projection returns", async () => {
    const results: unknown[] = [];
    const model: MissionModel = {
      async runMission(request) {
        const forecast = await request.callTool("read_forecast", {});
        const projection = await request.callTool("read_projection", {});
        results.push([forecast, projection].map((answer) => ("result" in answer ? answer.result : answer.error)));
        throw new Error("Done reading");
      },
    };
    const bank = createBank({ db: openTestDatabase(), clock: fixedClock(SIMULATION_START), missionModel: model });
    const sam = signInByName(bank, "Sam Calloway");

    await bank.startMission(sam, "Read the Forecast").ended;
    bank.linkAccount(sam, "harbor-credit-union");
    bank.linkAccount(sam, "lakeside-bank");
    await bank.startMission(sam, "Read the Forecast again").ended;

    expect(results).toHaveLength(2);
    expect(results[1]).toEqual(results[0]);
    expect(JSON.stringify(results[0])).not.toMatch(/Harbor|Lakeside|Summit|Northwind|Keystone/);
  });
});
