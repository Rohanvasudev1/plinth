import { SIMULATION_START } from "./app-clock";
import { createBank, type Bank } from "./bank";
import { fixedClock } from "./clock";
import type { Customer } from "./customer-data";
import { openTestDatabase } from "./db/database";

/** A seeded bank on a fresh in-memory database, with the clock pinned to the simulation start. */
export function openTestBank(): Bank {
  return createBank({ db: openTestDatabase(), clock: fixedClock(SIMULATION_START) });
}

export function signInByName(bank: Bank, name: string): Customer {
  const customer = bank.listCustomers().find((candidate) => candidate.name === name);
  if (!customer) throw new Error(`No seeded customer named ${name}`);
  return bank.signIn(customer.id);
}
