import type { Customer, CustomerData } from "./customer-data";
import type { Finding } from "./findings";
import type { Mission } from "./missions";
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
  /** The customer's running Missions, newest first, each with what it is doing now. */
  runningMissions: Mission[];
  /** Every Finding the customer has, newest first. */
  findings: FindingOnPage[];
  openFindingCount: number;
}

/**
 * The Discoveries page: the customer's running Missions, then every one of their Findings, newest first, with each
 * Agent's view shown as the current Advice setting allows. Under "never", or before setup, no Agent's view text is in
 * the page at all.
 */
export function readDiscoveriesPage(customerData: CustomerData, customer: Customer): DiscoveriesPage {
  const adviceSetting = customerData.getSettings(customer)?.adviceSetting ?? null;
  const findings = customerData
    .listFindings(customer)
    .sort((a, b) => b.at.getTime() - a.at.getTime() || b.id - a.id)
    .map((finding) => ({ ...finding, agentsView: agentsViewOnPage(finding.agentsView, adviceSetting) }));
  const runningMissions = customerData.listMissions(customer).filter((mission) => mission.state === "running");
  return { adviceSetting, runningMissions, findings, openFindingCount: countOpenFindings(findings) };
}

/** How many of these Findings are open, for the nav bar's badge and Home's link card. */
export function countOpenFindings(findings: Pick<Finding, "state">[]): number {
  return findings.filter((finding) => finding.state === "open").length;
}

function agentsViewOnPage(text: string | null, adviceSetting: AdviceSetting | null): AgentsViewOnPage | null {
  if (text === null || adviceSetting === null || adviceSetting === "never") return null;
  return { shown: adviceSetting, text };
}
