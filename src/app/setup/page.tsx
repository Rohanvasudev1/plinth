import Link from "next/link";
import { getAppBank } from "@/app-bank";
import { requireCustomer } from "@/session";
import { STANDARD_SETUP } from "@/setup-answers";
import { SetupSurvey } from "./setup-survey";

export const dynamic = "force-dynamic";

/** "Run setup again" from Agent & limits: the Setup survey, starting from the customer's current answers. */
export default async function RunSetupAgainPage() {
  const customer = await requireCustomer();
  const bank = getAppBank();
  const current = bank.readSetupAnswers(customer);
  return (
    <main className="page narrow">
      <header className="top">
        <h1>Run setup again</h1>
        <p className="muted signed-in">
          {customer.name} · <Link href="/agent">Agent &amp; limits</Link>
        </p>
      </header>
      <p className="muted">
        Nothing changes until you turn your agent on at the end. A goal you drop keeps its account and the money in it.
      </p>
      <SetupSurvey initial={current ?? STANDARD_SETUP} firstRun={current === undefined} />
    </main>
  );
}
