CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`system_key` text,
	`goal_cents` integer,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "accounts_owner" CHECK(("accounts"."kind" = 'system') = ("accounts"."customer_id" IS NULL AND "accounts"."system_key" IS NOT NULL)),
	CONSTRAINT "accounts_goal_on_savings" CHECK("accounts"."goal_cents" IS NULL OR ("accounts"."kind" = 'savings' AND "accounts"."goal_cents" > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_system_key_unique` ON `accounts` (`system_key`);--> statement-breakpoint
CREATE INDEX `accounts_customer_id` ON `accounts` (`customer_id`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_name_unique` ON `customers` (`name`);--> statement-breakpoint
CREATE TABLE `ledger_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ledger_transaction_id` integer NOT NULL,
	`account_id` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	FOREIGN KEY (`ledger_transaction_id`) REFERENCES `ledger_transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ledger_entries_account_id` ON `ledger_entries` (`account_id`);--> statement-breakpoint
CREATE INDEX `ledger_entries_ledger_transaction_id` ON `ledger_entries` (`ledger_transaction_id`);--> statement-breakpoint
CREATE TABLE `ledger_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`ledger_transaction_id` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ledger_transaction_id`) REFERENCES `ledger_transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_events_ledger_transaction_id_unique` ON `ledger_events` (`ledger_transaction_id`);--> statement-breakpoint
CREATE TABLE `ledger_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`description` text NOT NULL,
	`posted_at_ms` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_transactions_idempotency_key_unique` ON `ledger_transactions` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `ledger_transactions_customer_id` ON `ledger_transactions` (`customer_id`);