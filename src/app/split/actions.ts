"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { getAppBank } from "@/app-bank";
import { formatDollars, parseDollars } from "@/money";
import { requireCustomer } from "@/session";
import { asGroupId, NotAMemberError, sharesOf, SplitError } from "@/split";

/** What the last "Add a shared cost" did, shown under the form. */
export interface AddSharedCostResult {
  ok: boolean;
  message: string;
}

/** Adds a Shared cost the signed-in customer paid. A Group they aren't a Member of answers 404. */
export async function addSharedCostAction(
  _previous: AddSharedCostResult | null,
  form: FormData,
): Promise<AddSharedCostResult> {
  const customer = await requireCustomer();
  let amount;
  try {
    amount = parseDollars(String(form.get("amount") ?? ""));
  } catch {
    return { ok: false, message: "Enter an amount in dollars, such as 48 or 48.50." };
  }
  let groupId;
  try {
    groupId = asGroupId(Number(form.get("groupId")));
  } catch {
    notFound();
  }
  const description = String(form.get("description") ?? "");
  try {
    const bank = getAppBank();
    const cost = bank.addSharedCost(customer, { groupId, description, amount });
    revalidatePath("/split");
    const group = bank.readGroup(customer, groupId);
    const share = sharesOf(cost.amount, group.memberNames.length).other;
    return { ok: true, message: `Added ${cost.description} to ${group.name}. Each other Share is ${formatDollars(share)}.` };
  } catch (error) {
    if (error instanceof NotAMemberError) notFound();
    if (error instanceof SplitError) return { ok: false, message: `${error.message}.` };
    throw error;
  }
}
