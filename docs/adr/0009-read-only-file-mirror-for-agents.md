---
status: accepted
date: 2026-09-12
---

# Resources are mirrored to local Markdown files for AI agents; SQLite stays the truth

The main consumer of saved Resources is an AI agent running on the User's machine, and agent tools work on files (grep, ls, semantic file search), not on a remote SQLite database. So the CLI gets `perch resource pull`, which copies every Resource from the server into a read-only Mirror at `~/.perch/resources/` as one Markdown file per Resource (YAML front matter for the fields, body for the text), plus the image files. The server keeps SQLite as the only source of truth (ADR-0002) and stays on Railway (ADR-0001). Finding and ranking Resources is the agent's job, done over the Mirror with its own tools.

## Considered options

- **Search inside the server (FTS5, embeddings).** Rejected: the agent already carries its own search tools, and every server-side search means a CLI call whose output lands in the agent's context. Files let the agent filter before anything is read.
- **Files as the truth, on the server or on the Mac.** Rejected: the web UI, the Scheduler, and the Railway volume all rest on SQLite. Ripping that out so one agent can grep is a lot of rewrite for a small win.
- **Two-way sync (edit the Mirror, push up).** Rejected: the moment two sides can write, you need conflict rules and change tracking. The CLI already edits Resources, so writes stay there.
- **Incremental pull.** Rejected for now. It needs an `updated_at` column and a delete log, and a full copy of a few thousand rows costs almost nothing.

## Consequences

- The Mirror is read only. Editing a file there does nothing; Pull overwrites it.
- Pull is manual. An agent runs it first, and again after its own writes if it needs to read them.
- Pull downloads the full export before writing, deletes only paths listed in its Manifest, and on any failure touches nothing and exits non-zero.
- One new server route, `GET /api/resources/export` (JSON lines), and one to serve an image file by Resource id once Image Resources exist.
