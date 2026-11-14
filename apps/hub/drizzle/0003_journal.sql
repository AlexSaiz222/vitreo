CREATE TABLE `journal_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`device` text NOT NULL,
	`zone` text NOT NULL,
	`kind` text NOT NULL,
	`text` text,
	`width` integer,
	`height` integer,
	`bytes` integer,
	`created_at` integer NOT NULL,
	`saved_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `journal_device_zone` ON `journal_entries` (`device`,`zone`,`created_at`);