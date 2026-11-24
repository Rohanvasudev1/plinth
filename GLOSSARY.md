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
What one of the customer's savings accounts is for, such as Buy a home for the House fund, with an optional target amount the customer sets. Without a target, Home shows only the balance.
_Avoid_: Pot

**Goal account**:
The one savings account a customer has for one savings goal (Buy a home, Emergency cushion or Travel), opened by the Setup survey. Running setup again reuses it, and dropping its goal keeps its money.
_Avoid_: Goal pot, sub-account

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

**Sweep target**:
The Goal account a buffer Rule sweeps to: the first savings goal in the customer's goal preferences. A buffer Rule can have none, as after Skip, and then keeps the Buffer and sweeps nothing.
_Avoid_: Destination, savings target

**Payment limit**:
The largest amount the agent may move alone under "handle small things", held in a payment limit Rule.
_Avoid_: Cap, threshold

**Autonomy level**:
The customer's choice of how much the agent does alone: ask before everything, handle small things, or act on anything within the Rules.
_Avoid_: Automation mode, permission level

**Settings record**:
The one versioned record per customer of every choice that isn't a Rule: the Autonomy level, the Advice setting, the risk answers, the Data choices and the ordered goal preferences. A customer without one hasn't finished setup.
_Avoid_: Preferences, profile, config

**Goal preference**:
One entry in the customer's ordered list of what spare money should go toward, such as Buy a home or Clear debt. Savings goals among them get a savings account with a Goal; others, like Clear debt, don't.
_Avoid_: Priority, objective

**Data choice**:
One of the customer's on/off choices about their data: training models on it, sharing it with partners, and keeping chat history. Each is off unless the customer turns it on.
_Avoid_: Consent, privacy setting

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
A check that runs before any agent action and refuses it if it breaks a Rule or ownership limit, or if the agent is paused.
_Avoid_: Validation, safety check

**Decision log**:
The customer-visible record of every agent action, with its trigger, the Rule it used, and its result, plus each change the customer makes to the agent: Undo, a picked Option, a Rule or setting edit, a Goal's target, and Pause.
_Avoid_: Audit trail, history

**Why**:
The explanation of one Decision log entry, built from its recorded trigger, Rule and checks.
_Avoid_: Reason, rationale

**Undo**:
Reversing an agent action with a new, opposite ledger transaction.
_Avoid_: Rollback, cancel

## Forecast

**Category**:
The kind of spending, income or saving a ledger transaction is, such as Groceries, Housing, Income or Savings. A Merchant or Scheduled bill gives its spending one Category.
_Avoid_: Tag, label, bucket

**Counterparty**:
Who a ledger transaction's money moved to or from: a Merchant, a Scheduled bill's payee, an Employer, or, for a move between the customer's own accounts, the account the money went to.
_Avoid_: Other party, recipient

**Merchant**:
A simulated business the customer pays by Card purchase, with a fixed Category.
_Avoid_: Vendor, payee, shop

**Usual month**:
The average income and spending, per Category and in total, over the last six full calendar months.
_Avoid_: Average month, baseline, normal month

**On pace**:
This month's spending so far, scaled up to the whole month.
_Avoid_: Run rate, projected spend

**Forecast**:
The expected Checking balance over the next 30 days, worked out from known paychecks, Scheduled bills, sweeps and usual daily spending.
_Avoid_: Prediction, projection (that word is for Goals)

**Daily allowance**:
The usual day-to-day spending the Forecast takes off each day: the Card purchases from checking over the 90 days before today, divided by 90.
_Avoid_: Burn rate, daily spend

**Projection**:
Where a Goal's balance would be after three years at a given pace of saving, with no interest.
_Avoid_: Forecast, plan

**Activity**:
The customer's list of posted ledger transactions, newest first.
_Avoid_: Statement, history, transactions page
