CREATE TABLE `acks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device` text NOT NULL,
	`request_id` text NOT NULL,
	`ts` integer NOT NULL,
	`received_at` integer NOT NULL,
	`result` text NOT NULL,
	`reason` text,
	`raw` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `acks_device_request` ON `acks` (`device`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `acks_device_raw` ON `acks` (`device`,`raw`);--> statement-breakpoint
CREATE TABLE `commands` (
	`request_id` text NOT NULL,
	`device` text NOT NULL,
	`received_at` integer NOT NULL,
	`source` text NOT NULL,
	`action` text NOT NULL,
	`raw` text NOT NULL,
	PRIMARY KEY(`device`, `request_id`)
);
--> statement-breakpoint
CREATE TABLE `config_revisions` (
	`device` text NOT NULL,
	`rev` integer NOT NULL,
	`ts` integer NOT NULL,
	`origin` text NOT NULL,
	`raw` text NOT NULL,
	`applied_at` integer,
	PRIMARY KEY(`device`, `rev`)
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device` text NOT NULL,
	`ts` integer NOT NULL,
	`received_at` integer NOT NULL,
	`type` text NOT NULL,
	`source` text,
	`zone` text,
	`request_id` text,
	`raw` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_device_ts` ON `events` (`device`,`ts`);--> statement-breakpoint
CREATE UNIQUE INDEX `events_device_raw` ON `events` (`device`,`raw`);--> statement-breakpoint
CREATE TABLE `hourly` (
	`device` text NOT NULL,
	`hour` integer NOT NULL,
	`metric` text NOT NULL,
	`zone` text DEFAULT '' NOT NULL,
	`count` integer NOT NULL,
	`mean` real,
	`min` real,
	`max` real,
	PRIMARY KEY(`device`, `hour`, `metric`, `zone`)
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`name` text PRIMARY KEY NOT NULL,
	`value` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plants` (
	`zone` text PRIMARY KEY NOT NULL,
	`device` text NOT NULL,
	`kind` text NOT NULL,
	`name` text,
	`sown_at` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rejected` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`received_at` integer NOT NULL,
	`topic` text NOT NULL,
	`payload` text NOT NULL,
	`error` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `soil` (
	`telemetry_id` integer NOT NULL,
	`device` text NOT NULL,
	`ts` integer NOT NULL,
	`zone` text NOT NULL,
	`moisture` real,
	`cal` integer,
	FOREIGN KEY (`telemetry_id`) REFERENCES `telemetry`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `soil_device_zone_ts` ON `soil` (`device`,`zone`,`ts`);--> statement-breakpoint
CREATE TABLE `status_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device` text NOT NULL,
	`received_at` integer NOT NULL,
	`state` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `status_device_at` ON `status_changes` (`device`,`received_at`);--> statement-breakpoint
CREATE TABLE `telemetry` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device` text NOT NULL,
	`ts` integer NOT NULL,
	`received_at` integer NOT NULL,
	`air_temp` real,
	`air_rh` real,
	`lux` real,
	`tank` real,
	`pump` integer NOT NULL,
	`grow_light` integer NOT NULL,
	`fan` integer NOT NULL,
	`vent` real NOT NULL,
	`fw` text,
	`rssi` integer,
	`raw` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telemetry_device_ts` ON `telemetry` (`device`,`ts`);