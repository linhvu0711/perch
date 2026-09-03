---
status: accepted
date: 2026-09-03
---

# A scheduled Draft is never sent; only Official posts go out, and failures stop after three retries

A post can be a Draft and still have a schedule time (it shows on the calendar as a placeholder). When that time arrives the scheduler skips it and marks it **missed**; the user must promote it and, if the time is past, pick a new time. "Draft" means "not safe to send", so a half-written post can never go live by a scheduling accident.

For an Official post, the scheduler tries at the schedule time, then again at +1, +5, and +15 minutes. After that the post becomes **failed**, keeps the error text and the schedule time, and is never retried automatically. The user runs `perch post retry <id>`. This bounds how late a post can silently go out and rules out surprise double-posts.

A scheduled post whose X account is disconnected is also skipped and marked missed. Nothing was attempted, so it is not a failure.

Published posts are read-only.
