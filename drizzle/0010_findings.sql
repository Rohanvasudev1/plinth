CREATE TABLE `findings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`kind` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`ledger_event_id` integer NOT NULL,
	`rule_id` integer NOT NULL,
	`rule_version` integer NOT NULL,
	`facts` text NOT NULL,
	`options` text NOT NULL,
	`state` text NOT NULL,
	`chosen_option` text,
	`refused_by` text,
	`refusal_reason` text,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ledger_event_id`) REFERENCES `ledger_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "findings_chosen_option" CHECK(("findings"."state" = 'chosen') = ("findings"."chosen_option" IS NOT NULL)),
	CONSTRAINT "findings_refusal" CHECK(("findings"."refused_by" IS NULL) = ("findings"."refusal_reason" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `findings_customer_id` ON `findings` (`customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `findings_customer_event_kind` ON `findings` (`customer_id`,`ledger_event_id`,`kind`);