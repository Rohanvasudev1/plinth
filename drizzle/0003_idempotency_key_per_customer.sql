DROP INDEX `ledger_transactions_idempotency_key_unique`;--> statement-breakpoint
DROP INDEX `ledger_transactions_customer_id`;--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_transactions_customer_key` ON `ledger_transactions` (`customer_id`,`idempotency_key`);