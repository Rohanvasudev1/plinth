"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppBank } from "@/app-bank";
import { RuleParametersError } from "@/rules";
import { SettingsError } from "@/settings";
import { parseSetupAnswers } from "@/setup-answers";
import { requireCustomer } from "@/session";

/** Why the survey couldn't be saved. On success the customer goes to Home instead. */
export interface SetupRefusal {
  message: string;
}

/** Applies the signed-in customer's survey answers, sent once from the summary, then goes to Home. */
export async function finishSetup(answers: unknown): Promise<SetupRefusal> {
  const customer = await requireCustomer();
  try {
    getAppBank().finishSetup(customer, parseSetupAnswers(answers));
  } catch (error) {
    if (error instanceof RuleParametersError || error instanceof SettingsError) {
      return { message: `Nothing was saved: ${error.message}. Go back and check your answers.` };
    }
    throw error;
  }
  revalidatePath("/", "layout");
  redirect("/");
}

/** Applies the standard Rules and settings for the signed-in customer, then goes to Home. */
export async function skipSetup(): Promise<void> {
  const customer = await requireCustomer();
  getAppBank().skipSetup(customer);
  revalidatePath("/", "layout");
  redirect("/");
}
