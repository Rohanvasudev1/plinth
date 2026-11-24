import { describe, expect, it } from "vitest";
import { SettingsError } from "./settings";
import { openTestBank, signInByName } from "./test-bank";

describe("settings record", () => {
  it("is seeded for Sam at version 1: act within my rules, advice on request, every data choice off", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");

    expect(bank.readSettings(sam)).toEqual({
      version: 1,
      autonomyLevel: "within_rules",
      adviceSetting: "on_request",
      riskAnswers: { marketDrop: "wait", timeHorizon: "over_10_years" },
      dataChoices: { trainModels: false, shareWithPartners: false, keepChatHistory: false },
      goalPreferences: ["buy_home"],
      createdAt: new Date("2026-11-19T14:00:00Z"),
    });
  });

  it("a change writes the next version and a Decision log entry with Sam as actor, keeping the old version", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const before = bank.readSettings(sam);

    const changed = bank.changeSettings(sam, {
      autonomyLevel: "ask_first",
      dataChoices: { trainModels: false, shareWithPartners: false, keepChatHistory: true },
    });

    expect(changed).toMatchObject({
      version: 2,
      autonomyLevel: "ask_first",
      adviceSetting: "on_request",
      dataChoices: { trainModels: false, shareWithPartners: false, keepChatHistory: true },
      goalPreferences: ["buy_home"],
    });
    expect(bank.readSettings(sam)).toEqual(changed);
    expect(bank.customerData.getSettings(sam, 1)).toEqual(before);
    expect(bank.readDecisionLog(sam)).toEqual([
      expect.objectContaining({
        actor: "customer",
        trigger: { ledgerEventId: null, description: "You changed your settings" },
        rule: null,
        action: "Changed your settings: Autonomy level, Keep chat history",
        amount: 0,
        result: "Done",
        refusedBy: null,
        why: [
          { label: "Trigger", value: "You changed your settings" },
          { label: "Settings", value: "Version 1 to version 2" },
          { label: "Autonomy level", value: "Act on anything within my rules → Ask me before everything" },
          { label: "Keep chat history", value: "Off → On" },
        ],
      }),
    ]);
  });

  it("refuses settings that don't match the record's schema, and saves nothing", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const before = bank.readSettings(sam);

    for (const change of [
      { autonomyLevel: "do_anything" },
      { adviceSetting: "loudly" },
      { riskAnswers: { marketDrop: "panic", timeHorizon: "over_10_years" } },
      { dataChoices: { trainModels: "yes", shareWithPartners: false, keepChatHistory: false } },
      { goalPreferences: ["buy_home", "buy_home"] },
      { goalPreferences: ["buy_a_boat"] },
    ]) {
      expect(() => bank.changeSettings(sam, change as never)).toThrow(SettingsError);
    }

    expect(bank.readSettings(sam)).toEqual(before);
    expect(bank.readDecisionLog(sam)).toEqual([]);
  });

  it("Priya can't read or change Sam's settings: each customer sees only their own record", () => {
    const bank = openTestBank();
    const sam = signInByName(bank, "Sam Calloway");
    const priya = signInByName(bank, "Priya Natarajan");

    bank.changeSettings(priya, { adviceSetting: "always" });

    expect(bank.readSettings(sam)).toMatchObject({ version: 1, adviceSetting: "on_request" });
    expect(bank.readSettings(priya)).toMatchObject({ version: 2, adviceSetting: "always", goalPreferences: ["travel"] });
    expect(bank.readDecisionLog(sam)).toEqual([]);
  });
});
