import { localDateOf } from "./calendar";
import type { Clock } from "./clock";
import type { CustomerData } from "./customer-data";
import { customerChangeDecision } from "./decisions";
import { REMINDER_TRIGGER, reopenedFindingAction, reopenedFindingWhy } from "./finding-text";
import type { SystemData } from "./system-data";

/**
 * Opens again every customer's snoozed Finding whose reminder date the clock has reached, each with a Decision log
 * entry. The customer asked for the reminder, so they are the entry's actor. Returns how many Findings opened.
 */
export function reopenDueFindings(deps: { clock: Clock; customerData: CustomerData; systemData: SystemData }): number {
  const { clock, customerData, systemData } = deps;
  const today = localDateOf(clock.now());
  return customerData.inOneTransaction(() => {
    let reopened = 0;
    for (const customer of systemData.listOpenCustomers()) {
      for (const finding of customerData.listSnoozedFindingsDue(customer, today)) {
        const date = finding.snoozedUntil;
        if (date === null) continue; // Only for the type: listSnoozedFindingsDue returns Findings with a date.
        customerData.reopenSnoozedFinding(customer, finding.id);
        customerData.recordDecision(
          customer,
          customerChangeDecision({
            trigger: REMINDER_TRIGGER,
            rule: finding.rule,
            action: reopenedFindingAction(finding.title),
            why: reopenedFindingWhy(finding, date),
          }),
        );
        reopened += 1;
      }
    }
    return reopened;
  });
}
