import Link from "next/link";
import { getAppBank } from "@/app-bank";
import type { Customer } from "@/customer-data";

/** The signed-in pages the nav bar can mark as current. */
export type NavPage = "home" | "activity" | "forecast" | "discoveries" | "agent" | "decision-log" | "simulator";

const MAIN_LINKS: { page: NavPage; href: string; label: string }[] = [
  { page: "home", href: "/", label: "Home" },
  { page: "activity", href: "/activity", label: "Activity" },
  { page: "forecast", href: "/forecast", label: "Forecast" },
  { page: "discoveries", href: "/discoveries", label: "Discoveries" },
  { page: "agent", href: "/agent", label: "Agent & limits" },
];

/**
 * The nav bar on every signed-in page: the main pages, then the Simulator, marked as a testing tool, and who is
 * signed in. Discoveries carries a badge with the number of open Findings. It wraps rather than scrolls at phone
 * width. `current` is left out on a page with no link here.
 */
export function NavBar({ customer, current }: { customer: Customer; current?: NavPage }) {
  const openFindings = getAppBank().countOpenFindings(customer);
  const currentProps = (page: NavPage) => (page === current ? { "aria-current": "page" as const } : {});
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
          <li>
            <Link href="/simulator" className="testing-tool" {...currentProps("simulator")}>
              Simulator <small>(testing tool)</small>
            </Link>
          </li>
        </ul>
      </nav>
      <p className="muted signed-in">
        {customer.name} · <Link href="/sign-in">Switch</Link> ·{" "}
        <Link href="/decision-log" {...currentProps("decision-log")}>
          Decision log
        </Link>
      </p>
    </div>
  );
}
