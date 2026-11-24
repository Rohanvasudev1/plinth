import type { Customer, CustomerData } from "./customer-data";
import { STANDING_SEARCHES, type Finding, type StandingSearch } from "./findings";
import type { AdviceSetting } from "./settings";

/** A Finding's Agent's view as the page may show it: behind "What would the agent pick?", or always. */
export interface AgentsViewOnPage {
  shown: "on_request" | "always";
  text: string;
}

/** A Finding on the Discoveries page. Its Agent's view is only there when the Advice setting lets it be. */
export type FindingOnPage = Omit<Finding, "agentsView"> & { agentsView: AgentsViewOnPage | null };

export interface DiscoveriesPage {
  /** The customer's current Advice setting, or null if they haven't finished setup. */
  adviceSetting: AdviceSetting | null;
  /** Every Finding the customer has, newest first. */
  findings: FindingOnPage[];
  openFindingCount: number;
  /** Each Standing search and whether its switch is on. Empty before setup, when there are no switches yet. */
  standingSearches: { search: StandingSearch; on: boolean }[];
}

/**
 * The Discoveries page: every one of the customer's Findings, newest first, with each Agent's view shown as the
 * current Advice setting allows. Under "never", or before setup, no Agent's view text is in the page at all.
 */
export function readDiscoveriesPage(customerData: CustomerData, customer: Customer): DiscoveriesPage {
  const settings = customerData.getSettings(customer);
  const adviceSetting = settings?.adviceSetting ?? null;
  const findings = customerData
    .listFindings(customer)
    .sort((a, b) => b.at.getTime() - a.at.getTime() || b.id - a.id)
    .map((finding) => ({ ...finding, agentsView: agentsViewOnPage(finding.agentsView, adviceSetting) }));
  return {
    adviceSetting,
    findings,
    openFindingCount: countOpenFindings(findings),
    standingSearches: settings ? STANDING_SEARCHES.map((search) => ({ search, on: settings.standingSearches[search] })) : [],
  };
}

/** How many of these Findings are open, for the nav bar's badge and Home's link card. */
export function countOpenFindings(findings: Pick<Finding, "state">[]): number {
  return findings.filter((finding) => finding.state === "open").length;
}

function agentsViewOnPage(text: string | null, adviceSetting: AdviceSetting | null): AgentsViewOnPage | null {
  if (text === null || adviceSetting === null || adviceSetting === "never") return null;
  return { shown: adviceSetting, text };
}
