---
status: accepted
date: 2026-09-03
---

# One always-on hosted server owns the data, the scheduler, and all X access

X has no native scheduled posts, so something must be awake at the schedule time. We run one Bun process on Railway (persistent volume for the SQLite file and uploads; deploys from the GitHub repo on push; Fly.io was the alternative, rejected as more setup for no gain at this size). It holds the database, runs the scheduler loop, serves the web UI as static files, and is the only thing that ever calls the X API. The CLI and the web UI are thin clients that talk to it over HTTP.

## Considered options

- **Local-only (CLI + cron on the Mac).** Rejected: a sleeping Mac means a missed post, and the web UI needs a server anyway.
- **Supabase (Postgres + Edge Functions + pg_cron).** Rejected: Edge Functions run Deno not Bun, there is no place for a long-running loop, local dev needs Docker, the free tier pauses idle projects, and the web UI still needs a separate host. It adds a service instead of removing one.
- **Next.js as the server.** Rejected: no good home for a background loop, weak Bun support, and it would be a second server next to the API.

## Consequences

- The CLI and web UI never hold X tokens. They authenticate to our server; our server authenticates to X.
- The server must run on a host with a persistent disk (SQLite file + uploaded images live there).
- Everything the clients need is one HTTP API; both clients share its types.
