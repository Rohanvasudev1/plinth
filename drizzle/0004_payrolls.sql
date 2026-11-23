CREATE TABLE `payrolls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`account_id` integer NOT NULL,
	`employer` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`first_pay_date` text NOT NULL,
	`interval_days` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payrolls_amount_positive" CHECK("payrolls"."amount_cents" > 0),
	CONSTRAINT "payrolls_interval_positive" CHECK("payrolls"."interval_days" > 0)
);
--> statement-breakpoint
CREATE INDEX `payrolls_customer_id` ON `payrolls` (`customer_id`);