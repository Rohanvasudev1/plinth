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

**Goal**:
A target amount attached to one of the customer's savings accounts, such as the House fund.
_Avoid_: Target, pot

**Safe to spend**:
The checking balance minus the Buffer minus Scheduled bills due before the next payday.
_Avoid_: Available balance, spare cash

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

**Guardrail**:
A check that runs before any agent action and refuses it if it breaks a Rule or ownership limit.
_Avoid_: Validation, safety check

**Decision log**:
The customer-visible record of every agent action, with its trigger, the Rule it used, and its result.
_Avoid_: Audit trail, history

**Why**:
The explanation of one Decision log entry, built from its recorded trigger, Rule and checks.
_Avoid_: Reason, rationale

**Undo**:
Reversing an agent action with a new, opposite ledger transaction.
_Avoid_: Rollback, cancel
