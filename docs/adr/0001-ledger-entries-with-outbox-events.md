# Ledger of entries, balances by sum, events in an outbox

The ledger is an append-only table of entries grouped into ledger transactions whose entries sum to zero. Balances are computed with a SUM query, and no code updates or deletes an entry. Each ledger transaction writes a ledger event row in the same database transaction, and rules react to it in-process right after the commit. We chose this over full event sourcing and over a separate balances table: it keeps one source of truth, it needs no message broker, and it still lets rules run off ledger events instead of batches.
