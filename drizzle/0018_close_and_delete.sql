PRAGMA foreign_keys=OFF;--> statement-breakpoint
-- The migrator runs inside a transaction, where foreign_keys=OFF does nothing. An Undo row points at another decision,
-- so the new table's self-reference names the new table: dropping the old one then breaks no row, and the rename
-- below rewrites the reference to `decisions`.
CREATE TABLE `__new_decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	`actor` text NOT NULL,
	`trigger_ledger_event_id` integer,
	`trigger_description` text NOT NULL,
	`rule_id` integer,
	`rule_version` integer,
	`action` text NOT NULL,
	`from_account_id` integer,
	`to_account_id` integer,
	`amount_cents` integer NOT NULL,
	`result` text NOT NULL,
	`refused_by` text,
	`why` text NOT NULL,
	`ledger_transaction_id` integer,
	`reverses_decision_id` integer,
	`seen_at_ms` integer,
	`mission_id` integer,
	`finding_id` integer,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`trigger_ledger_event_id`) REFERENCES `ledger_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ledger_transaction_id`) REFERENCES `ledger_transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reverses_decision_id`) REFERENCES `__new_decisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`finding_id`) REFERENCES `findings`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "decisions_refused_by" CHECK(("__new_decisions"."result" = 'Refused') = ("__new_decisions"."refused_by" IS NOT NULL)),
	CONSTRAINT "decisions_rule_version" CHECK(("__new_decisions"."rule_id" IS NULL) = ("__new_decisions"."rule_version" IS NULL)),
	CONSTRAINT "decisions_agent_uses_rule" CHECK("__new_decisions"."actor" = 'customer' OR "__new_decisions"."rule_id" IS NOT NULL OR "__new_decisions"."mission_id" IS NOT NULL OR "__new_decisions"."result" IN ('Reported', 'Stopped', 'Failed'))
);
--> statement-breakpoint
INSERT INTO `__new_decisions`("id", "customer_id", "created_at_ms", "actor", "trigger_ledger_event_id", "trigger_description", "rule_id", "rule_version", "action", "from_account_id", "to_account_id", "amount_cents", "result", "refused_by", "why", "ledger_transaction_id", "reverses_decision_id", "seen_at_ms", "mission_id", "finding_id") SELECT "id", "customer_id", "created_at_ms", "actor", "trigger_ledger_event_id", "trigger_description", "rule_id", "rule_version", "action", "from_account_id", "to_account_id", "amount_cents", "result", "refused_by", "why", "ledger_transaction_id", "reverses_decision_id", "seen_at_ms", "mission_id", "finding_id" FROM `decisions`;--> statement-breakpoint
DROP TABLE `decisions`;--> statement-breakpoint
ALTER TABLE `__new_decisions` RENAME TO `decisions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `decisions_customer_id` ON `decisions` (`customer_id`);--> statement-breakpoint
CREATE INDEX `decisions_trigger_ledger_event_id` ON `decisions` (`trigger_ledger_event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `decisions_reverses_decision_id` ON `decisions` (`reverses_decision_id`);--> statement-breakpoint
ALTER TABLE `customers` ADD `closed_at_ms` integer;