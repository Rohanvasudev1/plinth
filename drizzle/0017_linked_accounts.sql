CREATE TABLE `linked_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`institution_account` text NOT NULL,
	`institution` text NOT NULL,
	`type` text NOT NULL,
	`balance_cents` integer NOT NULL,
	`synced_at_ms` integer NOT NULL,
	`consent_start` text NOT NULL,
	`consent_end` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "linked_accounts_consent_order" CHECK("linked_accounts"."consent_start" < "linked_accounts"."consent_end")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `linked_accounts_customer_institution_account` ON `linked_accounts` (`customer_id`,`institution_account`);