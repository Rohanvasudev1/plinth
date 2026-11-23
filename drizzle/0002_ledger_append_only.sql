-- The ledger is append-only (ADR 0001): refuse any update or delete of its rows.
CREATE TRIGGER `ledger_transactions_no_update` BEFORE UPDATE ON `ledger_transactions`
BEGIN SELECT RAISE(ABORT, 'ledger_transactions is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `ledger_transactions_no_delete` BEFORE DELETE ON `ledger_transactions`
BEGIN SELECT RAISE(ABORT, 'ledger_transactions is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `ledger_entries_no_update` BEFORE UPDATE ON `ledger_entries`
BEGIN SELECT RAISE(ABORT, 'ledger_entries is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `ledger_entries_no_delete` BEFORE DELETE ON `ledger_entries`
BEGIN SELECT RAISE(ABORT, 'ledger_entries is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `ledger_events_no_update` BEFORE UPDATE ON `ledger_events`
BEGIN SELECT RAISE(ABORT, 'ledger_events is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `ledger_events_no_delete` BEFORE DELETE ON `ledger_events`
BEGIN SELECT RAISE(ABORT, 'ledger_events is append-only'); END;
