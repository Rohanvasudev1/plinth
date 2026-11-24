-- Seeded House fund and Travel fund accounts become the Goal accounts for buy_home and travel.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`system_key` text,
	`goal_cents` integer,
	`goal` text,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "accounts_owner" CHECK(("__new_accounts"."kind" = 'system') = ("__new_accounts"."customer_id" IS NULL AND "__new_accounts"."system_key" IS NOT NULL)),
	CONSTRAINT "accounts_goal_on_savings" CHECK("__new_accounts"."goal_cents" IS NULL OR ("__new_accounts"."kind" = 'savings' AND "__new_accounts"."goal_cents" > 0)),
	CONSTRAINT "accounts_savings_goal_on_savings" CHECK("__new_accounts"."goal" IS NULL OR "__new_accounts"."kind" = 'savings')
);
--> statement-breakpoint
INSERT INTO `__new_accounts`("id", "customer_id", "kind", "name", "system_key", "goal_cents", "goal") SELECT "id", "customer_id", "kind", "name", "system_key", "goal_cents", CASE WHEN "kind" = 'savings' AND "name" = 'House fund' THEN 'buy_home' WHEN "kind" = 'savings' AND "name" = 'Travel fund' THEN 'travel' END FROM `accounts`;--> statement-breakpoint
DROP TABLE `accounts`;--> statement-breakpoint
ALTER TABLE `__new_accounts` RENAME TO `accounts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_system_key_unique` ON `accounts` (`system_key`);--> statement-breakpoint
CREATE INDEX `accounts_customer_id` ON `accounts` (`customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_customer_goal` ON `accounts` (`customer_id`,`goal`);