CREATE TABLE `group_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`customer_id` integer,
	`outside_contact_id` integer,
	FOREIGN KEY (`group_id`) REFERENCES `split_groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`outside_contact_id`) REFERENCES `outside_contacts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "group_members_one_person" CHECK(("group_members"."customer_id" IS NULL) <> ("group_members"."outside_contact_id" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_members_group_customer` ON `group_members` (`group_id`,`customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `group_members_group_outside_contact` ON `group_members` (`group_id`,`outside_contact_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `group_members_group_id_id` ON `group_members` (`group_id`,`id`);--> statement-breakpoint
CREATE INDEX `group_members_customer_id` ON `group_members` (`customer_id`);--> statement-breakpoint
CREATE TABLE `split_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `outside_contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outside_contacts_name_unique` ON `outside_contacts` (`name`);--> statement-breakpoint
CREATE TABLE `shared_costs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`paid_by_member_id` integer NOT NULL,
	`description` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`date` text NOT NULL,
	`source` text NOT NULL,
	`decision_id` integer,
	`ledger_transaction_id` integer,
	`removed_at_ms` integer,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `split_groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decision_id`) REFERENCES `decisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ledger_transaction_id`) REFERENCES `ledger_transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`,`paid_by_member_id`) REFERENCES `group_members`(`group_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "shared_costs_amount_positive" CHECK("shared_costs"."amount_cents" > 0),
	CONSTRAINT "shared_costs_decision_on_split_rule" CHECK("shared_costs"."decision_id" IS NULL OR "shared_costs"."source" = 'split_rule')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shared_costs_ledger_transaction_id_unique` ON `shared_costs` (`ledger_transaction_id`);--> statement-breakpoint
CREATE INDEX `shared_costs_group_id` ON `shared_costs` (`group_id`);