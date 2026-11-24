import { describe, expect, it } from "vitest";
import { cents } from "./money";
import { RuleParametersError } from "./rules";
import { SettingsError } from "./settings";
import { GoalError } from "./goals";
import type { SetupAnswers } from "./setup-answers";
import { openTestBank, signInByName } from "./test-bank";

/** Alex's answers: two savings goals around Clear debt, ask first, a $1,000 Buffer and a $250 Payment limit. */
const ALEX_ANSWERS: SetupAnswers = {
  goalPreferences: ["travel", "clear_debt", "buy_home"],
  autonomyLevel: "ask_first",
  adviceSetting: "always",
  buffer: cents(1_000_00),
  paymentLimit: cents(250_00),
  riskAnswers: { marketDrop: "buy_more", timeHorizon: "3_to_10_years" },
  dataChoices: { trainModels: false, shareWithPartners: false, keepChatHistory: true },
};

describe("Setup survey", () => {
  it("seeds Alex Okafor with no settings record, $400 in Checking and an Acme Corp payroll from Friday 27 Nov", () => {
    const bank = openTestBank();
    const alex = signInByName(bank, "Alex Okafor");

    expect(bank.readSettings(alex)).toBeUndefined();
    expect(bank.customerData.listRules(alex)).toEqual([]);
    expect(bank.customerData.listAccounts(alex)).toEqual([
      expect.objectContaining({ kind: "checking", name: "Checking", balance: 400_00, goalTarget: null }),
    ]);
    const [checking] = bank.customerData.listAccounts(alex);
    expect(bank.customerData.listPayrolls(alex)).toEqual([
      expect.objectContaining({
        accountId: checking?.id,
        employer: "acme-corp",
        amount: 2_100_00,
        firstPayDate: "2026-11-27",
        intervalDays: 14,
      }),
    ]);
  });

  it("finishing writes the settings record, the Rules, one account per savings goal and Decision log entries", () => {
    const bank = openTestBank();
    const alex = signInByName(bank, "Alex Okafor");

    const settings = bank.finishSetup(alex, ALEX_ANSWERS);

    expect(settings).toMatchObject({
      version: 1,
      autonomyLevel: "ask_first",
      adviceSetting: "always",
      riskAnswers: { marketDrop: "buy_more", timeHorizon: "3_to_10_years" },
      dataChoices: { trainModels: false, shareWithPartners: false, keepChatHistory: true },
      goalPreferences: ["travel", "clear_debt", "buy_home"],
    });
    expect(bank.readSettings(alex)).toEqual(settings);
    const [checking, travel, home, ...others] = bank.customerData.listAccounts(alex);
    expect(others).toEqual([]);
    expect(checking).toMatchObject({ kind: "checking", balance: 400_00 });
    expect(travel).toMatchObject({ kind: "savings", name: "Travel fund", goal: "travel", balance: 0, goalTarget: null });
    expect(home).toMatchObject({ kind: "savings", name: "House fund", goal: "buy_home", balance: 0, goalTarget: null });
    expect(bank.customerData.listRules(alex)).toEqual([
      expect.objectContaining({
        kind: "buffer",
        version: 1,
        on: true,
        parameters: { checkingAccountId: checking?.id, savingsAccountId: travel?.id, buffer: 1_000_00 },
      }),
      expect.objectContaining({ kind: "payment_limit", version: 1, on: true, parameters: { paymentLimit: 250_00 } }),
    ]);
    const [bufferRule, limitRule] = bank.customerData.listRules(alex);
    expect(bank.readDecisionLog(alex).map(({ actor, trigger, rule, action, result, amount }) => ({ actor, trigger: trigger.description, rule, action, result, amount }))).toEqual([
      {
        actor: "customer",
        trigger: "You finished the Setup survey",
        rule: { id: limitRule?.id, version: 1 },
        action: "Set the Payment limit to $250",
        result: "Done",
        amount: 0,
      },
      {
        actor: "customer",
        trigger: "You finished the Setup survey",
        rule: { id: bufferRule?.id, version: 1 },
        action: "Set the Buffer to $1,000, moving the rest to Travel fund",
        result: "Done",
        amount: 0,
      },
      {
        actor: "customer",
        trigger: "You finished the Setup survey",
        rule: null,
        action: "Saved your settings from the Setup survey",
        result: "Done",
        amount: 0,
      },
    ]);
  });

  it("a submit that fails at the last step, an out-of-range Payment limit, writes nothing at all", () => {
    const bank = openTestBank();
    const alex = signInByName(bank, "Alex Okafor");
    const accountsBefore = bank.customerData.listAccounts(alex);

    // The Payment limit is checked after the settings, the Goal accounts and the buffer Rule have been written.
    expect(() => bank.finishSetup(alex, { ...ALEX_ANSWERS, paymentLimit: cents(10_001_00) })).toThrow(RuleParametersError);

    expect(bank.readSettings(alex)).toBeUndefined();
    expect(bank.customerData.listAccounts(alex)).toEqual(accountsBefore);
    expect(bank.customerData.listRules(alex)).toEqual([]);
    expect(bank.readDecisionLog(alex)).toEqual([]);
  });

  it("refuses an out-of-range Buffer or unknown choices, and saves nothing", () => {
    const bank = openTestBank();
    const alex = signInByName(bank, "Alex Okafor");

    expect(() => bank.finishSetup(alex, { ...ALEX_ANSWERS, buffer: cents(100_000_01) })).toThrow(RuleParametersError);
    expect(() => bank.finishSetup(alex, { ...ALEX_ANSWERS, autonomyLevel: "do_anything" as never })).toThrow(SettingsError);

    expect(bank.readSettings(alex)).toBeUndefined();
    expect(bank.customerData.listAccounts(alex)).toHaveLength(1);
    expect(bank.readDecisionLog(alex)).toEqual([]);
  });

  it("Skip applies a $1,500 Buffer, small things, a $500 Payment limit, advice on request and every data choice off", () => {
    const bank = openTestBank();
    const alex = signInByName(bank, "Alex Okafor");

    const settings = bank.skipSetup(alex);

    expect(settings).toMatchObject({
      version: 1,
      autonomyLevel: "small_things",
      adviceSetting: "on_request",
      dataChoices: { trainModels: false, shareWithPartners: false, keepChatHistory: false },
      goalPreferences: [],
    });
    // No Goal account, and a Buffer with no sweep target until setup runs again.
    const [checking, ...others] = bank.customerData.listAccounts(alex);
    expect(others).toEqual([]);
    expect(bank.customerData.listRules(alex)).toEqual([
      expect.objectContaining({
        kind: "buffer",
        on: true,
        parameters: { checkingAccountId: checking?.id, savingsAccountId: null, buffer: 1_500_00 },
      }),
      expect.objectContaining({ kind: "payment_limit", on: true, parameters: { paymentLimit: 500_00 } }),
    ]);
    expect(bank.readDecisionLog(alex).map((entry) => entry.action)).toEqual([
      "Set the Payment limit to $500",
      "Set the Buffer to $1,500, with no savings goal to move the rest to",
      "Saved the standard settings",
    ]);
    expect(bank.readHome(alex).safeToSpend).toMatchObject({ buffer: 1_500_00 });
  });

  it("after Skip, a paycheck moves nothing, since there is no sweep target", () => {
    const bank = openTestBank();
    const alex = signInByName(bank, "Alex Okafor");
    bank.skipSetup(alex);
    const logBefore = bank.readDecisionLog(alex);

    bank.clock.setTo(new Date("2026-11-27T14:00:00Z"));
    bank.postPaycheck();

    expect(bank.customerData.listAccounts(alex)).toEqual([expect.objectContaining({ balance: 2_500_00 })]);
    expect(bank.readDecisionLog(alex)).toEqual(logBefore);
  });

  it("running setup again reuses Goal accounts, and a dropped goal keeps its account and money out of the sweep order", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const [checking, houseFund] = bank.customerData.listAccounts(sam);
    const [bufferRule, limitRule] = bank.customerData.listRules(sam);
    const sams = { ...ALEX_ANSWERS, buffer: cents(1_500_00), paymentLimit: cents(500_00) };

    const dropped = bank.finishSetup(sam, { ...sams, goalPreferences: ["emergency_cushion", "travel"] });

    expect(dropped.goalPreferences).toEqual(["emergency_cushion", "travel"]);
    const [, house, cushion, travel, ...others] = bank.customerData.listAccounts(sam);
    expect(others).toEqual([]);
    expect(house).toEqual({ ...houseFund, balance: 12_400_00, goalTarget: 40_000_00, goal: "buy_home" });
    expect(cushion).toMatchObject({ name: "Emergency cushion", goal: "emergency_cushion", balance: 0 });
    expect(travel).toMatchObject({ name: "Travel fund", goal: "travel", balance: 0 });
    expect(bank.customerData.getRule(sam, bufferRule!.id)).toMatchObject({
      version: 2,
      parameters: { checkingAccountId: checking?.id, savingsAccountId: cushion?.id, buffer: 1_500_00 },
    });
    // The Payment limit didn't change, so it gets no new version.
    expect(bank.customerData.getRule(sam, limitRule!.id)).toMatchObject({ version: 1 });
    expect(bank.readDecisionLog(sam).map((entry) => [entry.trigger.description, entry.action])).toEqual([
      ["You ran setup again", "Set the Buffer to $1,500, moving the rest to Emergency cushion"],
      ["You ran setup again", "Saved your settings from the Setup survey"],
    ]);

    bank.finishSetup(sam, { ...sams, goalPreferences: ["buy_home", "travel", "emergency_cushion"] });

    expect(bank.customerData.listAccounts(sam).map((account) => account.id)).toEqual(
      [checking, house, cushion, travel].map((account) => account?.id),
    );
    expect(bank.customerData.getRule(sam, bufferRule!.id)?.parameters).toMatchObject({ savingsAccountId: houseFund?.id });
    expect(bank.readSettings(sam)).toMatchObject({ version: 3, goalPreferences: ["buy_home", "travel", "emergency_cushion"] });
  });

  it("Alex's setup touches only Alex: Sam's settings, Rules and accounts stay as they were", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const alex = signInByName(bank, "Alex Okafor");
    const samBefore = { settings: bank.readSettings(sam), rules: bank.customerData.listRules(sam), accounts: bank.customerData.listAccounts(sam) };

    bank.finishSetup(alex, ALEX_ANSWERS);

    expect({ settings: bank.readSettings(sam), rules: bank.customerData.listRules(sam), accounts: bank.customerData.listAccounts(sam) }).toEqual(samBefore);
    expect(bank.readDecisionLog(sam)).toEqual([]);
  });

  it("a new Goal account has no target, so Home shows only its balance until the customer sets one", () => {
    const bank = openTestBank();
    const alex = signInByName(bank, "Alex Okafor");
    bank.finishSetup(alex, ALEX_ANSWERS);
    const [travel] = bank.readHome(alex).savings;
    expect(travel).toMatchObject({ name: "Travel fund", balance: 0, goal: null });

    bank.setGoalTarget(alex, travel!.id, cents(3_000_00));

    expect(bank.readHome(alex).savings).toEqual([
      expect.objectContaining({ name: "Travel fund", goal: { target: 3_000_00, percentReached: 0 } }),
      expect.objectContaining({ name: "House fund", goal: null }),
    ]);
  });

  it("refuses a target that isn't a whole-dollar amount from $1 to $10,000,000, or isn't on the customer's own savings account", () => {
    const bank = openTestBank();
    const alex = signInByName(bank, "Alex Okafor");
    const sam = signInByName(bank, "Sam Calloway");
    bank.finishSetup(alex, ALEX_ANSWERS);
    const [checking, travel] = bank.customerData.listAccounts(alex);
    const [, samsHouseFund] = bank.customerData.listAccounts(sam);

    for (const target of [0, 50, 10_000_000_01]) {
      expect(() => bank.setGoalTarget(alex, travel!.id, cents(target))).toThrow(GoalError);
    }
    expect(() => bank.setGoalTarget(alex, checking!.id, cents(1_000_00))).toThrow(GoalError);
    expect(() => bank.setGoalTarget(alex, samsHouseFund!.id, cents(1_000_00))).toThrow(GoalError);

    expect(bank.customerData.getAccount(alex, travel!.id)?.goalTarget).toBeNull();
    expect(bank.customerData.getAccount(sam, samsHouseFund!.id)?.goalTarget).toBe(40_000_00);
  });

  it("reads back the current answers for a re-run: the settings record plus the Buffer and the Payment limit", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const alex = signInByName(bank, "Alex Okafor");

    expect(bank.readSetupAnswers(alex)).toBeUndefined();
    expect(bank.readSetupAnswers(sam)).toEqual({
      goalPreferences: ["buy_home"],
      autonomyLevel: "within_rules",
      adviceSetting: "on_request",
      buffer: 1_500_00,
      paymentLimit: 500_00,
      riskAnswers: { marketDrop: "wait", timeHorizon: "over_10_years" },
      dataChoices: { trainModels: false, shareWithPartners: false, keepChatHistory: false },
    });
    bank.finishSetup(alex, ALEX_ANSWERS);
    expect(bank.readSetupAnswers(alex)).toEqual(ALEX_ANSWERS);
  });
});
