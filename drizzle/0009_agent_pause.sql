CREATE TABLE `pause_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`paused` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pause_changes_customer_id` ON `pause_changes` (`customer_id`);