import Link from "next/link";
import { getAppBank } from "@/app-bank";
import type { Customer } from "@/customer-data";

/** The signed-in pages the nav bar can mark as current. */
export type NavPage =
  | "home"
  | "activity"
  | "accounts"
  | "forecast"
  | "discoveries"
  | "agent"
  | "privacy"
  | "decision-log"
  | "split"
  | "simulator";

const MAIN_LINKS: { page: NavPage; href: string; label: string }[] = [
  { page: "home", href: "/", label: "Home" },
  { page: "activity", href: "/activity", label: "Activity" },
  { page: "accounts", href: "/accounts", label: "Accounts" },
  { page: "forecast", href: "/forecast", label: "Forecast" },
  { page: "discoveries", href: "/discoveries", label: "Discoveries" },
];

const MORE_LINKS: { page: NavPage; href: string; label: string }[] = [
  { page: "split", href: "/split", label: "Split" },
  { page: "agent", href: "/agent", label: "Agent & limits" },
  { page: "privacy", href: "/privacy", label: "Privacy" },
  { page: "decision-log", href: "/decision-log", label: "Decision log" },
];

/**
 * The nav bar on every signed-in page: the main pages, with a badge on Discoveries for the number of open Findings,
 * then a More menu holding the rest and the Simulator, marked as a testing tool, and who is signed in. The More menu
 * is a details element, so it opens without JavaScript, and it wraps rather than scrolls at phone width. `current`
 * is left out on a page with no link here.
 */
export function NavBar({ customer, current }: { customer: Customer; current?: NavPage }) {
  const openFindings = getAppBank().countOpenFindings(customer);
  const currentProps = (page: NavPage) => (page === current ? { "aria-current": "page" as const } : {});
  const moreIsCurrent = current === "simulator" || MORE_LINKS.some((link) => link.page === current);
  return (
    <div className="nav-bar">
      <nav aria-label="Main">
        <ul>
          {MAIN_LINKS.map(({ page, href, label }) => (
            <li key={page}>
              <Link href={href} {...currentProps(page)}>
                {label}
                {page === "discoveries" && openFindings > 0 && (
                  <span className="badge" aria-label={`${openFindings} open`}>
                    {openFindings}
                  </span>
                )}
              </Link>
            </li>
          ))}
          <li className="more">
            <details>
              <summary className={moreIsCurrent ? "current" : undefined}>More</summary>
              <ul>
                {MORE_LINKS.map(({ page, href, label }) => (
                  <li key={page}>
                    <Link href={href} {...currentProps(page)}>
                      {label}
                    </Link>
                  </li>
                ))}
                <li>
                  <Link href="/simulator" className="testing-tool" {...currentProps("simulator")}>
                    Simulator <small>(testing tool)</small>
                  </Link>
                </li>
              </ul>
            </details>
          </li>
        </ul>
      </nav>
      <p className="muted signed-in">
        {customer.name} · <Link href="/sign-in">Switch</Link>
      </p>
    </div>
  );
}
