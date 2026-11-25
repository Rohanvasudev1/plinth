"use server";

import { revalidatePath } from "next/cache";
import { getAppBank } from "@/app-bank";
import { localDateOf } from "@/calendar";
import { formatDollars, parseDollars } from "@/money";
import type { Customer } from "@/customer-data";
import { requireCustomer } from "@/session";
import { CardDeclinedError, isMerchantKey, MERCHANTS, type PostedTransaction } from "@/simulator";
import { SplitError } from "@/split";

/** What the last Simulator button did, shown under the buttons. */
export interface SimulatorResult {
  ok: boolean;
  message: string;
}

/**
 * Describes the signed-in customer's own paychecks and bills. The clock posts every customer's,
 * but a customer only hears about theirs.
 */
function describePosted(customer: Customer, posted: PostedTransaction[]): string[] {
  return posted
    .filter((transaction) => transaction.customerId === customer.id)
    .map((transaction) => {
      const [done, what] =
        transaction.kind === "paycheck"
          ? ["Posted", `${transaction.employerName} paycheck of ${formatDollars(transaction.amount)} for ${transaction.date}`]
          : ["Paid", `${transaction.payee} bill of ${formatDollars(transaction.amount)} due ${transaction.date}`];
      return transaction.created ? `${done} your ${what}.` : `Your ${what} already posted. Nothing changed.`;
    });
}

/** Runs the clock button that was pressed: "Post paycheck" or "Advance clock one day". */
export async function runClock(_previous: SimulatorResult | null, form: FormData): Promise<SimulatorResult> {
  const customer = await requireCustomer();
  const bank = getAppBank();
  let message: string[];
  if (form.get("button") === "advance") {
    const advanced = bank.advanceClock();
    message = [`Moved the clock to ${localDateOf(advanced.now)}.`, ...describePosted(customer, advanced.posted)];
  } else {
    const paychecks = bank.postPaycheck();
    message = describePosted(customer, paychecks);
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
  const merchant = String(form.get("merchant") ?? "");
  if (!isMerchantKey(merchant)) return { ok: false, message: "Pick a Merchant." };
  const accountId = Number(form.get("accountId"));
  const purchaseId = String(form.get("purchaseId") ?? "");
  if (purchaseId === "") return { ok: false, message: "Reload the page and try again." };
  try {
    const posted = bank.cardPurchase(customer, { accountId, merchant, amount, idempotencyKey: `card:${purchaseId}` });
    revalidatePath("/", "layout");
    const account = bank.customerData.getAccount(customer, accountId);
    return posted.created
      ? { ok: true, message: `Spent ${formatDollars(amount)} from ${account?.name ?? "the account"} at ${MERCHANTS[merchant].name}.` }
      : { ok: true, message: "That purchase already went through. Nothing changed." };
  } catch (error) {
    if (error instanceof CardDeclinedError) return { ok: false, message: `Declined: ${error.message}.` };
    throw error;
  }
}

/**
 * Plays an Outside contact adding a Shared cost they paid. The form's `member` names an Outside contact and Group pair
 * from the signed-in customer's own Groups by its key, so the Simulator names no other Group.
 */
export async function outsideContactSharedCost(_previous: SimulatorResult | null, form: FormData): Promise<SimulatorResult> {
  const customer = await requireCustomer();
  const bank = getAppBank();
  const pair = bank
    .listOutsideContactsInGroups(customer)
    .find((candidate) => candidate.key === String(form.get("member") ?? ""));
  if (!pair) return { ok: false, message: "Pick who adds it and to which Group." };
  let amount;
  try {
    amount = parseDollars(String(form.get("amount") ?? ""));
  } catch {
    return { ok: false, message: "Enter an amount in dollars, such as 25 or 25.50." };
  }
  try {
    const cost = bank.outsideContactAddsSharedCost(pair.outsideContactId, {
      groupId: pair.groupId,
      description: String(form.get("description") ?? ""),
      amount,
    });
    revalidatePath("/", "layout");
    return { ok: true, message: `${pair.name} added ${cost.description}, ${formatDollars(cost.amount)}, to ${pair.groupName}.` };
  } catch (error) {
    if (error instanceof SplitError) return { ok: false, message: `Refused: ${error.message}.` };
    throw error;
  }
}
