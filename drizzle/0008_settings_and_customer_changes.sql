CREATE TABLE `settings_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`version` integer NOT NULL,
	`autonomy_level` text NOT NULL,
	`advice_setting` text NOT NULL,
	`risk_market_drop` text NOT NULL,
	`risk_time_horizon` text NOT NULL,
	`train_models` integer NOT NULL,
	`share_with_partners` integer NOT NULL,
	`keep_chat_history` integer NOT NULL,
	`goal_preferences` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "settings_versions_version_positive" CHECK("settings_versions"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settings_versions_customer_version` ON `settings_versions` (`customer_id`,`version`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`trigger_ledger_event_id`) REFERENCES `ledger_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ledger_transaction_id`) REFERENCES `ledger_transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reverses_decision_id`) REFERENCES `decisions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "decisions_refused_by" CHECK(("__new_decisions"."result" = 'Refused') = ("__new_decisions"."refused_by" IS NOT NULL)),
	CONSTRAINT "decisions_rule_version" CHECK(("__new_decisions"."rule_id" IS NULL) = ("__new_decisions"."rule_version" IS NULL)),
	CONSTRAINT "decisions_agent_uses_rule" CHECK("__new_decisions"."actor" = 'customer' OR "__new_decisions"."rule_id" IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_decisions`("id", "customer_id", "created_at_ms", "actor", "trigger_ledger_event_id", "trigger_description", "rule_id", "rule_version", "action", "from_account_id", "to_account_id", "amount_cents", "result", "refused_by", "why", "ledger_transaction_id", "reverses_decision_id", "seen_at_ms") SELECT "id", "customer_id", "created_at_ms", "actor", "trigger_ledger_event_id", "trigger_description", "rule_id", "rule_version", "action", "from_account_id", "to_account_id", "amount_cents", "result", "refused_by", "why", "ledger_transaction_id", "reverses_decision_id", "seen_at_ms" FROM `decisions`;--> statement-breakpoint
DROP TABLE `decisions`;--> statement-breakpoint
ALTER TABLE `__new_decisions` RENAME TO `decisions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `decisions_customer_id` ON `decisions` (`customer_id`);--> statement-breakpoint
CREATE INDEX `decisions_trigger_ledger_event_id` ON `decisions` (`trigger_ledger_event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `decisions_reverses_decision_id` ON `decisions` (`reverses_decision_id`);