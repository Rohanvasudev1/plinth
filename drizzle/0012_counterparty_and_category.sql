ALTER TABLE `ledger_transactions` ADD `counterparty` text;--> statement-breakpoint
ALTER TABLE `ledger_transactions` ADD `category` text;--> statement-breakpoint
ALTER TABLE `scheduled_bills` ADD `category` text;--> statement-breakpoint
-- Bills set up before Categories existed: rent is Housing, internet, phone and power are Utilities, and a gym is Health.
UPDATE `scheduled_bills` SET `category` = 'Housing' WHERE `category` IS NULL AND `payee` = 'Rent';--> statement-breakpoint
UPDATE `scheduled_bills` SET `category` = 'Utilities' WHERE `category` IS NULL AND `payee` IN ('Internet', 'Phone', 'Power');--> statement-breakpoint
UPDATE `scheduled_bills` SET `category` = 'Health' WHERE `category` IS NULL AND `payee` = 'Gym';
