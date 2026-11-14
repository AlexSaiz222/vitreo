CREATE TABLE `plant_chapters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device` text NOT NULL,
	`zone` text NOT NULL,
	`kind` text NOT NULL,
	`name` text,
	`sown_at` text,
	`started_at` integer,
	`ended_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `plant_chapters_zone` ON `plant_chapters` (`device`,`zone`,`ended_at`);--> statement-breakpoint
ALTER TABLE `journal_entries` ADD `tags` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `plants` ADD `since` integer;