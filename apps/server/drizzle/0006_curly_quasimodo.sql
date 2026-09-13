DROP INDEX `resources_user_tweet_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `resources_user_tweet_x_id_idx` ON `resources` (`user_id`,`tweet_x_id`);