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

**Source**:
Where a fact in a Finding came from, such as the customer's card charges over a stated period.
_Avoid_: Citation, reference

**Agent's view**:
The Option the agent would pick in a Finding, and why, shown only as far as the Advice setting allows.
_Avoid_: Lean, recommendation, advice

**Mission**:
A question the customer sends the agent to look into, which reads only that customer's data and reports back with one Finding. While it runs, the customer can stop it. It fails on a model error, at its time limit, at its 9th tool call, or when its Finding fails its checks. A Mission that is stopped or fails keeps nothing. A customer has at most one Mission running, and at most 10 a simulated day.
_Avoid_: Job, task, query

**Mission tool**:
One read-only way a Mission's language model reads the asking customer's data, such as their transactions over a period or their Goals. No Mission tool moves money or changes anything.
_Avoid_: Function, plugin, API

**Read list**:
The record a Mission keeps of each piece of data it read: the Mission tool and the period or item.
_Avoid_: Access log, access history, audit

**Progress label**:
The fixed line a running Mission shows for what it is doing now, such as "Reading your transactions".
_Avoid_: Status, step

**Standing search**:
A check the agent runs by itself as new data arrives, which only reports Findings and which the customer can switch off.
_Avoid_: Alert, monitor, watch

**Subscription price rises**:
The Standing search that reports a Card purchase at a Subscriptions Merchant costing more than the one before, or a Free-trial Merchant's first Card purchase. It reports each Merchant and price at most once.
_Avoid_: Price alert, subscription monitor

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
The customer-visible record of every agent action, with its trigger, the Rule it used, and its result, plus each change the customer makes to the agent: Undo, a picked Option, a Rule or setting edit, a Goal's target, and Pause. A Mission's entry names no Rule, because the customer asked for it, and its result is Reported, with a link to its Finding, Stopped, when the customer stopped it, or Failed. After Close and delete, entries keep their text but lose their links to the deleted Missions and Findings.
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

**Free-trial Merchant**:
A Subscriptions Merchant the Simulator marks as starting with a free trial, so its first Card purchase is the trial turning paid.
_Avoid_: Trial vendor, freemium

**Usual month**:
The average income and spending, per Category and in total, over the last six full calendar months, or over fewer when the customer has fewer. Needs at least one.
_Avoid_: Average month, baseline, normal month

**On pace**:
This month's spending at its pace so far: Card purchases so far, scaled up to the whole month, plus every Scheduled bill due this month at its full amount, paid yet or not.
_Avoid_: Run rate, projected spend

**Left to save**:
Usual month income minus spending, worked out for the Usual month and for On pace. Below zero when spending is higher than income.
_Avoid_: Surplus, savings rate, net income

**Forecast**:
The expected Checking balance over the next 30 days, worked out from known paychecks, Scheduled bills, sweeps and usual daily spending.
_Avoid_: Prediction, projection (that word is for Goals)

**Daily allowance**:
The usual day-to-day spending the Forecast takes off each day: the Card purchases from checking over the 90 days before today, divided by 90.
_Avoid_: Burn rate, daily spend

**Projection**:
Where a Goal's balance would be after three years at a given pace of saving, with no interest. The Forecast page projects the sweep target at three paces: the Usual month's Left to save, On pace Left to save, and On pace with a Try-it cut.
_Avoid_: Forecast, plan

**Try-it cut**:
A percent from 0 to 50 that the Forecast page's slider takes off On pace Eating out and Shopping, to show the Projection "with your changes". It runs in the browser, saves nothing and writes no Decision log entry.
_Avoid_: Budget, savings plan

**Activity**:
The customer's list of posted ledger transactions, newest first.
_Avoid_: Statement, history, transactions page

**Discoveries**:
The page that lists every one of the customer's Findings, newest first, whatever made them. The nav bar's Discoveries link shows how many are open.
_Avoid_: Inbox, notifications

**Snoozed**:
The state of a Finding the customer asked to be reminded about. It opens again once the simulated clock reaches the date they picked.
_Avoid_: Dismissed, hidden

## Accounts and privacy

**Institution**:
A simulated outside bank, card issuer, lender or retirement plan that holds an account the customer can link to Plinth.
_Avoid_: Provider, other bank, external bank

**Linked account**:
An account the customer holds at an Institution, which Plinth can see but not move money in or out of. Plinth keeps a copy of its balance, not its transactions.
_Avoid_: External account, connected account, outside account

**Consent**:
The customer's permission for Plinth to see one Linked account, which lasts 12 months from the link date and can be renewed.
_Avoid_: Data choice, permission, authorization

**Sync**:
One read of a Linked account's balance from its Institution, made when the account is linked and once each simulated day while its Consent lasts.
_Avoid_: Refresh, import, fetch

**Net worth**:
Cash plus Investments plus Debt, across Plinth accounts and every Linked account whose Consent has not ended. Debt is below zero.
_Avoid_: Total balance, wealth, assets

**Access log**:
The customer-visible, permanent record of every read of the customer's data by anything other than the customer's own page views: who read it, what, why and when.
_Avoid_: Audit trail, Read list, access history

**Export**:
One JSON file of everything Plinth holds about the customer, downloaded from Privacy. Each Export writes an access log entry with the customer as reader, and the file includes it.
_Avoid_: Data dump, backup

**Closed customer**:
A customer who used Close and delete. Plinth has paid out their balances, deleted their working data, and kept the Ledger, Decision log and Access log as records. They can no longer sign in.
_Avoid_: Deleted customer, deactivated account

**Account-closure clearing account**:
The Clearing account that takes a Closed customer's Plinth balances when Close and delete pays them out, one ledger transaction per account under `closure:<customer id>:<account id>`.
_Avoid_: Closure account, exit account
