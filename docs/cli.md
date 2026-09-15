# Perch CLI

Command: `perch`. Config: `~/.perch/config.json`. Env: `PERCH_SERVER_URL`, `PERCH_TOKEN`.
The CLI is a thin client; every command is one or more HTTP calls to the server. It never touches X directly.

## Conventions

- **IDs are integers**, separate per table. `perch post show 3` and `perch resource show 3` are different things.
- **Output**: table when stdout is a terminal, JSON when piped. `--json` / `--table` force it.
- **Errors**: stderr, non-zero exit. JSON object when in JSON mode. Exit 2 when the CLI rejects the command before any request (bad flag, argument, or value), 3 when the server answers unauthorized, 1 for every other failure.
- **Batch**: arguments that are IDs or paths accept many (`delete 1 2 3`). Text, time, and content take one. In JSON mode a batch returns one result per item with per-item errors; one bad item does not stop the rest.
- **Destructive commands** (`delete`) prompt unless `--yes`. In non-TTY mode they require `--yes`.
- **Text input**: `--text "..."`, `--file <path>`, or `-` for stdin. `-e` opens `$EDITOR` (TTY only).
- **Times**: `--at` accepts ISO (`2026-09-10T09:00`), `"2026-09-10 09:00"`, or relative (`+2h`, `tomorrow 9am`). Read and printed in the configured `timezone`. Stored as UTC.
- **Dates** for `--from` / `--to`: `YYYY-MM-DD`, inclusive.
- Global flags: `--json`, `--table`, `--yes`, `--server <url>`.
- **Paging**: `list` commands return at most `--limit` items (default 50). JSON output carries `next_cursor` when more exist; pass it back with `--cursor <token>` to get the next page. Cursors are opaque (sort key + id), so new items never shift a page. The web UI uses the same endpoint with "load more".

## Commands

### Setup and status

```
perch config get <key>
perch config set <key> <value>        keys: server-url, token, mirror-dir, timezone, char-limit
perch auth status                     is the token valid, which user
perch auth login                      prints and opens the web UI login page
perch auth logout                     clears the local token
perch account show                    connected X account: @handle, subscription, char limit, connected since
perch account disconnect [--yes]      revoke the X token at X and disconnect; keeps history
perch status                          account, next 5 due posts, missed count, failed count, month cost; Mirror path and last pull time
```

### Resources

```
perch resource add tweet <url>...                 [--tag t]...
perch resource add image <path>...                [--title s] [--tag t]...
perch resource add md <path>...|-                 [--title s] [--tag t]...
perch resource list   [--type tweet|image|md] [--tag t]... [--author @handle]
                      [--from d] [--to d] [--search q] [--sort created|used] [--desc] [--limit n] [--cursor c]
perch resource show <id>                          full text, note body, or image path + size
perch resource edit <id>  [--title s] [--notes s] [--content <path>|-] [-e]
perch resource tag <id>...  [--add t]... [--remove t]...
perch resource delete <id>... [--yes]
perch resource pull [--dir <path>]               copy every Resource into the Mirror
```

- `add tweet` fetches `GET /2/tweets/:id` ($0.015). Rejects with a reason: media, article, retweet, reply, quote. A URL already saved returns the existing resource, no X call, exit 0. `--refresh` forces a re-fetch.
- `add image`: PNG, JPG, WebP, GIF; 5 MB max. Title defaults to the file name.
- `add md`: title defaults to the first `#` heading, else the file name.
- `edit --content` and `-e` apply to md only; `--title` / `--notes` apply to every type.
- `list --author` applies to tweets only. `--from` / `--to` filter on the date saved.
- `delete` removes links from all posts (published too) and prints which posts were unlinked.
- `pull` writes one `<yyyy-mm-dd>-<id>-<slug>.md` per Resource with YAML front matter, under `notes/`, `tweets/`, or `images/` by type; each image `.md` gets the image file next to it, named in its `file` field; a `manifest.json` lists every path; only changed files are rewritten, and an image file is fetched only when its size differs from the server's; only Manifest paths are deleted; nothing is written when a download fails.

### Posts

