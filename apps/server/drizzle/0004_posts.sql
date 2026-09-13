CREATE TABLE `post_links` (
	`post_id` integer NOT NULL,
	`resource_id` integer NOT NULL,
	PRIMARY KEY(`post_id`, `resource_id`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`scheduled_at` integer,
	`published_at` integer,
	`x_account_id` integer,
	`x_post_id` text,
	`last_error` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`parent_post_id` integer,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `posts_user_scheduled_idx` ON `posts` (`user_id`,`scheduled_at`,`id`);