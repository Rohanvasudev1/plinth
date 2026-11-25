import { describe, expect, it } from "vitest";
import type { Bank, SplitView } from "./bank";
import { cents } from "./money";
import { SplitError } from "./split";
import { openTestBank, signInByName } from "./test-bank";

/** Each other Member's net with the customer in the named Group, by name: above zero, they owe the customer. */
function netsIn(view: SplitView, groupName: string): Record<string, number> {
  const group = view.groups.find((candidate) => candidate.name === groupName);
  if (!group) throw new Error(`No Group named ${groupName} in this view`);
  return Object.fromEntries(group.otherMembers.map((member) => [member.name, member.net]));
}

function groupNamed(bank: Bank, customerName: string, groupName: string) {
  const group = bank.readSplit(signInByName(bank, customerName)).groups.find((candidate) => candidate.name === groupName);
  if (!group) throw new Error(`${customerName} has no Group named ${groupName}`);
  return group;
}

describe("Split", () => {
  it("shows Sam on 19 Nov that Alex owes $133.04, Jordan owes $129.04 and Sam owes Priya $320.00", () => {
    const bank = openTestBank();
    const view = bank.readSplit(signInByName(bank, "Sam Calloway"));
    expect(view.groups.map((group) => group.name)).toEqual(["Flatmates", "Lisbon trip"]);
    expect(netsIn(view, "Flatmates")).toEqual({ "Alex Okafor": 133_04, "Jordan Reyes": 129_04 });
    expect(netsIn(view, "Lisbon trip")).toEqual({ "Priya Natarajan": -320_00 });
    expect(view.summary).toEqual({ owedToYou: 262_08, youOwe: 320_00, net: -57_92 });
  });

  it("shows Alex owing Sam $133.04 and Jordan $4.00, and Priya only Lisbon trip, where Sam owes her $320.00", () => {
    const bank = openTestBank();
    const alex = bank.readSplit(signInByName(bank, "Alex Okafor"));
    expect(alex.groups.map((group) => group.name)).toEqual(["Flatmates"]);
    expect(netsIn(alex, "Flatmates")).toEqual({ "Sam Calloway": -133_04, "Jordan Reyes": -4_00 });
    expect(alex.summary).toEqual({ owedToYou: 0, youOwe: 137_04, net: -137_04 });

    const priya = bank.readSplit(signInByName(bank, "Priya Natarajan"));
    expect(priya.groups.map((group) => group.name)).toEqual(["Lisbon trip"]);
    expect(netsIn(priya, "Lisbon trip")).toEqual({ "Sam Calloway": 320_00 });
    expect(priya.groups[0]?.otherMembers[0]?.status).toBe("owes_you");
  });

  it("lists Flatmates' Shared costs newest first, with who paid and Sam's Share, leftover cents going to the payer", () => {
    const bank = openTestBank();
    const flatmates = groupNamed(bank, "Sam Calloway", "Flatmates");
    expect(flatmates.memberNames).toEqual(["Sam Calloway", "Alex Okafor", "Jordan Reyes"]);
    expect(
      flatmates.sharedCosts.map((cost) => [cost.date, cost.description, cost.amount, cost.paidByName, cost.yourShare]),
    ).toEqual([
      ["2026-11-16", "Green Basket Market", 291_15, "Sam Calloway", 97_05],
      ["2026-11-12", "Dish soap and bin bags", 24_00, "Alex Okafor", 8_00],
      ["2026-11-06", "Cleaning supplies", 36_00, "Jordan Reyes", 12_00],
      ["2026-11-03", "Power", 70_00, "Sam Calloway", 23_34],
      ["2026-11-02", "Internet", 62_00, "Sam Calloway", 20_68],
    ]);
    const alexsShares = groupNamed(bank, "Alex Okafor", "Flatmates").sharedCosts.map((cost) => cost.yourShare);
    expect(alexsShares).toEqual([97_05, 8_00, 12_00, 23_33, 20_66]);
  });

  it("splits $274.60 three ways as $91.53 each for the others and $91.54 for the payer", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const flatmates = groupNamed(bank, "Sam Calloway", "Flatmates");
    bank.addSharedCost(sam, { groupId: flatmates.id, description: "Green Basket Market", amount: cents(274_60) });
    const added = (name: string) => groupNamed(bank, name, "Flatmates").sharedCosts[0]?.yourShare;
    expect([added("Sam Calloway"), added("Alex Okafor")]).toEqual([91_54, 91_53]);
    expect(netsIn(bank.readSplit(sam), "Flatmates")).toEqual({ "Alex Okafor": 224_57, "Jordan Reyes": 220_57 });
  });

  it("adds a Shared cost by hand, dated today and paid by the customer, posting no ledger transaction", () => {
    const bank = openTestBank();
    const alex = signInByName(bank, "Alex Okafor");
    const before = bank.customerData.listLedgerTransactions(alex).length;
    const flatmates = groupNamed(bank, "Alex Okafor", "Flatmates");
    bank.addSharedCost(alex, { groupId: flatmates.id, description: "Takeaway on Friday", amount: cents(48_00) });

    expect(bank.customerData.listLedgerTransactions(alex)).toHaveLength(before);
    expect(groupNamed(bank, "Alex Okafor", "Flatmates").sharedCosts[0]).toMatchObject({
      date: "2026-11-19",
      description: "Takeaway on Friday",
      paidByName: "Alex Okafor",
      paidByYou: true,
      yourShare: 16_00,
    });
    expect(netsIn(bank.readSplit(alex), "Flatmates")).toEqual({ "Sam Calloway": -117_04, "Jordan Reyes": 12_00 });
  });

  it("refuses a blank or zero Shared cost, adding nothing", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const { id: groupId } = groupNamed(bank, "Sam Calloway", "Lisbon trip");
    expect(() => bank.addSharedCost(sam, { groupId, description: "  ", amount: cents(10_00) })).toThrow(SplitError);
    expect(() => bank.addSharedCost(sam, { groupId, description: "Taxi", amount: cents(0) })).toThrow(SplitError);
    expect(groupNamed(bank, "Sam Calloway", "Lisbon trip").sharedCosts).toHaveLength(1);
  });

  it("refuses a non-member reading or adding to a Group, changing nothing", () => {
    const bank = openTestBank();
    const priya = signInByName(bank, "Priya Natarajan");
    const flatmates = groupNamed(bank, "Sam Calloway", "Flatmates");
    expect(() => bank.readGroup(priya, flatmates.id)).toThrow(SplitError);
    expect(() => bank.addSharedCost(priya, { groupId: flatmates.id, description: "Snacks", amount: cents(9_00) })).toThrow(
      SplitError,
    );
    expect(groupNamed(bank, "Sam Calloway", "Flatmates").sharedCosts).toHaveLength(5);
  });

  it("lets Jordan, through the Simulator, add a Shared cost only to a Group Jordan is in", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const [jordan] = bank.listOutsideContactsInGroups(sam);
    if (!jordan) throw new Error("Sam shares no Group with an Outside contact");
    expect(jordan).toMatchObject({ name: "Jordan Reyes", groupName: "Flatmates" });

    bank.outsideContactAddsSharedCost(jordan.outsideContactId, {
      groupId: jordan.groupId,
      description: "Toilet paper",
      amount: cents(15_00),
    });
    expect(netsIn(bank.readSplit(sam), "Flatmates")).toEqual({ "Alex Okafor": 133_04, "Jordan Reyes": 124_04 });

    const lisbon = groupNamed(bank, "Sam Calloway", "Lisbon trip");
    expect(() =>
      bank.outsideContactAddsSharedCost(jordan.outsideContactId, { groupId: lisbon.id, description: "Taxi", amount: cents(20_00) }),
    ).toThrow(SplitError);
    expect(bank.listOutsideContactsInGroups(signInByName(bank, "Priya Natarajan"))).toEqual([]);
  });

  it("keeps each customer's view to their own Groups and figures when Sam and Priya both add a Shared cost", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");
    const flatmates = groupNamed(bank, "Sam Calloway", "Flatmates");
    const lisbon = groupNamed(bank, "Priya Natarajan", "Lisbon trip");
    bank.addSharedCost(sam, { groupId: flatmates.id, description: "Light bulbs", amount: cents(30_00) });
    bank.addSharedCost(priya, { groupId: lisbon.id, description: "Museum tickets", amount: cents(50_00) });

    const samsView = bank.readSplit(sam);
    expect(samsView.groups.map((group) => group.name)).toEqual(["Flatmates", "Lisbon trip"]);
    expect(netsIn(samsView, "Flatmates")).toEqual({ "Alex Okafor": 143_04, "Jordan Reyes": 139_04 });
    expect(netsIn(samsView, "Lisbon trip")).toEqual({ "Priya Natarajan": -345_00 });
    expect(samsView.summary).toEqual({ owedToYou: 282_08, youOwe: 345_00, net: -62_92 });
    // Sam sees only nets with Sam: never what Alex and Jordan owe each other.
    for (const group of samsView.groups) {
      expect(group.otherMembers.map((member) => member.name)).not.toContain("Sam Calloway");
    }

    const priyasView = bank.readSplit(priya);
    expect(priyasView.groups.map((group) => group.name)).toEqual(["Lisbon trip"]);
    expect(netsIn(priyasView, "Lisbon trip")).toEqual({ "Sam Calloway": 345_00 });
    expect(priyasView.summary).toEqual({ owedToYou: 345_00, youOwe: 0, net: 345_00 });
    expect(JSON.stringify(priyasView)).not.toMatch(/Flatmates|Light bulbs|Alex|Jordan/);
  });

  it("writes no access log entry when a Member views their own Split page", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const before = bank.readPrivacy(sam).accessLog.length;
    bank.readSplit(sam);
    expect(bank.readPrivacy(sam).accessLog).toHaveLength(before);
  });
});
