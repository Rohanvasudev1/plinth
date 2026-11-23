"use server";

import { revalidatePath } from "next/cache";
import { getAppBank } from "@/app-bank";
import { requireCustomer } from "@/session";

/** What the last Undo button did, shown under the action it was pressed on. */
export interface UndoFormResult {
  ok: boolean;
  message: string;
}

/** Undoes one of the signed-in customer's agent actions, or reports why it was refused (ADR 0002). */
export async function undoAgentAction(
  _previous: UndoFormResult | null,
  form: FormData,
): Promise<UndoFormResult> {
  const customer = await requireCustomer();
  const decisionId = Number(form.get("decisionId"));
  if (!Number.isSafeInteger(decisionId)) return { ok: false, message: "Reload the page and try again." };
  const undone = getAppBank().undo(customer, decisionId);
  if (!undone.ok) return { ok: false, message: `Undo refused: ${undone.reason}.` };
  revalidatePath("/", "layout");
  return { ok: true, message: `${undone.reversal.action}.` };
}

/** Marks the signed-in customer's agent actions seen, so the toast that just showed doesn't show again. */
export async function markAgentActionsSeen(): Promise<void> {
  const customer = await requireCustomer();
  getAppBank().markAgentActionsSeen(customer);
}
