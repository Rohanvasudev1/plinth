import { formatLocalDate, localDateOf } from "./calendar";
import type { Clock } from "./clock";
import type { Customer, CustomerData } from "./customer-data";
import { customerChangeDecision, type Decision, type WhyRow } from "./decisions";
import {
  expiredReason,
  findingWhyRows,
  leftMoneyAction,
  noBufferRuleReason,
  PICK_CHANGES,
  pickedOptionAction,
} from "./finding-text";
import { describeOption, FindingError, type Finding, type FindingOptionKey, type MoveOption } from "./findings";
import { formatDollars, formatDollarsBriefly } from "./money";
import { describeRule } from "./rule-changes";
import { bufferRuleFor, type BufferRule } from "./rules";
import { billsBeforePayday } from "./safe-to-spend";
import { bufferRuleRow, checkedByRow, checkSweepGuardrails, recordSweep, type ProposedSweep } from "./sweep";

/** What picking an Option did: the Finding and its Decision log entry, or the reason nothing happened. */
export type ChooseOptionOutcome =
  | { ok: true; finding: Finding; decision: Decision }
  | { ok: false; reason: string; finding: Finding | undefined };

/**
 * Carries out the Option the customer picked on one of their Findings, in one database transaction.
 *
 * - "Move" re-runs the sweep guardrails as they stand now, under the Finding's Rule or, on a Mission Finding, the
 *   customer's buffer Rule for the account it moves from, with the Payment limit passed because the customer
 *   chose it. If they pass, it posts the Option's fixed amount under the key `finding:<finding id>`, writes a
 *   Done entry whose trigger is "You chose this Option", and marks the Finding chosen. If one fails, it writes a
 *   Refused entry naming the guardrail and records the reason on the Finding, which stays open.
 * - "Leave it", "Not now" and "Keep paying" move nothing, write a Decision log entry with the customer as actor,
 *   and mark the Finding chosen.
 * - "Read the full report" writes a Decision log entry and leaves the Finding open; the Finding carries the report.
 * - "Remind me on a date" writes a Decision log entry and snoozes the Finding until that date. A date that has
 *   already come changes nothing.
 *
 * A Finding that isn't the customer's, is already chosen, has expired or is snoozed changes nothing.
 */
