import { RuleNotFoundError, type Customer, type CustomerData } from "./customer-data";
import { customerChangeDecision, type WhyRow } from "./decisions";
import { formatDollarsBriefly, type Cents } from "./money";
import type { Rule } from "./rules";

/**
 * The customer's own changes to their Rules, made on Agent & limits. Each writes the Rule's next version and a
 * Decision log entry with the customer as actor, in one database transaction, so old entries keep the version
 * they used (ADR 0003).
 */
export interface RuleChanges {
  /** Switches the customer's Rule on or off. */
  switchRule(customer: Customer, ruleId: number, on: boolean): Rule;
  /**
   * Sets the Buffer of the customer's buffer Rule. Throws RuleParametersError, saving nothing, if out of range, and
   * RuleNotFoundError if the Rule isn't one of the customer's buffer Rules.
   */
  setBuffer(customer: Customer, ruleId: number, buffer: Cents): Rule;
  /**
   * Sets the customer's Payment limit. Throws RuleParametersError, saving nothing, if out of range, and
   * RuleNotFoundError if the Rule isn't one of the customer's payment limit Rules.
   */
  setPaymentLimit(customer: Customer, ruleId: number, paymentLimit: Cents): Rule;
}

export function createRuleChanges(customerData: CustomerData): RuleChanges {
  /** Name of one of the customer's accounts, for the Why panel. */
  function accountName(customer: Customer, accountId: number): string {
    return customerData.getAccount(customer, accountId)?.name ?? "an account that isn't yours";
  }

  function change(
    customer: Customer,
    ruleId: number,
    revise: (current: Rule) => { on?: boolean; parameters?: unknown },
    describeChange: (revised: Rule) => { action: string; trigger: string },
  ): Rule {
    const name = (accountId: number) => accountName(customer, accountId);
    return customerData.reviseRule(customer, ruleId, revise, (before, after) => {
      const { action, trigger } = describeChange(after);
      const why: WhyRow[] = [
        { label: "Trigger", value: trigger },
        { label: "Before", value: `${describeRule(before, name)}, ${switchedText(before.on)}` },
        { label: "After", value: `${describeRule(after, name)}, ${switchedText(after.on)}` },
      ];
      return customerChangeDecision({
        trigger: "You changed a Rule",
        rule: { id: after.id, version: after.version },
        action,
        why,
      });
    });
  }

  return {
    switchRule(customer, ruleId, on) {
      return change(
        customer,
        ruleId,
        () => ({ on }),
        (revised) => ({
          action: `Switched ${on ? "on" : "off"} the ${RULE_NAMES[revised.kind]} Rule`,
          trigger: `You switched the ${RULE_NAMES[revised.kind]} Rule ${on ? "on" : "off"} on Agent & limits`,
        }),
      );
    },
    setBuffer(customer, ruleId, buffer) {
      return change(
        customer,
        ruleId,
        (current) => {
          if (current.kind !== "buffer") throw new RuleNotFoundError(`Rule ${ruleId} is not a buffer Rule`);
          return { parameters: { ...current.parameters, buffer } };
        },
        () => ({
          action: `Changed the Buffer to ${formatDollarsBriefly(buffer)}`,
          trigger: "You changed the Buffer on Agent & limits",
        }),
      );
    },
    setPaymentLimit(customer, ruleId, paymentLimit) {
      return change(
        customer,
        ruleId,
        (current) => {
          if (current.kind !== "payment_limit") {
            throw new RuleNotFoundError(`Rule ${ruleId} is not a payment limit Rule`);
          }
          return { parameters: { paymentLimit } };
        },
        () => ({
          action: `Changed the Payment limit to ${formatDollarsBriefly(paymentLimit)}`,
          trigger: "You changed the Payment limit on Agent & limits",
        }),
      );
    },
  };
}

const RULE_NAMES: Record<Rule["kind"], string> = { buffer: "buffer", payment_limit: "payment limit" };

function switchedText(on: boolean): string {
  return on ? "switched on" : "switched off";
}

/**
/** Where a buffer Rule moves the rest, such as "move the rest to House fund". */
export function sweepTargetText(savingsAccountId: number | null, accountName: (accountId: number) => string): string {
  return savingsAccountId === null ? "with no savings goal to move the rest to" : `move the rest to ${accountName(savingsAccountId)}`;
}

/**
 * One version of a Rule in words, such as "Buffer Rule v1: keep $1,500 in Checking, move the rest to House fund".
 * `accountName` names the customer's accounts.
 */
export function describeRule(rule: Rule, accountName: (accountId: number) => string): string {
  switch (rule.kind) {
    case "buffer":
      return `Buffer Rule v${rule.version}: keep ${formatDollarsBriefly(rule.parameters.buffer)} in ${accountName(rule.parameters.checkingAccountId)}, ${sweepTargetText(rule.parameters.savingsAccountId, accountName)}`;
    case "payment_limit":
      return `Payment limit Rule v${rule.version}: move up to ${formatDollarsBriefly(rule.parameters.paymentLimit)} alone`;
  }
}
