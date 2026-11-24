import { localDateOf } from "./calendar";
import type { Clock } from "./clock";
import type { Customer, CustomerData } from "./customer-data";
import { customerChangeDecision, type Decision } from "./decisions";
import { describeOption, FindingError, type Finding, type FindingOptionKey, type MoveOption } from "./findings";
import { formatDollars } from "./money";
import { billsBeforePayday } from "./safe-to-spend";
import { bufferRuleRow, checkSweepGuardrails, recordSweep, type ProposedSweep } from "./sweep";

/** What picking an Option did: the Finding and its Decision log entry, or the reason nothing happened. */
export type ChooseOptionOutcome =
  | { ok: true; finding: Finding; decision: Decision }
  | { ok: false; reason: string; finding: Finding | undefined };

/**
 * Carries out the Option the customer picked on one of their Findings, in one database transaction.
 *
 * - "Move" re-runs the sweep guardrails as they stand now, with the Payment limit passed because the customer
 *   chose it. If they pass, it posts the Option's fixed amount under the key `finding:<finding id>`, writes a
 *   Done entry whose trigger is "You chose this Option", and marks the Finding chosen. If one fails, it writes a
 *   Refused entry naming the guardrail and records the reason on the Finding, which stays open.
 * - "Leave it" moves nothing, writes a Decision log entry with the customer as actor, and marks the Finding chosen.
 *
 * A Finding that isn't the customer's, is already chosen or has expired changes nothing.
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
      return { ok: false, reason: "This Finding has expired: a newer paycheck changed the numbers.", finding };
    }
    const option = finding.options.find((candidate) => candidate.key === key);
    if (!option) return { ok: false, reason: "That Option isn't on this Finding.", finding };

    const accountName = (accountId: number) => customerData.getAccount(customer, accountId)?.name ?? "an account";
    const picked = `You picked “${describeOption(option, accountName).label}”`;

    if (option.key === "leave") {
      const decision = customerData.recordDecision(
        customer,
        customerChangeDecision({
          trigger: "You chose this Option",
          rule: finding.rule,
          action: `Left the money in ${accountName(option.accountId)}`,
          why: [
            { label: "Trigger", value: picked },
            { label: "What changes", value: "Nothing moves" },
          ],
        }),
      );
      return { ok: true, finding: customerData.markFindingChosen(customer, finding.id, key), decision };
    }

    return move(finding, option, picked);
  });

  function move(finding: Finding, option: MoveOption, picked: string): ChooseOptionOutcome {
    const rule = customerData.getRule(customer, finding.rule.id);
    if (rule?.kind !== "buffer") throw new FindingError(`Finding ${finding.id} names Rule ${finding.rule.id}, not a buffer Rule`);
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
        bufferRuleRow(rule, checking, savings),
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
}

const ALREADY_CHOSEN = "You already chose an Option here.";
