"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppBank } from "@/app-bank";
import { LinkedAccountError } from "@/linked-accounts";
import { isInstitutionAccountKey } from "@/open-banking";
import { requireCustomer } from "@/session";
import type { AccountsNotice } from "./notices";

/**
 * Runs one Linked account change, then returns to All accounts with `noticeOnSuccess`, or to `pageOnRefusal` with the
 * refused notice if the bank refused it.
 */
async function change(run: () => void, noticeOnSuccess: AccountsNotice, pageOnRefusal = "/accounts"): Promise<never> {
  let refused = false;
  try {
    run();
  } catch (error) {
    if (!(error instanceof LinkedAccountError)) throw error;
    refused = true;
  }
  revalidatePath("/", "layout");
  redirect(refused ? `${pageOnRefusal}?notice=refused` : `/accounts?notice=${noticeOnSuccess}`);
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
