import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAppBank } from "./app-bank";
import { SIMULATION_START } from "./app-clock";
import { POST } from "./app/e2e/reset/route";
import { deleteAppDatabase } from "./db/app-database";
import { formatDollars } from "./money";
import { signInByName } from "./test-bank";

// The app's database is a file shared by every request, so these tests point it at a temporary file.
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "plinth-e2e-reset-"));
  vi.stubEnv("PLINTH_DB_PATH", path.join(dir, "plinth.db"));
});

afterEach(() => {
  deleteAppDatabase();
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

function samsBalances(): string[] {
  const bank = getAppBank();
  const home = bank.readHome(signInByName(bank, "Sam Calloway"));
  const accounts = home.checking ? [home.checking, ...home.savings] : home.savings;
  return accounts.map((account) => `${account.name} ${formatDollars(account.balance)}`);
}

describe("replacing the app database restores the seed", () => {
  it("puts back the seeded balances, an empty Decision log and the simulation start time", () => {
    const before = getAppBank();
    before.advanceClock();
    expect(samsBalances()).toEqual(["Checking $3,127.00", "House fund $12,740.00"]);

    deleteAppDatabase();

    const after = getAppBank();
    expect(after.clock.now()).toEqual(SIMULATION_START);
    expect(samsBalances()).toEqual(["Checking $227.00", "House fund $12,400.00"]);
    expect(after.readDecisionLog(signInByName(after, "Sam Calloway"))).toEqual([]);
  });

  it("leaves a working agent, so the next paycheck sweeps again", () => {
    getAppBank().advanceClock();
    deleteAppDatabase();

    const bank = getAppBank();
    bank.advanceClock();

    const decisions = bank.readDecisionLog(signInByName(bank, "Sam Calloway"));
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.result).toBe("Done");
    expect(samsBalances()).toEqual(["Checking $3,127.00", "House fund $12,740.00"]);
  });
});

describe("the end-to-end reset route", () => {
  it("restores the seed when the app runs for end-to-end tests", async () => {
    vi.stubEnv("PLINTH_E2E", "1");
    getAppBank().advanceClock();

    const response = await POST();

    expect(response.status).toBe(204);
    expect(getAppBank().clock.now()).toEqual(SIMULATION_START);
    expect(samsBalances()).toEqual(["Checking $227.00", "House fund $12,400.00"]);
  });

  it("restores the seeded history, without what posted after the simulation start", async () => {
    vi.stubEnv("PLINTH_E2E", "1");
    const samsLedgerKeys = () => {
      const bank = getAppBank();
      return bank.customerData.listLedgerTransactions(signInByName(bank, "Sam Calloway")).map((t) => t.idempotencyKey);
    };
    const seeded = samsLedgerKeys();
    getAppBank().advanceClock();

    await POST();

    expect(seeded).toContain("payroll:acme-corp:2026-05-08");
    expect(samsLedgerKeys()).toEqual(seeded);
  });

  it("isn't there in a normal run, and changes nothing", async () => {
    getAppBank().advanceClock();

    const response = await POST();

    expect(response.status).toBe(404);
    expect(samsBalances()).toEqual(["Checking $3,127.00", "House fund $12,740.00"]);
  });

  it("isn't there in a production run, even with the end-to-end flag set", async () => {
    vi.stubEnv("PLINTH_E2E", "1");
    vi.stubEnv("NODE_ENV", "production");
    getAppBank().advanceClock();

    const response = await POST();

    expect(response.status).toBe(404);
    expect(samsBalances()).toEqual(["Checking $3,127.00", "House fund $12,740.00"]);
  });
});
