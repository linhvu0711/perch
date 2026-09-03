# Perch design log

Decisions from the design session on 2026-09-03. Big, hard-to-reverse ones have their own ADR in `docs/adr/`; this file is the full list so nothing is only in chat history. Vocabulary is in `CONTEXT.md`. X API facts are in `docs/research/x-api-v2.md`.

## Product scope (v1, internal)

- One user (me). One X account connected at a time.
- Resources: tweet (from URL, text-only), image (upload), note (Markdown, editable in-app).
- Posts: one tweet each, draft or official, optional schedule time, up to 4 images, linked to any number of resources, X-style preview, cost estimate.
- Calendar: month / week view of scheduled and published posts; click opens the post.
- Two interfaces: CLI (for me and for AI agents; token-cheap) and web UI.

## Architecture

| # | decision | choice | ADR |
|---|---|---|---|
| 1 | who fires scheduled posts | one always-on server process with a scheduler loop | 0001 |
| 2 | where it runs | Railway (Bun service + volume; deploy on push) | 0001 |
| 3 | language | TypeScript everywhere | 0008 |
| 4 | runtime | Bun | 0008 |
| 5 | database | SQLite on a volume, Drizzle ORM | 0002 |
| 6 | HTTP framework | Hono | 0008 |
| 7 | web UI | React + Vite SPA served by Hono | 0008 |
| 8 | CLI framework | Commander | 0008 |
| 9 | DB layer | Drizzle | 0002 |
| 10 | repo layout | Bun workspaces monorepo: apps/server, apps/web, apps/cli, packages/core | 0008 |

## Data model

| # | decision | choice | ADR |
|---|---|---|---|
| 11 | scheduled draft at its time | skip and mark missed; never send a draft | 0005 |
| 12 | publish failure | retry +1/+5/+15 min, then failed; manual `retry` | 0005 |
| 13 | linking a tweet resource | reference only; no quote/reply semantics | 0006 |
| 14 | linking an image resource | does not attach; attach is a separate action (max 4) | 0006 |
| 15 | IDs | plain integers per table | — |
| 16 | tags | one shared set for resources and posts; free text | — |
| 17 | cost | estimate per post + log every X call in `api_calls`; `perch cost` | — |
| 18 | X login | server-side OAuth from the web UI; CLI only opens the page | 0004 |
| 19 | login to our server | one shared secret `PERCH_TOKEN` (cookie for web, header for CLI) | 0003 |
| 20 | X accounts | own table; one connected at a time; posts get `x_account_id` at publish | 0004 |
| 21 | time zone | one user setting; store UTC; show in that zone everywhere | — |
| 22 | char limit | from `subscription_type` at connect: 280, or 25,000 for Premium/PremiumPlus; manual override | 0004 |
| 23 | queue / slots | none; a post has a schedule time or none | 0007 |
| 24 | threads | none in v1; schema leaves room (`parent_post_id`, `position`) | 0007 |
| 27 | delete a published post | local only; never delete on X | 0007 |
| 28 | delete a resource in use | allowed; unlink from all posts, report them | 0006 |
| 29 | save a tweet URL twice | return existing, no X call; `--refresh` re-fetches | 0007 |
| 30 | tweet resource rejects | media, article, retweet, reply, quote | 0007 |
| 31 | dismiss a missed / failed post | no flag; missed → `unschedule` (plain draft), failed → `demote` (draft, error cleared) | 0005 |
| 32 | post title | optional internal label; shown in lists and calendar; never sent to X | — |
| 33 | needs attention | missed + failed + drafts scheduled within 3 days | 0005 |
| 34 | publish a draft | allowed: `publish` promotes first with the same checks, then sends | 0005 |
| 35 | big lists | cursor paging on the server (`limit` + opaque `cursor`, `next_cursor` in JSON); web = "load more" on scroll for posts (50), resources (30), drawer (20); calendar loads one month/week, 3 per day then "+N more" opens the week; dropdowns load all and filter client-side; dashboard attention list caps at 10 with "See all" | — |
| 36 | backups | Litestream → Cloudflare R2 for SQLite; images copied to the same bucket on upload | 0002 |
| — | alt text on media | not supported | 0007 |
| — | multi-user later | `user_id` on every table now, nothing else | 0003 |

## CLI

| # | decision | choice |
|---|---|---|
| 25 | output | table on TTY, JSON when piped; `--json` / `--table` force |
| 26 | command tree | see `docs/cli.md` |
| — | batch | IDs and paths accept many; per-item errors in JSON |
| — | name | `perch` (was `xdesk`, briefly `roost`) |

## Tables (sketch)

```
users        id, created_at
x_accounts   id, user_id, x_user_id, username, subscription_type,
             access_token, refresh_token, expires_at, connected_at, disconnected_at
resources    id, user_id, type(tweet|image|md), title, notes, created_at,
             tweet_url, tweet_x_id, tweet_author_id, tweet_author_username, tweet_text, tweet_posted_at,
             image_path, image_mime, image_bytes, image_w, image_h,
             md_body
posts        id, user_id, status(draft|official|published|failed), title, text,
             scheduled_at, published_at, x_account_id, x_post_id, last_error, retry_count,
             parent_post_id, position, created_at, updated_at
post_media   id, post_id, position(1..4), path, mime, bytes, from_resource_id
post_links   post_id, resource_id
tags         id, user_id, name
resource_tags resource_id, tag_id
post_tags    post_id, tag_id
api_calls    id, user_id, endpoint, cost_usd, post_id, resource_id, x_account_id, created_at
settings     user_id, timezone, char_limit_override
```

## X API cost reference (pay-per-use, Sept 2026)

| action | cost |
|---|---|
| save a tweet (`GET /2/tweets/:id`) | $0.005 |
| publish, no link | $0.015 |
| publish, text has a URL | $0.200 |
| connect X (`GET /2/users/me`) | $0.010 |
| media upload | free |

Not used by Perch: delete post (~$0.010), alt text ($0.005).

## Web UI

Designed 2026-09-03/04. Spec: `docs/web-ui.md`. Clickable mockup: `docs/ui/perch-ui.html`.

## Open / next

- Hosting: Railway. Backups: Litestream → R2 (both decided 2026-09-04).
- Then build: restart Claude Code inside `perch/`, scaffold the monorepo (ADR-0008).
