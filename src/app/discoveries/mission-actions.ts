"use server";

import { revalidatePath } from "next/cache";
import { getAppBank } from "@/app-bank";
import { MissionError } from "@/missions";
import { requireCustomer } from "@/session";

/** What the last question did: null once a Mission started, or why none did. */
export interface AskResult {
  message: string | null;
}

/**
 * Starts a Mission for the signed-in customer's question. It doesn't wait for the Mission: the work goes on after
 * the response, and Discoveries refreshes while it runs.
 */
export async function askAction(_previous: AskResult | null, form: FormData): Promise<AskResult> {
  const customer = await requireCustomer();
  try {
    const { ended } = getAppBank().startMission(customer, String(form.get("question") ?? ""));
    ended.catch((error: unknown) => console.error("A Mission couldn't record how it ended", error));
  } catch (error) {
    if (error instanceof MissionError) return { message: error.message };
    throw error;
  }
  revalidatePath("/", "layout");
  return { message: null };
}
