"use server";

import { revalidatePath } from "next/cache";
import { getAppBank } from "@/app-bank";
import { isFindingOptionKey, isStandingSearch } from "@/findings";
import { requireCustomer } from "@/session";
import { SettingsError } from "@/settings";

/** What the last Undo press did, shown under the button when it was refused. */
export interface UndoResult {
  ok: boolean;
  message: string;
}

/** Undoes one of the signed-in customer's agent actions. */
export async function undoAction(_previous: UndoResult | null, form: FormData): Promise<UndoResult> {
  const customer = await requireCustomer();
  const decisionId = Number(form.get("decisionId"));
  if (!Number.isSafeInteger(decisionId)) return { ok: false, message: "There is no such action to undo." };
  const outcome = getAppBank().undo(customer, decisionId);
  if (!outcome.ok) return { ok: false, message: outcome.reason };
  revalidatePath("/", "layout");
  return { ok: true, message: outcome.reversal.action };
}

/** Marks agent actions as shown in the signed-in customer's toast, so it shows them only once. */
export async function markAgentActionsSeen(decisionIds: number[]): Promise<void> {
  const customer = await requireCustomer();
  const ids = Array.isArray(decisionIds) ? decisionIds.filter((id) => Number.isSafeInteger(id)) : [];
  getAppBank().markAgentActionsSeen(customer, ids);
}

/** What the last Standing search switch press did, shown under it when it was refused. */
export interface StandingSearchResult {
  ok: boolean;
  message: string;
}

/**
 * Switches one of the signed-in customer's Standing searches to the state the form asks for: from its switch on
 * Discoveries, or from "Stop looking" on a Finding it made.
 */
export async function setStandingSearchAction(
  _previous: StandingSearchResult | null,
  form: FormData,
): Promise<StandingSearchResult> {
  const customer = await requireCustomer();
  const search = String(form.get("search") ?? "");
  if (!isStandingSearch(search)) return { ok: false, message: "There is no such Standing search." };
  const on = form.get("on") === "true";
  try {
    getAppBank().setStandingSearch(customer, search, on);
  } catch (error) {
    if (error instanceof SettingsError) return { ok: false, message: error.message };
    throw error;
  }
  revalidatePath("/", "layout");
  return { ok: true, message: on ? "Switched on." : "Switched off." };
}

/**
 * What the last Option pick on a Finding did. `message` explains a pick that changed nothing, such as one on an
 * expired Finding. It is null when the pick worked, or when a guardrail refused it: the Finding itself shows that.
 */
export interface ChooseOptionResult {
  message: string | null;
  /** The Finding's full report, after the customer picked Read the full report. */
  report: string | null;
}

/** Carries out the Option the signed-in customer picked on one of their Findings. */
export async function chooseOptionAction(
  _previous: ChooseOptionResult | null,
  form: FormData,
): Promise<ChooseOptionResult> {
  const customer = await requireCustomer();
  const findingId = Number(form.get("findingId"));
  const option = String(form.get("option") ?? "");
  if (!Number.isSafeInteger(findingId) || !isFindingOptionKey(option)) {
    return { message: "There is no such Option.", report: null };
  }
  const outcome = getAppBank().chooseOption(customer, findingId, option);
  revalidatePath("/", "layout");
  if (outcome.ok) return { message: null, report: option === "read_report" ? outcome.finding.report : null };
  if (outcome.finding?.refusal) return { message: null, report: null };
  return { message: outcome.reason, report: null };
}
