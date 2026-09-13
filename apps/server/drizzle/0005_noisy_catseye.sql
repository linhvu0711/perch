ALTER TABLE `resources` ADD `tweet_url` text;--> statement-breakpoint
ALTER TABLE `resources` ADD `tweet_x_id` text;--> statement-breakpoint
ALTER TABLE `resources` ADD `tweet_author_id` text;--> statement-breakpoint
ALTER TABLE `resources` ADD `tweet_author_username` text;--> statement-breakpoint
ALTER TABLE `resources` ADD `tweet_text` text;--> statement-breakpoint
ALTER TABLE `resources` ADD `tweet_posted_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `resources_user_tweet_idx` ON `resources` (`user_id`,`tweet_x_id`);