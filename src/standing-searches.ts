import type { Customer } from "./customer-data";
import type { StandingSearch } from "./findings";
import { SettingsError, type Settings } from "./settings";
import { changeSettings } from "./settings-changes";
import { searchExistingPurchases, type SearchDeps } from "./subscription-price-rises";

/** Runs each Standing search over the customer's existing data, as it does when the bank starts. */
const SEARCH_EXISTING: Record<StandingSearch, (deps: SearchDeps, customer: Customer) => void> = {
  subscription_price_rises: searchExistingPurchases,
};

/**
 * Switches one of the customer's Standing searches on or off through the settings change module, which writes the
 * next settings version and a Decision log entry, in one database transaction. Off expires the search's open and
 * snoozed Findings. On runs the search over the customer's existing data, which finds nothing it already reported.
 * Asking for the state it is already in changes nothing. Throws SettingsError, saving nothing, before setup.
 */
export function setStandingSearch(deps: SearchDeps, customer: Customer, search: StandingSearch, on: boolean): Settings {
  const { customerData } = deps;
  return customerData.inOneTransaction(() => {
    const current = customerData.getSettings(customer);
    if (!current) throw new SettingsError("This customer hasn't finished setup, so there are no Standing searches to switch");
    if (current.standingSearches[search] === on) return current;
    const saved = changeSettings(customerData, customer, {
      standingSearches: { ...current.standingSearches, [search]: on },
    });
    if (on) SEARCH_EXISTING[search](deps, customer);
    else customerData.expireStandingSearchFindings(customer, search);
    return saved;
  });
}
