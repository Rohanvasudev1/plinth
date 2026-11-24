"use server";

import { revalidatePath } from "next/cache";
import { getAppBank } from "@/app-bank";
import { RuleNotFoundError, type Customer } from "@/customer-data";
import { formatDollarRange, formatDollarsBriefly, parseDollars, type Cents, type CentsRange } from "@/money";
import { GOAL_TARGET_RANGE, GoalError } from "@/goals";
import { BUFFER_RANGE, PAYMENT_LIMIT_RANGE, RuleParametersError } from "@/rules";
import { requireCustomer } from "@/session";

/** What the last Agent & limits form did, shown under it. */
export interface AgentFormResult {
  ok: boolean;
  message: string;
}

const RELOAD = "This Rule has changed or isn't yours. Reload the page and try again.";

/** Switches one of the signed-in customer's Rules to the state the switch was pressed toward. */
export async function switchRule(_previous: AgentFormResult | null, form: FormData): Promise<AgentFormResult> {
  const customer = await requireCustomer();
  const ruleId = Number(form.get("ruleId"));
  const on = form.get("on") === "true";
  try {
    getAppBank().switchRule(customer, ruleId, on);
  } catch (error) {
    if (error instanceof RuleNotFoundError) return { ok: false, message: RELOAD };
    throw error;
  }
  revalidatePath("/", "layout");
  return { ok: true, message: on ? "Switched on." : "Switched off." };
}

export async function setBuffer(_previous: AgentFormResult | null, form: FormData): Promise<AgentFormResult> {
  return setAmount(form, "Buffer", BUFFER_RANGE, (customer, ruleId, amount) =>
    getAppBank().setBuffer(customer, ruleId, amount),
  );
}

export async function setPaymentLimit(_previous: AgentFormResult | null, form: FormData): Promise<AgentFormResult> {
  return setAmount(form, "Payment limit", PAYMENT_LIMIT_RANGE, (customer, ruleId, amount) =>
    getAppBank().setPaymentLimit(customer, ruleId, amount),
  );
}

/** Sets the target of the Goal on one of the signed-in customer's savings accounts. */
export async function setGoalTarget(_previous: AgentFormResult | null, form: FormData): Promise<AgentFormResult> {
  const customer = await requireCustomer();
  let target: Cents;
  try {
    target = parseDollars(String(form.get("amount") ?? ""));
  } catch {
    return { ok: false, message: `A target must be a whole-dollar amount from ${formatDollarRange(GOAL_TARGET_RANGE)}. Nothing was saved.` };
  }
  try {
    getAppBank().setGoalTarget(customer, Number(form.get("accountId")), target);
  } catch (error) {
    if (error instanceof GoalError) return { ok: false, message: `${error.message}. Nothing was saved.` };
    throw error;
  }
  revalidatePath("/", "layout");
  return { ok: true, message: `Target set to ${formatDollarsBriefly(target)}.` };
}

async function setAmount(
  form: FormData,
  name: string,
  range: CentsRange,
  save: (customer: Customer, ruleId: number, amount: Cents) => unknown,
): Promise<AgentFormResult> {
  const customer = await requireCustomer();
  const outOfRange = {
    ok: false,
    message: `The ${name} must be a whole-dollar amount from ${formatDollarRange(range)}. Nothing was saved.`,
  };
  let amount: Cents;
  try {
    amount = parseDollars(String(form.get("amount") ?? ""));
  } catch {
    return outOfRange;
  }
  try {
    save(customer, Number(form.get("ruleId")), amount);
  } catch (error) {
    if (error instanceof RuleParametersError) return outOfRange;
    if (error instanceof RuleNotFoundError) return { ok: false, message: RELOAD };
    throw error;
  }
  revalidatePath("/", "layout");
  return { ok: true, message: `${name} set to ${formatDollarsBriefly(amount)}.` };
}
