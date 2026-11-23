CREATE TABLE `scheduled_bills` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`account_id` integer NOT NULL,
	`payee` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`day_of_month` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "scheduled_bills_amount_positive" CHECK("scheduled_bills"."amount_cents" > 0),
	CONSTRAINT "scheduled_bills_day_of_month" CHECK("scheduled_bills"."day_of_month" BETWEEN 1 AND 31)
);
--> statement-breakpoint
CREATE INDEX `scheduled_bills_customer_id` ON `scheduled_bills` (`customer_id`);