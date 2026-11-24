import { localDateOf, type LocalDate } from "./calendar";
import type { Customer, CustomerData } from "./customer-data";
import { STANDING_SEARCHES, type Finding, type StandingSearch } from "./findings";
import { UNFINISHED_MISSION_TEXT } from "./mission-text";
import type { Mission } from "./missions";
import type { AdviceSetting } from "./settings";

/** A Finding's Agent's view as the page may show it: behind "What would the agent pick?", or always. */
export interface AgentsViewOnPage {
  shown: "on_request" | "always";
  text: string;
}

/** A Finding on the Discoveries page. Its Agent's view is only there when the Advice setting lets it be. */
export type FindingOnPage = Omit<Finding, "agentsView"> & { agentsView: AgentsViewOnPage | null };

/** A Mission that ended without a Finding, as Discoveries shows it. */
export interface UnfinishedMission {
  id: number;
  question: string;
  state: "stopped" | "failed";
  /** "Stopped. Nothing was kept." or "Couldn't finish this". */
  text: string;
  /** True when the page offers Try again, which starts a new Mission with the same question. */
  tryAgain: boolean;
}

export interface DiscoveriesPage {
  /** The customer's current Advice setting, or null if they haven't finished setup. */
  adviceSetting: AdviceSetting | null;
  /** The customer's running Missions, newest first, each with what it is doing now. */
  runningMissions: Mission[];
  /**
   * Today's Missions that ended without a Finding, stopped or failed, newest first, leaving out any whose question
   * was asked again later, each with what the page says about it. Only a failed one offers Try again.
   */
  unfinishedMissions: UnfinishedMission[];
  /** Every Finding the customer has, newest first. */
  findings: FindingOnPage[];
  openFindingCount: number;
  /** Each Standing search and whether its switch is on. Empty before setup, when there are no switches yet. */
  standingSearches: { search: StandingSearch; on: boolean }[];
}

/**
 * The Discoveries page: the customer's running Missions, then every one of their Findings, newest first, with each
 * Agent's view shown as the current Advice setting allows. Under "never", or before setup, no Agent's view text is in
 * the page at all.
 */
export function readDiscoveriesPage(customerData: CustomerData, customer: Customer, today: LocalDate): DiscoveriesPage {
  const settings = customerData.getSettings(customer);
  const adviceSetting = settings?.adviceSetting ?? null;
  const findings = customerData
    .listFindings(customer)
    .sort((a, b) => b.at.getTime() - a.at.getTime() || b.id - a.id)
    .map((finding) => ({ ...finding, agentsView: agentsViewOnPage(finding.agentsView, adviceSetting) }));
  const missions = customerData.listMissions(customer);
  return {
    adviceSetting,
    runningMissions: missions.filter((mission) => mission.state === "running"),
    unfinishedMissions: unfinishedMissions(missions, today),
    findings,
    openFindingCount: countOpenFindings(findings),
    standingSearches: settings ? STANDING_SEARCHES.map((search) => ({ search, on: settings.standingSearches[search] })) : [],
  };
}

/** Today's stopped and failed Missions, newest first, each only while no later Mission asked its question again. */
function unfinishedMissions(newestFirst: Mission[], today: LocalDate): UnfinishedMission[] {
  return newestFirst.flatMap((mission, index) => {
    const { state } = mission;
    if (state !== "stopped" && state !== "failed") return [];
    if (localDateOf(mission.startedAt) !== today) return [];
    if (newestFirst.slice(0, index).some((later) => later.question === mission.question)) return [];
    return [
      { id: mission.id, question: mission.question, state, text: UNFINISHED_MISSION_TEXT[state], tryAgain: state === "failed" },
    ];
  });
}

/** How many of these Findings are open, for the nav bar's badge and Home's link card. */
export function countOpenFindings(findings: Pick<Finding, "state">[]): number {
  return findings.filter((finding) => finding.state === "open").length;
}

function agentsViewOnPage(text: string | null, adviceSetting: AdviceSetting | null): AgentsViewOnPage | null {
  if (text === null || adviceSetting === null || adviceSetting === "never") return null;
  return { shown: adviceSetting, text };
}
