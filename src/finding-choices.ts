import { bufferRuleRow, checkedByRow, checkSweepGuardrails } from "./buffer-agent";
import { localDateOf } from "./calendar";
import type { Clock } from "./clock";
import type { Customer, CustomerData } from "./customer-data";
import { customerChangeDecision, type Decision } from "./decisions";
import { describeOption, type Finding, type FindingOptionKey, type MoveOption } from "./findings";
import { cents, formatDollars, formatDollarsBriefly } from "./money";
import { billsBeforePayday } from "./safe-to-spend";

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
    if (finding.state === "chosen") return { ok: false, reason: "You already chose an Option here.", finding };
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
    if (rule?.kind !== "buffer") throw new Error(`Finding ${finding.id} names Rule ${finding.rule.id}, not a buffer Rule`);
    const checking = customerData.getAccount(customer, option.fromAccountId);
    const savings = customerData.getAccount(customer, option.toAccountId);
    const bills = billsBeforePayday(customerData, customer, localDateOf(clock.now()));
    const refusal = checkSweepGuardrails(customerData, {
      customer,
      rule,
      checking,
      savings,
      amount: option.amount,
      bills,
      chosenByCustomer: true,
    });
    const savingsName = savings?.name ?? "savings";
    const decision = {
      actor: "agent" as const,
      trigger: { ledgerEventId: finding.ledgerEventId, description: "You chose this Option" },
      rule: { id: rule.id, version: rule.version },
      fromAccountId: checking?.id ?? null,
      toAccountId: savings?.id ?? null,
      amount: option.amount,
      why: [
        { label: "Trigger", value: picked },
        bufferRuleRow(rule, checking, savings),
        {
          label: "Amount",
          value: `${formatDollars(option.amount)}, fixed when your agent asked you`,
        },
        checkedByRow(refusal),
      ],
      reversesDecisionId: null,
    };

    // Passing the ownership guardrail means both accounts are the customer's; the extra checks narrow the types.
    if (refusal || !checking || !savings) {
      const refusedBy = refusal?.guardrail ?? "ownership";
      const refused = customerData.recordDecision(customer, {
        ...decision,
        action: `Move ${formatDollarsBriefly(option.amount)} to ${savingsName}`,
        result: "Refused",
        refusedBy,
        ledgerTransactionId: null,
      });
      const reason = refusal?.reason ?? "the Option must name your own checking and savings accounts";
      customerData.recordFindingRefusal(customer, finding.id, { guardrail: refusedBy, reason });
      return { ok: false, reason, finding: customerData.getFinding(customer, finding.id) };
    }

    const posted = customerData.postLedgerTransaction(customer, {
      idempotencyKey: `finding:${finding.id}`,
      description: `Sweep to ${savings.name}`,
      entries: [
        { accountId: checking.id, amount: cents(-option.amount) },
        { accountId: savings.id, amount: option.amount },
      ],
    });
    if (!posted.created) return { ok: false, reason: "You already chose an Option here.", finding };
    const done = customerData.recordDecision(customer, {
      ...decision,
      action: `Moved ${formatDollarsBriefly(option.amount)} to ${savings.name}`,
      result: "Done",
      refusedBy: null,
      ledgerTransactionId: posted.ledgerTransactionId,
    });
    return { ok: true, finding: customerData.markFindingChosen(customer, finding.id, "move"), decision: done };
  }
}