```
perch post create   [--title s] [--text s|--file p|-] [--from <rid>]... [--tag t]... [--at time] [--official]
perch post list     [--status draft|official|published|failed] [--scheduled|--unscheduled] [--missed]
                    [--needs-attention] [--tag t]... [--search q] [--from d] [--to d] [--limit n] [--cursor c]
perch post show <id>            text, char count/limit, est. cost, status, schedule time, links, media, X url
perch post preview <id>         ASCII rendering of how it looks on X, plus char + cost lines
perch post edit <id>  [--title s] [--text s|--file p|-] [-e]
perch post promote <id>...      draft → official; validates
perch post demote <id>...       official or failed → draft; clears the error
perch post schedule <id> --at <time>
perch post unschedule <id>...
perch post link <id>   --resource <rid>...
perch post unlink <id> --resource <rid>...
perch post attach <id> [--resource <rid>]... [--file <path>]...
perch post detach <id> --media <n>... | --all
perch post tag <id>...  [--add t]... [--remove t]...
perch post publish <id>         send now; a draft is promoted first (same checks)
perch post retry <id>           re-send a failed post now
perch post delete <id>... [--yes]
```

- `create` makes a **draft** by default. `--from` links the resources and copies their tags. Text may be empty.
- `--title` is a short internal label shown in lists and on the calendar. It is never sent to X. Optional; lists fall back to the first line of text.
- `promote` checks: text not empty, weighted chars ≤ limit, ≤ 4 media, media files present. Errors list every failure.
- `schedule` on a published post errors. Scheduling in the past errors unless `--force`.
- `attach`: total media ≤ 4. From a resource: copies the file and links the resource. From a file: uploads it. Media has no alt text. `--json` prints per-item results: `[{ id, ok, media }]` for resources, `[{ name, ok, media }]` for files, with `error` on failures — including `read_failed` for files the CLI cannot read.
- `detach --media <n>`: n is the 1-based position shown by `post show`. Prints the remaining media array (`--json`: `[{ id, position, mime, bytes, from_resource_id }]`).
- `publish`: on a draft, runs the promote checks and promotes first; clears the schedule time; on success status becomes published and `x_account_id` is set. `post list --from/--to` filter on schedule time, or published time for published posts.
- `retry`: only for failed posts; sends now. `publish` and `retry` print the post on success; when X rejects the send they print `{ code: 'publish_failed', message }` on stderr and exit 1.
- `show` and `list --json` carry `x_post_url` and `missed`; the table shows `missed` in the status column.
- `list --json` rows also carry `reason` (`null` unless the Post is an Issue); the table shows it in a `reason` column.
- `delete`: local only. Never deletes on X.

### Tags, calendar, cost

```
perch tag list                        name, resource count, post count
perch tag create <name>...
perch tag rename <old> <new>
perch tag delete <name>...            removes from everything

perch calendar   [--week|--month] [--from <date>] [--tag t]...
                 default: this month. Prints posts by day with time, status, and marks for missed/failed.

perch cost       [--month YYYY-MM]    default: this month. Total and split by kind.
```

- `calendar --from` picks the month or the Monday-first week that holds that date; default is the month that holds today in the configured `timezone`. JSON is `{ from, to, days: [{ date, posts }] }`, each post the `post list` shape plus `missed`; the table has `day time id status mark title`, `mark` is `MISSED` or `FAILED`.

### Server

```
perch serve                           run the server (used in production and `bun run dev`)
```

### Open

```
perch open post <id>                  open the post in the web app
perch open resource <id>              open the resource in the web app
```

- Prints the URL and opens it in the browser on a terminal; without a TTY it only prints.

## Post status and time

| status | scheduled | scheduler does |
|---|---|---|
| draft | no | nothing |
| draft | yes | at time: skip, mark **missed** |
| official | no | nothing |
| official | yes | at time: publish; retry +1, +5, +15 min; then **failed** |
| published | — | nothing; read-only |
| failed | (kept) | nothing until `retry` |

`missed` is a flag, not a status: a draft whose schedule time has passed, or an official post whose schedule time passed while no X account was connected at that time.

**Issues** (`perch status`, web dashboard) = missed posts + failed posts. `--needs-attention` lists them.

**Dismissing** is not a separate state. `unschedule` clears the time of a missed draft, so it is a plain draft again. `demote` turns a failed post into a draft. There is no `dismissed` field.

## Cost lines shown by `post show` / `post preview`

| condition | estimate |
|---|---|
| text, with or without images | $0.015 |
| text contains any http(s) URL | $0.200 |

Mentions and hashtags do not count as URLs. Every URL counts as 23 weighted characters.
