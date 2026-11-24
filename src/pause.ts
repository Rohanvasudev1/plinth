import type { Customer, CustomerData } from "./customer-data";
import { customerChangeDecision } from "./decisions";

/**
 * Pauses or unpauses the customer's agent and writes a Decision log entry with the customer as actor, in one
 * database transaction. Asking for the state the agent is already in changes nothing and writes no entry.
 * Unpausing doesn't rerun anything the agent missed while paused. Returns whether the agent is now paused.
 */
export function pauseAgent(customerData: CustomerData, customer: Customer, paused: boolean): boolean {
  return customerData.inOneTransaction(() => {
    if (customerData.isAgentPaused(customer) === paused) return paused;
    customerData.savePause(customer, paused);
    customerData.recordDecision(
      customer,
      customerChangeDecision({
        trigger: paused ? "You paused your agent" : "You unpaused your agent",
        rule: null,
        action: paused ? "Paused your agent" : "Unpaused your agent",
        why: [
          { label: "Trigger", value: paused ? "You pressed Pause" : "You pressed Unpause" },
          {
            label: "What changes",
            value: paused
              ? "Your agent takes no automatic actions until you unpause it"
              : "Your agent acts on your Rules again from now on. Nothing it missed while paused is rerun",
          },
        ],
      }),
    );
    return paused;
  });
}
