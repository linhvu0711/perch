ALTER TABLE `post_tags` ADD `user_id` integer NOT NULL REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `resource_tags` ADD `user_id` integer NOT NULL REFERENCES users(id);