import { RuleNotFoundError, type Customer, type CustomerData } from "./customer-data";
import type { WhyRow } from "./decisions";
import { cents, formatDollarsBriefly, type Cents } from "./money";
import { BUFFER_RANGE, checkWholeDollars, RuleParametersError, type Rule } from "./rules";

/**
 * The customer's own changes to their Rules, made on Agent & limits. Each writes the Rule's next version and a
 * Decision log entry with the customer as actor, in one database transaction, so old entries keep the version
 * they used (ADR 0003).
 */
export interface RuleChanges {
  /** Switches the customer's Rule on or off. */
  switchRule(customer: Customer, ruleId: number, on: boolean): Rule;
  /** Sets the Buffer of the customer's buffer Rule. Throws RuleParametersError, saving nothing, if out of range. */
  setBuffer(customer: Customer, ruleId: number, buffer: Cents): Rule;
  /** Sets the customer's Payment limit. Throws RuleParametersError, saving nothing, if out of range. */
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
    return customerData.inOneTransaction(() => {
      const current = customerData.getRule(customer, ruleId);
      if (!current) throw new RuleNotFoundError(`No Rule ${ruleId} for this customer`);
      const revised = customerData.reviseRule(customer, ruleId, revise(current));
      const { action, trigger } = describeChange(revised);
      const name = (accountId: number) => accountName(customer, accountId);
      const why: WhyRow[] = [
        { label: "Trigger", value: trigger },
        { label: "Before", value: `${describeRule(current, name)}, ${switchedText(current.on)}` },
        { label: "After", value: `${describeRule(revised, name)}, ${switchedText(revised.on)}` },
      ];
      customerData.recordDecision(customer, {
        actor: "customer",
        trigger: { ledgerEventId: null, description: "You changed a Rule" },
        rule: { id: revised.id, version: revised.version },
        action,
        fromAccountId: null,
        toAccountId: null,
        amount: cents(0),
        result: "Done",
        refusedBy: null,
        why,
        ledgerTransactionId: null,
        reversesDecisionId: null,
      });
      return revised;
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
      checkWholeDollars(buffer, BUFFER_RANGE);
      return change(
        customer,
        ruleId,
        (current) => {
          if (current.kind !== "buffer") throw new RuleParametersError(`Rule ${ruleId} is not a buffer Rule`);
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
            throw new RuleParametersError(`Rule ${ruleId} is not a payment limit Rule`);
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
 * One version of a Rule in words, such as "Buffer Rule v1: keep $1,500 in Checking, move the rest to House fund".
 * `accountName` names the customer's accounts.
 */
export function describeRule(rule: Rule, accountName: (accountId: number) => string): string {
  switch (rule.kind) {
    case "buffer":
      return `Buffer Rule v${rule.version}: keep ${formatDollarsBriefly(rule.parameters.buffer)} in ${accountName(rule.parameters.checkingAccountId)}, move the rest to ${accountName(rule.parameters.savingsAccountId)}`;
    case "payment_limit":
      return `Payment limit Rule v${rule.version}: move up to ${formatDollarsBriefly(rule.parameters.paymentLimit)} alone`;
  }
}
