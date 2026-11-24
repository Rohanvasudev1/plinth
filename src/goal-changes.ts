import type { Account, Customer, CustomerData } from "./customer-data";
import { customerChangeDecision } from "./decisions";
import { GoalError } from "./goals";
import { formatDollarsBriefly, type Cents } from "./money";
import { GOAL_PREFERENCE_TEXT } from "./settings-text";

/**
 * Sets the target of the Goal on one of the customer's savings accounts and writes a Decision log entry with the
 * customer as actor, naming the goal and the target before and after, in one database transaction. Throws
 * GoalError, saving nothing, if the account isn't one of their savings accounts or the target is out of range.
 */
export function setGoalTarget(customerData: CustomerData, customer: Customer, accountId: number, target: Cents): Account {
  return customerData.inOneTransaction(() => {
    const before = customerData.getAccount(customer, accountId);
    if (before?.kind !== "savings") throw new GoalError("A target can only be set on one of your own savings accounts");
    const after = customerData.setGoalTarget(customer, accountId, target);
    const trigger = "You changed a Goal's target on Agent & limits";
    customerData.recordDecision(
      customer,
      customerChangeDecision({
        trigger,
        rule: null,
        action:
          before.goalTarget === null
            ? `Set the ${after.name} target to ${formatDollarsBriefly(target)}`
            : `Changed the ${after.name} target from ${formatDollarsBriefly(before.goalTarget)} to ${formatDollarsBriefly(target)}`,
        why: [
          { label: "Trigger", value: trigger },
          { label: "Goal", value: after.goal === null ? after.name : `${after.name}, for ${GOAL_PREFERENCE_TEXT[after.goal]}` },
          { label: "Before", value: before.goalTarget === null ? "No target" : formatDollarsBriefly(before.goalTarget) },
          { label: "After", value: formatDollarsBriefly(target) },
        ],
      }),
    );
    return after;
  });
}
