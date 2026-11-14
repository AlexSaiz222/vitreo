CREATE TABLE `weather_forecasts` (
	`device` text NOT NULL,
	`municipality` text NOT NULL,
	`name` text NOT NULL,
	`issued_at` integer NOT NULL,
	`received_at` integer NOT NULL,
	`points` text NOT NULL,
	PRIMARY KEY(`device`, `municipality`, `issued_at`)
);
--> statement-breakpoint
CREATE TABLE `weather_observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device` text NOT NULL,
	`station` text NOT NULL,
	`station_name` text NOT NULL,
	`at` integer NOT NULL,
	`received_at` integer NOT NULL,
	`temp` real,
	`rh` real,
	`wind_speed` real,
	`wind_gust` real,
	`wind_dir` real,
	`precip` real,
	`visibility` real,
	`raw` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weather_obs_device_station_at` ON `weather_observations` (`device`,`station`,`at`);--> statement-breakpoint
-- Frost forecasts get their own notification type (A10): every browser already subscribed gets it on, as a new subscription would.
UPDATE `push_subscriptions` SET `types` = json_insert(`types`, '$[#]', 'frost_forecast') WHERE NOT EXISTS (SELECT 1 FROM json_each(`push_subscriptions`.`types`) WHERE `value` = 'frost_forecast');
