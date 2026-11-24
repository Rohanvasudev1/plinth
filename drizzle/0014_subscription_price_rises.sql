PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
INSERT INTO `__new_findings`("id", "customer_id", "kind", "created_at_ms", "title", "ledger_event_id", "rule_id", "rule_version", "facts", "options", "agents_view", "report", "mission_id", "standing_search", "state", "snoozed_until", "chosen_option", "refused_by", "refusal_reason") SELECT "id", "customer_id", "kind", "created_at_ms", "title", "ledger_event_id", "rule_id", "rule_version", "facts", "options", "agents_view", "report", "mission_id", "standing_search", "state", "snoozed_until", "chosen_option", "refused_by", "refusal_reason" FROM `findings`;--> statement-breakpoint
DROP TABLE `findings`;--> statement-breakpoint
ALTER TABLE `__new_findings` RENAME TO `findings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `findings_customer_id` ON `findings` (`customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `findings_customer_event_kind` ON `findings` (`customer_id`,`ledger_event_id`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `findings_customer_subscription_price` ON `findings` (`customer_id`,`subscription_merchant`,`subscription_price_cents`);--> statement-breakpoint
ALTER TABLE `settings_versions` ADD `subscription_price_rises` integer DEFAULT true NOT NULL;