import Link from "next/link";
import { getAppBank } from "@/app-bank";
import { BUFFER_RANGE, PAYMENT_LIMIT_RANGE, type Rule } from "@/rules";
import { formatDollarRange, formatDollarsBriefly, formatDollarsForInput } from "@/money";
import { requireCustomer } from "@/session";
import { RuleAmountForm, RuleSwitch } from "./agent-forms";

export const dynamic = "force-dynamic";

/** A Rule in words for its row: a title and one line on what it means. */
function ruleText(rule: Rule, accountName: (accountId: number) => string): { title: string; detail: string } {
  switch (rule.kind) {
    case "buffer":
      return {
        title: `Keep a ${formatDollarsBriefly(rule.parameters.buffer)} buffer in ${accountName(rule.parameters.checkingAccountId)}`,
        detail: `After bills before payday, move anything above it to ${accountName(rule.parameters.savingsAccountId)}`,
      };
    case "payment_limit":
      return {
        title: `Move up to ${formatDollarsBriefly(rule.parameters.paymentLimit)} without asking`,
        detail: "When your agent handles small things, anything bigger needs your OK",
      };
  }
}

const RULE_LABELS: Record<Rule["kind"], string> = { buffer: "Buffer Rule", payment_limit: "Payment limit Rule" };


export default async function AgentAndLimitsPage() {
  const customer = await requireCustomer();
  const bank = getAppBank();
  const accounts = bank.customerData.listAccounts(customer);
  const accountName = (accountId: number) => accounts.find((account) => account.id === accountId)?.name ?? "an account";
  const rules = bank.customerData.listRules(customer);
  const bufferRules = rules.filter((rule) => rule.kind === "buffer");
  const paymentLimitRule = rules.find((rule) => rule.kind === "payment_limit");

  return (
    <main className="page">
      <header className="top">
        <div>
          <h1>Agent &amp; limits</h1>
          <p className="muted">What your agent may do on its own, and the limits it can&rsquo;t break.</p>
        </div>
        <p className="muted signed-in">
          {customer.name} · <Link href="/">Home</Link> · <Link href="/decision-log">Decision log</Link>
        </p>
      </header>

      <section className="card" aria-labelledby="your-rules">
        <h2 id="your-rules">Your rules</h2>
        <p className="muted">Your agent can&rsquo;t act outside these. Each change is kept in the Decision log.</p>
        {rules.length === 0 ? (
          <p className="muted">You have no Rules yet.</p>
        ) : (
          <ul className="rules">
            {rules.map((rule) => {
              const text = ruleText(rule, accountName);
              return (
                <li key={rule.id} className="rule">
                  <div>
                    <strong>{text.title}</strong>
                    <p className="muted">
                      {text.detail} · v{rule.version}
                    </p>
                  </div>
                  <RuleSwitch ruleId={rule.id} on={rule.on} label={RULE_LABELS[rule.kind]} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {bufferRules.map((rule) => (
        <section key={rule.id} className="card" aria-labelledby={`buffer-${rule.id}`}>
          <h2 id={`buffer-${rule.id}`}>Buffer for {accountName(rule.parameters.checkingAccountId)}</h2>
          <RuleAmountForm
            kind="buffer"
            ruleId={rule.id}
            label="Always keep this much, in dollars"
            hint={`A whole-dollar amount from ${formatDollarRange(BUFFER_RANGE)}`}
            dollars={formatDollarsForInput(rule.parameters.buffer)}
          />
        </section>
      ))}

      {paymentLimitRule && (
        <section className="card" aria-labelledby="payment-limit">
          <h2 id="payment-limit">Payment limit</h2>
          <RuleAmountForm
            kind="payment_limit"
            ruleId={paymentLimitRule.id}
            label="Largest move without asking, in dollars"
            hint={`A whole-dollar amount from ${formatDollarRange(PAYMENT_LIMIT_RANGE)}`}
            dollars={formatDollarsForInput(paymentLimitRule.parameters.paymentLimit)}
          />
        </section>
      )}

      <section className="card" aria-labelledby="decision-log-link">
        <h2 id="decision-log-link">Decision log</h2>
        <p className="muted">
          Every action, the Rule behind it, and what happened. <Link href="/decision-log">Open the Decision log</Link>
        </p>
      </section>
    </main>
  );
}
