CREATE TABLE `accounts` (
	`id` varchar(255) NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`account_id` varchar(255) NOT NULL,
	`provider_id` varchar(255) NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`access_token_expires_at` timestamp,
	`refresh_token_expires_at` timestamp,
	`scope` text,
	`id_token` text,
	`password` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `accounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` varchar(255) NOT NULL,
	`identifier` varchar(255) NOT NULL,
	`value` varchar(255) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `verifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` DROP INDEX `users_google_id_unique`;--> statement-breakpoint
ALTER TABLE `sessions` MODIFY COLUMN `user_id` bigint unsigned NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `token` varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `expires_at` timestamp NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `created_at` timestamp DEFAULT (now()) NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `updated_at` timestamp DEFAULT (now()) NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `email_verified` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `image` varchar(255);--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_token_unique` UNIQUE(`token`);--> statement-breakpoint
ALTER TABLE `accounts` ADD CONSTRAINT `accounts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `payload`;--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `last_activity`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `password`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `google_id`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `avatar_url`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `email_verified_at`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `remember_token`;