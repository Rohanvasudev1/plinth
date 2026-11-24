CREATE TABLE `access_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	`who` text NOT NULL,
	`what` text NOT NULL,
	`why` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `access_log_customer_id` ON `access_log` (`customer_id`);--> statement-breakpoint
-- Nothing ever removes or changes an access log entry (ADR 0010): refuse any update or delete of its rows.
CREATE TRIGGER `access_log_no_update` BEFORE UPDATE ON `access_log`
BEGIN SELECT RAISE(ABORT, 'access_log is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `access_log_no_delete` BEFORE DELETE ON `access_log`
BEGIN SELECT RAISE(ABORT, 'access_log is append-only'); END;
