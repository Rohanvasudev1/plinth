CREATE TABLE `decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	`actor` text NOT NULL,
	`trigger_ledger_event_id` integer,
	`trigger_description` text NOT NULL,
	`rule_id` integer NOT NULL,
	`rule_version` integer NOT NULL,
	`action` text NOT NULL,
	`from_account_id` integer NOT NULL,
	`to_account_id` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`result` text NOT NULL,
	`refused_by` text,
	`why` text NOT NULL,
	`ledger_transaction_id` integer,
	`reverses_decision_id` integer,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`trigger_ledger_event_id`) REFERENCES `ledger_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ledger_transaction_id`) REFERENCES `ledger_transactions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "decisions_refused_by" CHECK(("decisions"."result" = 'Refused') = ("decisions"."refused_by" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `decisions_customer_id` ON `decisions` (`customer_id`);--> statement-breakpoint
CREATE INDEX `decisions_trigger_ledger_event_id` ON `decisions` (`trigger_ledger_event_id`);--> statement-breakpoint
CREATE TABLE `rule_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rule_id` integer NOT NULL,
	`version` integer NOT NULL,
	`parameters` text NOT NULL,
	`is_on` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "rule_versions_version_positive" CHECK("rule_versions"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rule_versions_rule_version` ON `rule_versions` (`rule_id`,`version`);--> statement-breakpoint
CREATE TABLE `rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`kind` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `rules_customer_id` ON `rules` (`customer_id`);