"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppBank } from "@/app-bank";
import { LinkedAccountError } from "@/linked-accounts";
import { isInstitutionAccountKey } from "@/open-banking";
import { requireCustomer } from "@/session";
import type { AccountsNotice } from "./notices";

/** Runs one Linked account change, then returns to All accounts with a notice of what happened. */
async function change(run: () => void, done: AccountsNotice, from = "/accounts"): Promise<never> {
  let notice: AccountsNotice = done;
  try {
    run();
  } catch (error) {
    if (!(error instanceof LinkedAccountError)) throw error;
    notice = "refused";
  }
  revalidatePath("/", "layout");
  redirect(`${notice === "refused" ? from : "/accounts"}?notice=${notice}`);
}

/** Links the Institution account the signed-in customer picked on Link another bank. */
export async function linkAccountAction(form: FormData): Promise<void> {
  const customer = await requireCustomer();
  const key = String(form.get("account") ?? "");
  if (!isInstitutionAccountKey(key)) redirect("/accounts/link?notice=refused");
  await change(() => getAppBank().linkAccount(customer, key), "linked", "/accounts/link");
}

/** Renews the Consent on one of the signed-in customer's Linked accounts whose Consent has ended. */
export async function renewConsentAction(form: FormData): Promise<void> {
  const customer = await requireCustomer();
  const linkedAccountId = Number(form.get("linkedAccountId"));
  await change(() => getAppBank().renewConsent(customer, linkedAccountId), "renewed");
}

/** Unlinks one of the signed-in customer's Linked accounts. */
export async function unlinkAccountAction(form: FormData): Promise<void> {
  const customer = await requireCustomer();
  const linkedAccountId = Number(form.get("linkedAccountId"));
  await change(() => getAppBank().unlinkAccount(customer, linkedAccountId), "unlinked");
}
