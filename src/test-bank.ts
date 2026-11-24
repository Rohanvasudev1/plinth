import { SIMULATION_START } from "./app-clock";
import { createBank, type Bank } from "./bank";
import { fixedClock } from "./clock";
import type { Customer, LedgerEntryInput } from "./customer-data";
import type { Decision } from "./decisions";
import { openTestDatabase } from "./db/database";
import { cents } from "./money";

/** A seeded bank on a fresh in-memory database, with the clock pinned to the simulation start. */
export function openTestBank(): Bank {
  return createBank({ db: openTestDatabase(), clock: fixedClock(SIMULATION_START) });
}

export function signInByName(bank: Bank, name: string): Customer {
  const customer = bank.listCustomers().find((candidate) => candidate.name === name);
  if (!customer) throw new Error(`No seeded customer named ${name}`);
  return bank.signIn(customer.id);
}

/** The customer's Decision log without their own changes, such as switching a Rule: only what the agent did. */
export function agentEntriesIn(bank: Bank, customer: Customer): Decision[] {
  return bank.readDecisionLog(customer).filter((entry) => entry.actor === "agent");
}

/** The pair of entries that moves `amount` from one account to another. */
export function entriesMoving(amount: number, from: number, to: number): LedgerEntryInput[] {
  return [
    { accountId: from, amount: cents(-amount) },
    { accountId: to, amount: cents(amount) },
  ];
}
