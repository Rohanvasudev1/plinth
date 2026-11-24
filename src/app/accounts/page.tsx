import Link from "next/link";
import { getAppBank } from "@/app-bank";
import type { LinkedAccountOnPage, NetWorthFigures } from "@/bank";
import { formatConsentDate, LINKED_ACCOUNT_TYPE_TEXT } from "@/linked-account-text";
import { formatDollars } from "@/money";
import { requireCustomer } from "@/session";
import { NavBar } from "../nav-bar";
import { entryTimeFormat } from "../time-format";
import { renewConsentAction, unlinkAccountAction } from "./actions";
import { ACCOUNTS_NOTICES, accountsNotice } from "./notices";

export const dynamic = "force-dynamic";

const FIGURES: { key: keyof NetWorthFigures; label: string }[] = [
  { key: "netWorth", label: "Net worth" },
  { key: "cash", label: "Cash" },
  { key: "investments", label: "Investments" },
  { key: "debt", label: "Debt" },
];

function LinkedAccountForm({ linked, action, label }: { linked: LinkedAccountOnPage; action: (form: FormData) => Promise<void>; label: string }) {
  return (
    <form action={action}>
      <input type="hidden" name="linkedAccountId" value={linked.id} />
      <button type="submit" className="link-button" aria-label={`${label} ${linked.institution}`}>
        {label}
      </button>
    </form>
  );
}

function LinkedAccountRow({ linked }: { linked: LinkedAccountOnPage }) {
  return (
    <tr>
      <td>
        <b>{linked.institution}</b>
        <div className="muted account-detail">
          {LINKED_ACCOUNT_TYPE_TEXT[linked.type]} · See only
        </div>
        <div className="muted account-detail">
          {linked.consentEnded ? (
            <>Consent ended on {formatConsentDate(linked.consentEnd)}</>
          ) : (
            <>
              synced <time dateTime={linked.syncedAt.toISOString()}>{entryTimeFormat.format(linked.syncedAt)}</time> · Consent
              until {formatConsentDate(linked.consentEnd)}
            </>
          )}
        </div>
        <div className="account-actions">
          {linked.consentEnded && <LinkedAccountForm linked={linked} action={renewConsentAction} label="Renew" />}
          <LinkedAccountForm linked={linked} action={unlinkAccountAction} label="Unlink" />
        </div>
      </td>
      <td className="num num-col">{linked.consentEnded ? <span className="muted">—</span> : formatDollars(linked.balance)}</td>
    </tr>
  );
}

export default async function AllAccountsPage({ searchParams }: { searchParams: Promise<{ notice?: string | string[] }> }) {
  const customer = await requireCustomer();
  const notice = accountsNotice((await searchParams).notice);
  const { figures, plinthAccounts, linkedAccounts } = getAppBank().readAllAccounts(customer);

  return (
    <main className="page">
      <NavBar customer={customer} current="accounts" />
      <header className="top">
        <div>
          <h1>All accounts</h1>
          <p className="muted">Your Plinth accounts and the accounts you linked. Plinth can only see Linked accounts.</p>
        </div>
        <Link href="/accounts/link" className="button">
          Link another bank
        </Link>
      </header>

      {notice && (
        <p role="status" className={`card result${notice === "refused" ? " refused" : ""}`}>
          {ACCOUNTS_NOTICES[notice]}
        </p>
      )}

      <section className="card" aria-label="Where you stand">
        <dl className="stats">
          {FIGURES.map(({ key, label }) => (
            <div key={key} className="stat">
              <dt className="stat-label">{label}</dt>
              <dd className="stat-value num">{formatDollars(figures[key])}</dd>
            </div>
          ))}
        </dl>
        <p className="muted stat-note">
          Net worth is Cash plus Investments plus Debt. A Linked account whose Consent has ended doesn&rsquo;t count.
        </p>
      </section>

      <section className="card">
        <table className="activity accounts" aria-label="Accounts">
          <thead>
            <tr>
              <th scope="col">Account</th>
              <th scope="col" className="num-col">
                Balance
              </th>
            </tr>
          </thead>
          <tbody>
            {plinthAccounts.map((account) => (
              <tr key={`plinth-${account.id}`}>
                <td>
                  <b>{account.name}</b>
                  <div className="muted account-detail">Plinth {account.kind} · Everything</div>
                </td>
                <td className="num num-col">{formatDollars(account.balance)}</td>
              </tr>
            ))}
            {linkedAccounts.map((linked) => (
              <LinkedAccountRow key={`linked-${linked.id}`} linked={linked} />
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
