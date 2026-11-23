# Plinth product brief

This is the input for the first grilling session. It records what was decided while designing the demo. Anything marked as a proposal is open for grilling.

## The idea

A consumer bank where each customer has one agent working for them. The agent watches their money in real time, acts within rules the customer sets, and reports what it finds. The customer stays in control: every action is explained, logged and reversible, and the agent never pushes advice the customer didn't ask for. All money is imaginary. Paychecks, merchants, other banks, insurers and markets are simulated.

## Principles

1. The customer decides. Agents act alone only inside a Rule or Mandate. Anything else is a Finding with options, and nothing happens until the customer picks one.
2. Findings, not instructions. A Finding states facts, where they came from, and what each option does. The agent's own view appears only if the customer's advice setting allows it: never, on request, or always.
3. Every action can be explained, undone and audited. Each automatic action has a Why panel, an Undo where reversal is possible, and an entry in the Decision log.
4. Real time first. Balances post the moment money moves. Forecasts and rules run off ledger events, not nightly batches.
5. Privacy is off by default. Model training and partner sharing stay off unless the customer turns them on. Every read of customer data by a person, agent or app appears in the access log.
6. Only claim what the bank can know. A bank sees charges, not usage. When a decision needs facts the bank doesn't have, the agent asks the customer.

## Who it's for

Sam, a salaried renter paid $3,240 every two weeks, saving for a house deposit, with two flatmates, a credit card, a student loan and a 401(k) at other institutions.

## Architecture

Five layers plus a trust layer that runs through all of them:

1. Surfaces: the web app, the chat assistant, outside agents acting for the customer, human bankers, proactive alerts.
2. Agent layer: one agent per customer, intent routing, customer memory, action authorization, guardrails, human handoff.
3. Capabilities: accounts and payments, cards, lending, savings and investing, financial health, servicing and disputes.
4. Intelligence: real-time signals, a linked view of the customer, models, fraud and scam defense, cash-flow forecasting, evaluations.
5. Core: a real-time ledger, an event stream, payment rails, open banking, identity, infrastructure.
Trust: consent ledger, action audit log, explanations, model risk checks, kill switches, regulatory reporting.

## Screens in the demo

| Screen | What it does |
|---|---|
| Setup survey | Questions on goals, how much the agent may do alone, the checking buffer, the largest payment without asking, risk, advice style and data choices. The answers become Rules and settings. |
| Home | A finding waiting for a choice, checking balance with a 30-day forecast and safe-to-spend figure, goals, what the agent did with Why and Undo, bills before payday, connected agents. |
| Discoveries | Send an agent to look into a question. Missions in progress. Findings with options. Standing searches the customer can switch off. The advice setting. |
| Activity | Transactions posted in real time, tagged when an agent made them, with Dispute and Split actions. |
| All accounts | Net worth across Plinth and linked outside accounts, what Plinth may do with each, consent end dates, link and unlink. |
| Forecast | Monthly income and spending, this month against a usual month by category, and a 3-year projection of the House fund at three paces, with a slider to try cuts. |
| Invest | An agent-managed index portfolio, target and current mix, trades with reasons, investing limits, and a briefing with options when the portfolio falls 15% in a month. |
| Split | Groups, who owes whom, request and pay by instant transfer, automatic splits for household bills, agent-spotted shared costs. |
| Agent & limits | Rules with switches, Mandates for outside agents with revoke, Pause my agent, and the Decision log. |
| Privacy | Data choices, protections, the access log, export and delete. |
| Ask Plinth | A chat assistant that answers and acts within the customer's rules. |

## Journeys to support

1. Paycheck lands. Payroll posts, the forecast updates, the agent applies the buffer rule, guardrails check it, money moves to savings, the decision is logged, and the customer gets an alert with Undo.
2. Scam in progress. A large transfer to a new payee during a phone call is held, the customer gets a step-up check and an explanation, and can reach a fraud specialist.
3. Asking for a loan. The assistant quotes a loan from cash flow, explains the terms and waits for the customer to sign.
4. An outside agent pays. A connected travel agent pays within its Mandate using a single-use card.
5. Disputing a charge. The agent builds the claim, hands off to a person when unsure, and credits the customer while the dispute is reviewed.

## Candidate terms for the glossary

Agent, Rule, Mandate, Connected agent, Buffer, Sweep, Finding, Option, Mission, Standing search, Advice setting, Check-in, Decision log, Access log, Consent, Linked account, Goal, Forecast, Safe to spend, Briefing, Group, Request, Pause.

## Proposed milestones

1. Ledger and Paycheck lands: accounts, a double-entry ledger in cents, a simulated payroll deposit, the buffer Rule, the sweep, the Decision log with Why and Undo, and Home showing balance and agent activity.
2. Setup survey, Rules and Pause.
3. Forecast.
4. Discoveries, with Missions backed by a language model.
5. All accounts and Privacy.
6. Split.
7. Invest.
8. Connected agents, scam hold, disputes and Ask Plinth.

## Proposed technical defaults

TypeScript in strict mode. Next.js. SQLite through Drizzle, so every session runs the app with no database server. Vitest and Playwright. A simulated clock. A language-model interface with a fake for tests and the Anthropic SDK behind it, needed only from milestone 4.

## Out of scope

Real money, real bank connections, real market data, real identity checks, banking licences, native mobile apps. The web app must work at phone width.

## Open questions for grilling

- Is the ledger event-sourced, or a table of entries plus a balances table?
- How does Undo work for an action whose money has already moved on?
- What does a Rule look like as data, so the survey, the agent and the guardrails all read the same thing?
- Which parts of the agent use a language model, and which are plain code?
- How is one customer's data kept apart from another's?
