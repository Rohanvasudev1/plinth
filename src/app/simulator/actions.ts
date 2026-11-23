"use server";

import { revalidatePath } from "next/cache";
import { getAppBank } from "@/app-bank";
import { localDateOf } from "@/calendar";
import { formatDollars, parseDollars } from "@/money";
import type { Customer } from "@/customer-data";
import { requireCustomer } from "@/session";
import { CardDeclinedError, type PostedPaycheck } from "@/simulator";

/** What the last Simulator button did, shown under the buttons. */
export interface SimulatorResult {
  ok: boolean;
  message: string;
}

/**
 * Describes the signed-in customer's own paychecks. The clock posts every customer's paychecks,
 * but a customer only hears about theirs.
 */
function describePaychecks(customer: Customer, paychecks: PostedPaycheck[]): string[] {
  return paychecks
    .filter((paycheck) => paycheck.customerId === customer.id)
    .map((paycheck) => {
      const what = `${paycheck.employerName} paycheck of ${formatDollars(paycheck.amount)} for ${paycheck.payDate}`;
      return paycheck.created ? `Posted your ${what}.` : `Your ${what} already posted. Nothing changed.`;
    });
}

/** Runs the clock button that was pressed: "Post paycheck" or "Advance clock one day". */
export async function runClock(_previous: SimulatorResult | null, form: FormData): Promise<SimulatorResult> {
  const customer = await requireCustomer();
  const bank = getAppBank();
  let message: string[];
  if (form.get("button") === "advance") {
    const advanced = bank.advanceClock();
    message = [`Moved the clock to ${localDateOf(advanced.now)}.`, ...describePaychecks(customer, advanced.paychecks)];
  } else {
    const paychecks = bank.postPaycheck();
    message = describePaychecks(customer, paychecks);
    if (message.length === 0) message = [`No paycheck of yours is due on ${localDateOf(bank.clock.now())}.`];
  }
  revalidatePath("/", "layout");
  return { ok: true, message: message.join(" ") };
}

export async function cardPurchase(_previous: SimulatorResult | null, form: FormData): Promise<SimulatorResult> {
  const customer = await requireCustomer();
  const bank = getAppBank();
  let amount;
  try {
    amount = parseDollars(String(form.get("amount") ?? ""));
  } catch {
    return { ok: false, message: "Enter an amount in dollars, such as 25 or 25.50." };
  }
  const accountId = Number(form.get("accountId"));
  const purchaseId = String(form.get("purchaseId") ?? "");
  if (purchaseId === "") return { ok: false, message: "Reload the page and try again." };
  try {
    const posted = bank.cardPurchase(customer, { accountId, amount, idempotencyKey: `card:${purchaseId}` });
    revalidatePath("/", "layout");
    const account = bank.customerData.getAccount(customer, accountId);
    return posted.created
      ? { ok: true, message: `Spent ${formatDollars(amount)} from ${account?.name ?? "the account"} at the Merchant.` }
      : { ok: true, message: "That purchase already went through. Nothing changed." };
  } catch (error) {
    if (error instanceof CardDeclinedError) return { ok: false, message: `Declined: ${error.message}.` };
    throw error;
  }
}
