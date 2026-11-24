CREATE TABLE `missions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`question` text NOT NULL,
	`state` text NOT NULL,
	`progress_label` text NOT NULL,
	`read_list` text NOT NULL,
	`started_at_ms` integer NOT NULL,
	`ended_at_ms` integer,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "missions_ended" CHECK(("missions"."state" = 'running') = ("missions"."ended_at_ms" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `missions_customer_id` ON `missions` (`customer_id`);--> statement-breakpoint
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
	`mission_id` integer,
	`finding_id` integer,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`trigger_ledger_event_id`) REFERENCES `ledger_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ledger_transaction_id`) REFERENCES `ledger_transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reverses_decision_id`) REFERENCES `decisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`finding_id`) REFERENCES `findings`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "decisions_refused_by" CHECK(("__new_decisions"."result" = 'Refused') = ("__new_decisions"."refused_by" IS NOT NULL)),
	CONSTRAINT "decisions_rule_version" CHECK(("__new_decisions"."rule_id" IS NULL) = ("__new_decisions"."rule_version" IS NULL)),
	CONSTRAINT "decisions_agent_uses_rule" CHECK("__new_decisions"."actor" = 'customer' OR "__new_decisions"."rule_id" IS NOT NULL OR "__new_decisions"."mission_id" IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_decisions`("id", "customer_id", "created_at_ms", "actor", "trigger_ledger_event_id", "trigger_description", "rule_id", "rule_version", "action", "from_account_id", "to_account_id", "amount_cents", "result", "refused_by", "why", "ledger_transaction_id", "reverses_decision_id", "seen_at_ms") SELECT "id", "customer_id", "created_at_ms", "actor", "trigger_ledger_event_id", "trigger_description", "rule_id", "rule_version", "action", "from_account_id", "to_account_id", "amount_cents", "result", "refused_by", "why", "ledger_transaction_id", "reverses_decision_id", "seen_at_ms" FROM `decisions`;--> statement-breakpoint
DROP TABLE `decisions`;--> statement-breakpoint
ALTER TABLE `__new_decisions` RENAME TO `decisions`;--> statement-breakpoint
CREATE INDEX `decisions_customer_id` ON `decisions` (`customer_id`);--> statement-breakpoint
CREATE INDEX `decisions_trigger_ledger_event_id` ON `decisions` (`trigger_ledger_event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `decisions_reverses_decision_id` ON `decisions` (`reverses_decision_id`);--> statement-breakpoint
CREATE TABLE `__new_findings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`kind` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`title` text NOT NULL,
	`ledger_event_id` integer,
	`rule_id` integer,
	`rule_version` integer,
	`facts` text NOT NULL,
	`options` text NOT NULL,
	`agents_view` text,
	`report` text,
	`mission_id` integer,
	`standing_search` text,
	`subscription_merchant` text,
	`subscription_price_cents` integer,
	`state` text NOT NULL,
	`snoozed_until` text,
	`chosen_option` text,
	`refused_by` text,
	`refusal_reason` text,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ledger_event_id`) REFERENCES `ledger_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "findings_chosen_option" CHECK(("__new_findings"."state" = 'chosen') = ("__new_findings"."chosen_option" IS NOT NULL)),
	CONSTRAINT "findings_refusal" CHECK(("__new_findings"."refused_by" IS NULL) = ("__new_findings"."refusal_reason" IS NULL)),
	CONSTRAINT "findings_snoozed_until" CHECK(("__new_findings"."state" = 'snoozed') = ("__new_findings"."snoozed_until" IS NOT NULL)),
	CONSTRAINT "findings_rule_version" CHECK(("__new_findings"."rule_id" IS NULL) = ("__new_findings"."rule_version" IS NULL)),
	CONSTRAINT "findings_sweep_names_paycheck_and_rule" CHECK("__new_findings"."kind" <> 'sweep' OR ("__new_findings"."ledger_event_id" IS NOT NULL AND "__new_findings"."rule_id" IS NOT NULL)),
	CONSTRAINT "findings_report_on_mission" CHECK("__new_findings"."report" IS NULL OR "__new_findings"."kind" = 'mission'),
	CONSTRAINT "findings_mission_link" CHECK("__new_findings"."mission_id" IS NULL OR "__new_findings"."kind" = 'mission'),
	CONSTRAINT "findings_standing_search_link" CHECK(("__new_findings"."standing_search" IS NOT NULL) = ("__new_findings"."kind" = 'subscription_price_rise')),
	CONSTRAINT "findings_subscription_price" CHECK(("__new_findings"."subscription_merchant" IS NOT NULL AND "__new_findings"."subscription_price_cents" IS NOT NULL) = ("__new_findings"."kind" = 'subscription_price_rise'))
);
--> statement-breakpoint
INSERT INTO `__new_findings`("id", "customer_id", "kind", "created_at_ms", "title", "ledger_event_id", "rule_id", "rule_version", "facts", "options", "agents_view", "report", "mission_id", "standing_search", "subscription_merchant", "subscription_price_cents", "state", "snoozed_until", "chosen_option", "refused_by", "refusal_reason") SELECT "id", "customer_id", "kind", "created_at_ms", "title", "ledger_event_id", "rule_id", "rule_version", "facts", "options", "agents_view", "report", "mission_id", "standing_search", "subscription_merchant", "subscription_price_cents", "state", "snoozed_until", "chosen_option", "refused_by", "refusal_reason" FROM `findings`;--> statement-breakpoint
DROP TABLE `findings`;--> statement-breakpoint
ALTER TABLE `__new_findings` RENAME TO `findings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `findings_customer_id` ON `findings` (`customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `findings_customer_event_kind` ON `findings` (`customer_id`,`ledger_event_id`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `findings_mission_id` ON `findings` (`mission_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `findings_customer_subscription_price` ON `findings` (`customer_id`,`subscription_merchant`,`subscription_price_cents`);