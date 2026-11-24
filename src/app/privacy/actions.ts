"use server";

import { revalidatePath } from "next/cache";
import { getAppBank } from "@/app-bank";
import { isDataChoice, SettingsError } from "@/settings";
import { requireCustomer } from "@/session";

/** What the last Data choice switch did, shown under it when it changed nothing. */
export interface DataChoiceResult {
  ok: boolean;
  message: string;
}

/** Turns one of the signed-in customer's Data choices to the state the switch was pressed toward. */
export async function setDataChoiceAction(_previous: DataChoiceResult | null, form: FormData): Promise<DataChoiceResult> {
  const customer = await requireCustomer();
  const choice = String(form.get("choice") ?? "");
  if (!isDataChoice(choice)) return { ok: false, message: "There is no such Data choice." };
  const on = form.get("on") === "true";
  try {
    getAppBank().setDataChoice(customer, choice, on);
  } catch (error) {
    if (error instanceof SettingsError) return { ok: false, message: error.message };
    throw error;
  }
  revalidatePath("/", "layout");
  return { ok: true, message: on ? "Switched on." : "Switched off." };
}
