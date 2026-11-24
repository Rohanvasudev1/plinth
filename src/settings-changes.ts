import type { Customer, CustomerData } from "./customer-data";
import { customerChangeDecision, type WhyRow } from "./decisions";
import { SettingsError, type DataChoices, type Settings, type SettingsChoices } from "./settings";
import { settingsRows } from "./settings-text";

/** A change to some of a settings record's choices. Whatever is left out stays as it is. */
export type SettingsChange = Partial<SettingsChoices>;

/**
 * Writes the next version of the customer's settings record with `change` applied, and a Decision log entry with
 * the customer as actor, in one database transaction. Throws SettingsError, saving nothing, if the customer has
 * no settings record yet or the result doesn't match the record's schema.
 */
export function changeSettings(customerData: CustomerData, customer: Customer, change: SettingsChange): Settings {
  return customerData.inOneTransaction(() => {
    const current = customerData.getSettings(customer);
    if (!current) throw new SettingsError("This customer hasn't finished setup, so there are no settings to change");
    const { version: _version, createdAt: _createdAt, ...currentChoices } = current;
    const saved = customerData.saveSettings(customer, { ...currentChoices, ...change });

    const changed = describeDifferences(current, saved);
    const why: WhyRow[] = [
      { label: "Trigger", value: "You changed your settings" },
      { label: "Settings", value: `Version ${current.version} to version ${saved.version}` },
      ...changed,
    ];
    customerData.recordDecision(
      customer,
      customerChangeDecision({
        trigger: "You changed your settings",
        rule: null,
        action:
          changed.length === 0
            ? "Saved your settings unchanged"
            : `Changed your settings: ${changed.map((row) => row.label).join(", ")}`,
        why,
      }),
    );
    return saved;
  });
}

/**
 * Turns one of the customer's Data choices on or off through `changeSettings`, which writes the next settings version
 * and a Decision log entry in one transaction. Asking for the state it is already in changes nothing. Throws
 * SettingsError, saving nothing, before setup.
 */
export function setDataChoice(customerData: CustomerData, customer: Customer, choice: keyof DataChoices, on: boolean): Settings {
  return customerData.inOneTransaction(() => {
    const current = customerData.getSettings(customer);
    if (!current) throw new SettingsError("This customer hasn't finished setup, so there are no Data choices to change");
    if (current.dataChoices[choice] === on) return current;
    return changeSettings(customerData, customer, { dataChoices: { ...current.dataChoices, [choice]: on } });
  });
}

/** One Why row per choice that differs, labelled with the choice and valued "before → after". */
function describeDifferences(before: SettingsChoices, after: SettingsChoices): WhyRow[] {
  const afterRows = settingsRows(after);
  return settingsRows(before).flatMap((row, index) => {
    const to = afterRows[index]?.value;
    return to === undefined || to === row.value ? [] : [{ label: row.label, value: `${row.value} → ${to}` }];
  });
}
