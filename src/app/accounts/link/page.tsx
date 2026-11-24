import Link from "next/link";
import { getAppBank } from "@/app-bank";
import { LINKED_ACCOUNT_TYPE_TEXT, seeOnlyText } from "@/linked-account-text";
import { requireCustomer } from "@/session";
import { NavBar } from "../../nav-bar";
import { linkAccountAction } from "../actions";
import { ACCOUNTS_NOTICES, accountsNotice } from "../notices";

export const dynamic = "force-dynamic";

export default async function LinkAnotherBankPage({ searchParams }: { searchParams: Promise<{ notice?: string | string[] }> }) {
  const customer = await requireCustomer();
  const notice = accountsNotice((await searchParams).notice);
  const linkable = getAppBank().listLinkableAccounts(customer);

  return (
    <main className="page">
      <NavBar customer={customer} current="accounts" />
      <header className="top">
        <div>
          <h1>Link another bank</h1>
          <p className="muted">
            Plinth will see a Linked account&rsquo;s balance, synced once a day. It can&rsquo;t move money in or out, and it
            never sees account numbers or transactions.
          </p>
        </div>
      </header>

      {notice && (
        <p role="status" className="card result refused">
          {ACCOUNTS_NOTICES[notice]}
        </p>
      )}

      {linkable.length === 0 ? (
        <p className="card muted">You&rsquo;ve linked every account you hold at an Institution.</p>
      ) : (
        <ul className="linkable">
          {linkable.map((account) => (
            <li key={account.key} className="card linkable-account">
              <div>
                <h2>{account.institution}</h2>
                <p className="muted">{LINKED_ACCOUNT_TYPE_TEXT[account.type]}</p>
              </div>
              <p>{seeOnlyText(account.consentEnd)}</p>
              <form action={linkAccountAction}>
                <input type="hidden" name="account" value={account.key} />
                <button type="submit" className="button" aria-label={`Link ${account.institution}`}>
                  Link
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <p>
        <Link href="/accounts">Back to All accounts</Link>
      </p>
    </main>
  );
}
