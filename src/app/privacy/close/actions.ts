"use server";

import { redirect } from "next/navigation";
import { getAppBank } from "@/app-bank";
import { ClosureError } from "@/closure";
import { endSession, requireCustomer } from "@/session";

/** Closes the signed-in customer's Plinth account, ends their session and shows Sign in as with "This account is closed". */
export async function closeAndDeleteAction(): Promise<void> {
  const customer = await requireCustomer();
  try {
    getAppBank().closeAndDelete(customer);
  } catch (error) {
    // Already closed, such as from another tab: the outcome the customer asked for stands.
    if (!(error instanceof ClosureError)) throw error;
  }
  await endSession();
  redirect("/sign-in?closed=1");
}
