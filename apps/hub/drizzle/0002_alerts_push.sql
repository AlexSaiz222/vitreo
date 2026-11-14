CREATE TABLE `incidents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device` text NOT NULL,
	`key` text NOT NULL,
	`type` text NOT NULL,
	`critical` integer NOT NULL,
	`zone` text,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`url` text NOT NULL,
	`opened_at` integer NOT NULL,
	`notified_at` integer,
	`last_notified_at` integer,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE INDEX `incidents_device_open` ON `incidents` (`device`,`resolved_at`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`endpoint` text PRIMARY KEY NOT NULL,
	`device` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`types` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
