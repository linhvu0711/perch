---
status: accepted
date: 2026-09-03
---

# Single user today, but every table carries `user_id` from day one

Perch is internal for now. We do not build signup, sessions, per-user API keys, or billing. But we may open it to others later, so we make the cheap preparations now and no more:

- A `users` table with one seeded row.
- `user_id` on posts, resources, tags, media, x_accounts, api_calls. Every query filters by it.
- Auth is one function, `getUser(request)`. Today it checks a single shared secret (`PERCH_TOKEN`, used by both the web UI cookie and the CLI header) and returns user 1. Multi-user means rewriting only that function.
- X tokens are stored per user in `x_accounts`, not in config.
- Uploaded files are stored per user on disk.

Going multi-user later is then: a real `getUser`, a signup page, and a product decision about who pays X (X bills the developer app, so every user's post would hit our card unless users pay us or bring their own X app keys). No data migration.
