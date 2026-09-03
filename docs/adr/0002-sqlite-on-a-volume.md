---
status: accepted
date: 2026-09-03
---

# SQLite on a persistent volume, through Drizzle ORM

One user, one server process, a few thousand rows. SQLite via `bun:sqlite` gives zero ops, the same engine locally and in production, and backup by copying one file. Postgres would add a paid service that must stay up for the scheduler to work, plus a local Postgres just to develop.

We go through Drizzle so the schema and queries survive a later move to Postgres as a driver change. The known ceiling: SQLite is one machine only. If Perch ever runs on more than one server or serves hundreds of users, switch to Postgres then.

Uploaded images live on the same volume under `/data/users/<user_id>/…`, path stored in the DB. Note (Markdown) bodies live in the DB as text.

Backup: Litestream runs beside the server and streams the SQLite WAL to a Cloudflare R2 bucket (point-in-time restore). Uploaded images are copied to the same bucket right after upload. Railway volumes have no built-in backups, and re-fetching saved tweets costs money, so a nightly file copy (up to one day lost) was rejected.