export function chooseOption(
  deps: { clock: Clock; customerData: CustomerData },
  customer: Customer,
  findingId: number,
  key: FindingOptionKey,
): ChooseOptionOutcome {
  const { clock, customerData } = deps;
  return customerData.inOneTransaction((): ChooseOptionOutcome => {
    const finding = customerData.getFinding(customer, findingId);
    if (!finding) return { ok: false, reason: "There is no such Finding.", finding };
    if (finding.state === "chosen") return { ok: false, reason: ALREADY_CHOSEN, finding };
    if (finding.state === "expired") {
      return { ok: false, reason: `This Finding has expired: ${expiredReason(finding).toLowerCase()}.`, finding };
    }
    if (finding.state === "snoozed") return { ok: false, reason: "This Finding is snoozed until its reminder date.", finding };
    const option = finding.options.find((candidate) => candidate.key === key);
    if (!option) return { ok: false, reason: "That Option isn't on this Finding.", finding };

    const accountName = (accountId: number) => customerData.getAccount(customer, accountId)?.name ?? "an account";
    const { label } = describeOption(option, accountName);
    const picked = `You picked “${label}”`;

    switch (option.key) {
      case "move":
        return move(finding, option, picked);
      case "leave": {
        const decision = recordPick(finding, leftMoneyAction(accountName(option.accountId)), picked, PICK_CHANGES.leave);
        return { ok: true, finding: customerData.markFindingChosen(customer, finding.id, key), decision };
      }
      case "read_report": {
        const decision = recordPick(finding, pickedOptionAction(label, finding.title), picked, PICK_CHANGES.readReport);
        return { ok: true, finding, decision };
      }
      case "remind_me": {
        if (option.date <= localDateOf(clock.now())) {
          return { ok: false, reason: `${formatLocalDate(option.date)} has already come.`, finding };
        }
        const decision = recordPick(finding, pickedOptionAction(label, finding.title), picked, PICK_CHANGES.snooze(option.date));
        return { ok: true, finding: customerData.snoozeFinding(customer, finding.id, option.date), decision };
      }
      case "not_now":
      case "keep_paying": {
        const decision = recordPick(finding, pickedOptionAction(label, finding.title), picked, PICK_CHANGES.close);
        return { ok: true, finding: customerData.markFindingChosen(customer, finding.id, key), decision };
      }
    }
  });

  /** The Decision log entry for a pick that moves no money, with the customer as actor. */
  function recordPick(finding: Finding, action: string, picked: string, whatChanges: string): Decision {
    return customerData.recordDecision(
      customer,
      customerChangeDecision({
        trigger: "You chose this Option",
        rule: finding.rule,
        action,
        why: findingWhyRows(picked, finding, whatChanges),
      }),
    );
  }

  function move(finding: Finding, option: MoveOption, picked: string): ChooseOptionOutcome {
    // A sweep Finding moves under the Rule it was made under. A Mission Finding has none, so its Move goes under the
    // customer's buffer Rule for the account it moves from, through the same guardrails.
    const rule = finding.rule
      ? customerData.getRule(customer, finding.rule.id)
      : bufferRuleFor(customerData.listRules(customer), option.fromAccountId);
    if (rule?.kind !== "buffer") {
      if (finding.rule) throw new FindingError(`Finding ${finding.id} names no buffer Rule to move under`);
      return refuseWithoutRule(finding, option, picked);
    }
    const checking = customerData.getAccount(customer, option.fromAccountId);
    const savings = customerData.getAccount(customer, option.toAccountId);
    const proposed: ProposedSweep = {
      customer,
      rule,
      checking,
      savings,
      amount: option.amount,
      bills: billsBeforePayday(customerData, customer, localDateOf(clock.now())),
      approval: "customer",
    };
    const check = checkSweepGuardrails(customerData, proposed);
    const decision = recordSweep(customerData, proposed, check, {
      idempotencyKey: `finding:${finding.id}`,
      trigger: { ledgerEventId: finding.ledgerEventId, description: "You chose this Option" },
      why: [
        { label: "Trigger", value: picked },
        finding.rule ? bufferRuleRow(rule, checking, savings) : ruleRow(rule),
        { label: "Amount", value: `${formatDollars(option.amount)}, fixed when your agent asked you` },
      ],
    });
    if (!decision) return { ok: false, reason: ALREADY_CHOSEN, finding };
    if (decision.result === "Refused") {
      const reason = check.refusal?.reason ?? "the Option must name your own checking and savings accounts";
      const refused = customerData.recordFindingRefusal(customer, finding.id, {
        guardrail: decision.refusedBy ?? "ownership",
        reason,
      });
      return { ok: false, reason, finding: refused };
    }
    return { ok: true, finding: customerData.markFindingChosen(customer, finding.id, "move"), decision };
  }

  /** The Rule row of a Mission Move's entry, naming the buffer Rule's own accounts. */
  function ruleRow(rule: BufferRule): WhyRow {
    const accountName = (accountId: number) => customerData.getAccount(customer, accountId)?.name ?? "an account";
    return { label: "Rule", value: describeRule(rule, accountName) };
  }

  /**
   * A Mission Move from an account no buffer Rule covers: no Rule lets the agent move money from it, so the Rule on
   * guardrail refuses it. The entry names the Mission, since it has no Rule.
   */
  function refuseWithoutRule(finding: Finding, option: MoveOption, picked: string): ChooseOptionOutcome {
    const from = customerData.getAccount(customer, option.fromAccountId);
    const to = customerData.getAccount(customer, option.toAccountId);
    const refusal = { guardrail: "Rule on" as const, reason: noBufferRuleReason(from?.name ?? "that account") };
    customerData.recordDecision(customer, {
      actor: "agent",
      trigger: { ledgerEventId: null, description: "You chose this Option" },
      rule: null,
      action: `Move ${formatDollarsBriefly(option.amount)} to ${to?.name ?? "an account"}`,
      fromAccountId: from?.id ?? null,
      toAccountId: to?.id ?? null,
      amount: option.amount,
      result: "Refused",
      refusedBy: refusal.guardrail,
      why: [
        { label: "Trigger", value: picked },
        { label: "Amount", value: `${formatDollars(option.amount)}, fixed when your agent asked you` },
        checkedByRow({ ran: [refusal.guardrail], refusal }),
      ],
      ledgerTransactionId: null,
      reversesDecisionId: null,
      missionId: finding.missionId,
      findingId: finding.id,
    });
    return { ok: false, reason: refusal.reason, finding: customerData.recordFindingRefusal(customer, finding.id, refusal) };
  }
}

const ALREADY_CHOSEN = "You already chose an Option here.";
