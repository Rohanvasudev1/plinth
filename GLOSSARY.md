# Plinth

A consumer bank where each customer has one agent that acts only inside rules the customer sets. All money is imaginary.

## Money

**Ledger**:
The append-only record of every money movement, and the only source of truth for balances.
_Avoid_: Journal, books

**Entry**:
One signed amount, in cents, posted to one account as part of a ledger transaction.
_Avoid_: Line, posting

**Ledger transaction**:
A group of entries that sum to zero and post together under one idempotency key.
_Avoid_: Transfer, when the movement is not between two of the customer's accounts

**Ledger event**:
A record that a ledger transaction posted, which rules react to.
_Avoid_: Notification, message

**Clearing account**:
A system-owned account for one simulated outside institution, which takes the opposite entry when money enters or leaves the bank.
_Avoid_: Suspense account, external account

**Opening balances account**:
A system-owned account that funds the seeded starting balances, so that seeding is a ledger transaction like any other. It stands for no outside institution.
_Avoid_: Equity account, suspense account

**Goal**:
A target amount attached to one of the customer's savings accounts, such as the House fund.
_Avoid_: Target, pot

**Safe to spend**:
The checking balance minus the Buffer minus Scheduled bills due before the next payday.
_Avoid_: Available balance, spare cash

**Employer**:
A simulated outside company that pays a customer through its own Clearing account.
_Avoid_: Payer, company

**Payroll**:
An Employer's promise to pay one customer a fixed amount on a fixed cycle into one account.
_Avoid_: Salary, income stream

**Paycheck**:
One payment from a Payroll, posted on a payday.
_Avoid_: Deposit, salary payment

**Card purchase**:
A payment from a customer's account to a merchant through the Merchant Clearing account.
_Avoid_: Spend, charge

**Simulator**:
The testing page that plays the Employers, billers and merchants and moves the simulated clock.
_Avoid_: Sandbox, admin page

**Scheduled bill**:
A payment the customer expects to make on a known date for a known amount, such as rent.
_Avoid_: Upcoming payment, recurring charge

## Agent

**Agent**:
The one software agent that works for a customer and acts only inside that customer's Rules and Mandates.
_Avoid_: Bot, assistant

**Rule**:
A versioned instruction from the customer that lets the agent act alone in a defined situation.
_Avoid_: Policy, automation, setting

**Buffer**:
The amount a buffer Rule keeps in checking after Scheduled bills due before the next payday.
_Avoid_: Minimum balance, floor

**Sweep**:
A move of money above the Buffer from checking to savings, made by the agent after a paycheck posts.
_Avoid_: Auto-save, transfer

**Payment limit**:
The largest amount the agent may move alone under "handle small things", held in a payment limit Rule.
_Avoid_: Cap, threshold

**Autonomy level**:
The customer's choice of how much the agent does alone: ask before everything, handle small things, or act on anything within the Rules.
_Avoid_: Automation mode, permission level

**Pause**:
A customer switch that stops every automatic agent action until the customer turns it back on.
_Avoid_: Freeze, kill switch

**Finding**:
Facts the agent reports to the customer with a set of Options, where nothing happens until the customer picks one.
_Avoid_: Suggestion, recommendation, alert

**Option**:
One choice in a Finding, stating what it does.
_Avoid_: Action, choice button

**Setup survey**:
The questions a customer answers before the agent acts, whose answers become Rules, Goals and settings.
_Avoid_: Onboarding, wizard

**Advice setting**:
The customer's choice of whether the agent's own view appears in a Finding: never, on request, or always.
_Avoid_: Advice mode, tone

**Guardrail**:
A check that runs before any agent action and refuses it if it breaks a Rule or ownership limit.
_Avoid_: Validation, safety check

**Decision log**:
The customer-visible record of every agent action, with its trigger, the Rule it used, and its result, plus each Undo the customer made.
_Avoid_: Audit trail, history

**Why**:
The explanation of one Decision log entry, built from its recorded trigger, Rule and checks.
_Avoid_: Reason, rationale

**Undo**:
Reversing an agent action with a new, opposite ledger transaction.
_Avoid_: Rollback, cancel
