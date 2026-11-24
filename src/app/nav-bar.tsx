import Link from "next/link";

/** The signed-in pages the nav bar can mark as current. */
export type NavPage = "home" | "activity" | "agent" | "decision-log" | "simulator" | "setup";

const MAIN_LINKS: { page: NavPage; href: string; label: string }[] = [
  { page: "home", href: "/", label: "Home" },
  { page: "activity", href: "/activity", label: "Activity" },
  { page: "agent", href: "/agent", label: "Agent & limits" },
];

/**
 * The nav bar on every signed-in page: the main pages, then the Simulator, marked as a testing tool, and who is
 * signed in. It wraps rather than scrolls at phone width.
 */
export function NavBar({ customerName, current }: { customerName: string; current: NavPage }) {
  const currentProps = (page: NavPage) => (page === current ? { "aria-current": "page" as const } : {});
  return (
    <div className="nav-bar">
      <nav aria-label="Main">
        <ul>
          {MAIN_LINKS.map(({ page, href, label }) => (
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
      </nav>
      <p className="muted signed-in">
        {customerName} · <Link href="/sign-in">Switch</Link> ·{" "}
        <Link href="/decision-log" {...currentProps("decision-log")}>
          Decision log
        </Link>
      </p>
    </div>
  );
}
