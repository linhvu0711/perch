# Perch v1 spec

Source of truth for what v1 builds. Tracking epic: https://github.com/vutuanlinh2k2/perch/issues/1

## Problem Statement

I collect ideas for X posts in many places: other people's tweets, screenshots and images, and my own Markdown notes. Turning those into posts and getting them out at a good time is manual and scattered. X has no scheduling of its own, and the X API charges per call, so a careless post with a link can cost more than ten times a plain one without me noticing. I also want an AI agent to do most of the grunt work (saving Resources, drafting Posts, scheduling), which means the tool must have a cheap, machine-friendly interface, not only a web page.

Today Perch is a design only: a glossary, eight ADRs, a CLI spec, a web UI spec, a clickable mockup, and X API research. No code exists.

## Solution

Build Perch v1: a single-user tool that keeps my Resources (Tweet Resources, Image Resources, Notes), lets me write Posts from them, shows an X-style preview with character count and estimated Cost, and Publishes Official Posts at their Schedule Time from one always-on server. Two thin clients share one HTTP API: a `perch` CLI (table output for me, JSON for agents) and a React web UI (Dashboard, Posts, Resources, Calendar, Settings). One X Account is connected at a time, through a server-side OAuth flow started from the web UI. Drafts are never sent, failures stop after three retries, every X API call is logged with its Cost, and nothing Perch does ever deletes or edits anything on X.

## User Stories

### Setup, login, and X Account

1. As a User, I want to run one server process that owns the database, the Scheduler, and all X access, so that Posts go out on time even when my laptop is asleep.
2. As a User, I want the server to serve the web UI and the API from the same process and port, so that I deploy and run exactly one thing.
3. As a User, I want to log in to the web UI with a single shared secret once and stay logged in via a cookie, so that nobody else can post from my account.
4. As a User, I want the CLI to authenticate with the same shared secret from an environment variable or a local config file, so that I and my agent can use it without a browser.
5. As a User, I want every request to resolve to a user through one function, so that opening Perch to other people later means rewriting only that function.
6. As a User, I want to connect my X Account by clicking "Connect X" in Settings and approving on X, so that the server holds the tokens and I never paste tokens anywhere.
7. As a User, I want the server to refresh the X access token on its own before it expires, so that scheduled Posts never fail because of a stale token.
8. As a User, I want Perch to read my X subscription type at connect time, so that my character limit (280 or 25,000) is set without me looking it up.
9. As a User, I want to override the character limit by hand in Settings or the CLI, so that I am not stuck if X reports it wrong.
10. As a User, I want to disconnect my X Account with a confirmation, so that the token is revoked at X and Perch stops acting as it.
11. As a User, I want connecting a second X Account to automatically disconnect the first, so that exactly one is connected at a time.
12. As a User, I want disconnected X Accounts kept on record, so that Published Posts always show which account sent them.
13. As a User, I want `perch auth login` to print and open the web login page rather than run its own OAuth, so that there is one X app and one login flow.
14. As a User, I want `perch auth status` and `perch account show` to tell me whether my token is valid and which X Account is connected, so that an agent can check before acting.
15. As a User, I want a time zone setting used everywhere for reading and displaying times, so that "9:00" means the same thing in the CLI, the web UI, and the Calendar.
16. As a User, I want all times stored as UTC, so that changing my time zone never corrupts Schedule Times.

### Resources

17. As a User, I want to save a Tweet Resource from an X URL, so that I keep the text of a post that inspired me.
18. As a User, I want Perch to reject an X post that has media, is an article, is a retweet, a reply, or a quote, and tell me which reason applied, so that I only save standalone text I can actually use.
19. As a User, I want long-form X posts (note tweets) saved in full, so that I do not lose the text past 280 characters.
20. As a User, I want saving a URL I already saved to return the existing Resource with no X call, so that I do not pay $0.005 twice or need to search for the id.
21. As a User, I want a `--refresh` option that re-fetches a saved tweet, so that I can update the text if the author edited it.
22. As a User, I want the author's username and post date stored with a Tweet Resource, so that I can filter by author and see when it was written.
23. As a User, I want to upload one or many image files as Image Resources, so that I have a library of pictures to attach to Posts.
24. As a User, I want images larger than 5 MB or in a format X does not accept (anything but PNG, JPG, WebP, GIF) rejected with a clear error, so that I find out before I attach them to a Post.
25. As a User, I want image width, height, size, and type recorded, so that I can see file facts in the Resource view.
26. As a User, I want to create a Note by uploading a Markdown file, piping from stdin, or writing directly in the web UI, so that my own writing lives next to my saved tweets.
27. As a User, I want a Note's title to default to its first heading, and an image's title to its file name, so that I rarely have to name things by hand.
28. As a User, I want to edit a Note's Markdown in the web UI with a Raw pane and a live Preview pane of equal width, so that I can see formatting as I write.
29. As a User, I want to edit a Note's body from the CLI with a file, stdin, or my `$EDITOR`, so that an agent or I can revise it without the browser.
30. As a User, I want to edit the title and private notes of any Resource type, so that I can annotate why I saved something.
31. As a User, I want the web UI to warn me before closing a Note editor with unsaved changes, so that I never lose a draft edit.
32. As a User, I want to list Resources filtered by type, Tag, tweet author, date-saved range, and free-text search, so that I can find the right source fast.
33. As a User, I want to sort Resources by newest, oldest, most used, and least used, so that I can find both fresh ideas and neglected ones.
34. As a User, I want to see how many Posts use each Resource and jump to those Posts, so that I know what has already been written from it.
35. As a User, I want to delete one or many Resources at once with a confirmation that lists the Posts that will be unlinked, so that I understand the effect before it happens.
36. As a User, I want deleting a Resource to remove its Links from every Post, Published ones included, while Posts keep their Media copies, so that Posts never lose data.
37. As a User, I want a "New draft from this" action on any Resource that creates an empty Draft Linked to it and copies its Tags, so that I can start writing in one click.
38. As a User, I want "New draft from this" on an Image Resource to also Attach the image, so that the picture is already on the Post.
39. As a User, I want a Resource detail view that renders each type well (X card for tweets, large image, rendered Markdown), so that I can read the source comfortably.
40. As a User, I want to open a tweet on X from its Resource view, so that I can see the original context.

### Posts: writing

41. As a User, I want to create a Post with optional text, title, Tags, Schedule Time, and Linked Resources in one command, so that an agent can draft in a single call.
42. As a User, I want a new Post to be a Draft by default, so that nothing I create is sendable until I say so.
43. As a User, I want an optional internal title on a Post that is shown in lists and on the Calendar but never sent to X, so that I can label Posts for myself.
44. As a User, I want lists to fall back to the first line of text when a Post has no title, so that untitled Posts are still recognizable.
45. As a User, I want to edit a Post's text from the CLI via text, file, stdin, or `$EDITOR`, so that revising is cheap for me and my agent.
46. As a User, I want the web editor to save changes as I type and on close, so that I never lose text.
47. As a User, I want to Link many Resources to a Post and unlink them again, in batch, so that I can record everything the Post came from.
48. As a User, I want Linking a Tweet Resource to be a pure reference, never a quote or reply, so that Linking has no side effects on X.
49. As a User, I want Linking an Image Resource to not put the image on the Post, so that I can keep a picture for reference without sending it.
50. As a User, I want to Attach up to four images to a Post from Image Resources or from files, so that my Post can carry pictures.
51. As a User, I want Attaching from an Image Resource to copy the file into the Post's Media and also Link the Resource, so that the Post survives if the Resource is deleted.
52. As a User, I want an Attach that would exceed four Media to fail with a clear error, so that I learn the limit before Publish time.
53. As a User, I want to Detach Media by position or all at once, so that I can rework the image set.
54. As a User, I want the web UI to confirm before removing an image that was uploaded straight to the Post, so that a file that exists nowhere else is not lost by accident.
55. As a User, I want no alt text anywhere in Perch, so that there is no hidden $0.005 per image.
56. As a User, I want a preview that mimics an X post card, with links and mentions in blue and a 1 to 4 image grid, so that I see what followers will see.
57. As a User, I want the preview to fold text past 280 weighted characters behind "Show more" like X does, so that I know how a long Post will appear in the feed.
58. As a User, I want a live weighted character count using X's rules (URLs count 23, some characters count 2), so that the count matches what X will enforce.
59. As a User, I want the count colored green, amber when empty, and red when over the limit, so that I notice problems at a glance.
60. As a User, I want an estimated Cost shown next to every Post: $0.015 plain, $0.200 if the text contains any http(s) URL, so that I never pay the link price by surprise.
61. As a User, I want mentions and hashtags to not count as URLs for Cost, so that the estimate is accurate.
62. As a User, I want a "Ready to publish?" checklist (text not empty, characters within limit, at most four images, X Account connected), so that I can fix every problem before Promoting.
63. As a User, I want `perch post preview` to print an ASCII rendering plus the character and Cost lines, so that an agent can check a Post without the web UI.
64. As a User, I want a full-size lightbox for any Attached image, so that I can inspect a picture properly.

### Posts: status and scheduling

65. As a User, I want to Promote a Draft to Official only when it passes validation (text not empty, characters within limit, at most four Media, Media files present), and to see every failing check at once, so that I fix everything in one round.
66. As a User, I want to Promote or Demote many Posts in one command, so that batch review is cheap.
67. As a User, I want to Demote an Official or Failed Post back to Draft, clearing any stored error, so that I can rework it safely.
68. As a User, I want to set a Schedule Time on a Draft or an Official Post, so that Drafts can sit on the Calendar as placeholders.
69. As a User, I want scheduling in the past to error unless I force it, so that I do not create instantly Missed Posts by mistake.
70. As a User, I want scheduling a Published Post to error, so that history is never rewritten.
71. As a User, I want to clear the Schedule Time of one or many Posts, so that I can pull something off the Calendar quickly.
72. As a User, I want `--at` to accept ISO, "YYYY-MM-DD HH:mm", and relative forms like `+2h` and `tomorrow 9am`, so that an agent and I can type times naturally.
73. As a User, I want a Draft whose Schedule Time passes to be skipped and flagged Missed, never sent, so that half-written text can never go live by a scheduling accident.
74. As a User, I want an Official Post whose Schedule Time passes while no X Account is connected to be flagged Missed, not Failed, so that I know nothing was attempted.
75. As a User, I want the Scheduler to Publish an Official, Scheduled Post at its Schedule Time, so that I do not have to be awake.
76. As a User, I want a failed send retried at +1, +5, and +15 minutes and then marked Failed with the error text kept, so that transient X errors self-heal but a Post never goes out hours late without me.
77. As a User, I want a Failed Post to never be retried automatically, so that I cannot double-post by surprise.
78. As a User, I want to retry a Failed Post by hand, now, so that I stay in control after a failure.
79. As a User, I want to Publish an Official Post now, ahead of or without a Schedule Time, so that I can send when the moment is right.
80. As a User, I want "Publish now" on a Draft to run the Promote checks, Promote, then send, so that a one-step send is possible but still validated.
81. As a User, I want the web UI to confirm before Publish and Retry and show the Cost in that dialog, so that the $0.200 link price is visible right before I pay it.
82. As a User, I want a Published Post to be read-only and to record the X post id, the X URL, the time, and the X Account that sent it, so that history is exact.
83. As a User, I want to open a Published Post on X, so that I can see replies and reactions.
84. As a User, I want Perch to never delete a Post on X, so that deleting locally is always safe.
85. As a User, I want to delete one or many Posts locally with a confirmation (or `--yes`), so that cleanup is quick but deliberate.
86. As a User, I want `--yes` to be required for destructive commands when there is no terminal, so that an agent must state destructive intent explicitly.

### Posts: finding and attention

87. As a User, I want to list Posts filtered by status, scheduled or unscheduled, Missed, Tag, search text, and date range, so that I can find any Post in one query.
88. As a User, I want `--from` and `--to` on Posts to filter on Schedule Time, or on Published time for Published Posts, so that date filters mean "when it goes or went out".
89. As a User, I want Posts sorted by time descending with untimed Posts last, so that the list reads like a timeline.
90. As a User, I want an "Issues" set made of Missed Posts and Failed Posts, so that I see everything that needs my hand in one place.
91. As a User, I want each needs-attention row to state its reason in plain words, so that I know whether to Promote, retry, or reschedule.
92. As a User, I want a dismiss action that clears the time of a Missed Post or Demotes a Failed Post to Draft, so that acknowledged items leave the list without a new "dismissed" flag and without deleting anything.
93. As a User, I want the Post modal to show an amber banner when the Post is Missed or due soon and a red banner with the error and try count when Failed, so that the problem is visible while I edit.
94. As a User, I want `perch status` to print the connected account, the next 5 due Posts, Missed and Failed counts, and this month's Cost in one screen, so that an agent can orient itself in one call.

### Tags

95. As a User, I want one shared set of free-text Tags for Resources and Posts, so that creating a Post from a Resource can copy its Tags.
96. As a User, I want to add and remove Tags on many Resources or Posts in one command, so that organizing is cheap.
97. As a User, I want a Tag picker in the web UI with search, existing Tags, and a "Create …" line, so that I can make a Tag where I need it.
98. As a User, I want a Tags table in Settings that shows each Tag's Resource count and Post count, with a slim row to create a new Tag, so that I can manage the whole set in one place.
99. As a User, I want to rename a Tag everywhere at once, so that fixing a typo is one action.
100. As a User, I want to delete Tags with a confirmation, removing them from everything, so that the set stays clean.
101. As a User, I want to filter Posts, Resources, and the Calendar by Tag, so that I can look at one topic at a time.

### Calendar

102. As a User, I want a month view and a week view, Monday first, with previous, next, and Today controls, so that I can see my schedule the way I plan it.
103. As a User, I want each Calendar event to show a status-colored dot, the time in monospace, and the title or first line, so that status is readable at a glance.
104. As a User, I want at most 3 events per day cell in month view and a "+N more" that jumps to that week, so that busy days stay readable.
105. As a User, I want past days grayed and today highlighted, so that the present is obvious.
106. As a User, I want clicking a Calendar event to open the Post modal on top of the Calendar, so that I do not lose my place.
107. As a User, I want only the visible month or week fetched, so that the Calendar stays fast as history grows.
108. As a User, I want `perch calendar` to print Posts by day for a week or a month with marks for Missed and Failed, so that an agent can review the schedule.

### Cost

109. As a User, I want every X API call recorded with its endpoint, Cost, time, and the Post, Resource, or X Account it was for, so that my spend is auditable.
110. As a User, I want `perch cost` to show this month's total split by kind (Publish, save tweet, connect), with a month option, so that I can check the bill from the CLI.
111. As a User, I want a Cost-by-month table at the bottom of the Dashboard, 6 rows per page, newest first, with the all-time total, so that I can watch spend over time.
112. As a User, I want the Save tweets dialog to show the Cost per URL and that duplicates are free, so that batch saving has no surprise price.
113. As a User, I want the Connect X flow to note its $0.010 Cost, so that even one-time actions are transparent.

### Web UI shell and behavior

114. As a User, I want five pages, Dashboard, Posts, Resources, Calendar, and Settings, in a left sidebar with Post and Resource counts, so that the app is small and navigable.
115. As a User, I want the sidebar to collapse to icons, expand when I click anywhere on it, and remember its state, so that I can reclaim space on a small screen.
116. As a User, I want the sidebar footer to show my connected X Account (handle, plan, character limit) or "No X account", so that I always know which account will send.
117. As a User, I want a light, dark, and system theme switch in Settings, so that Perch matches my desktop.
118. As a User, I want a quiet, Linear-like look: cool grays, indigo accent, X blue for Official, Inter for text and JetBrains Mono for ids, times, counts, and Cost, so that the app is calm to use every day.
119. As a User, I want icon-only buttons wherever the icon is clear, each with a custom tooltip on hover and keyboard focus, so that the screen has few words but nothing is a mystery.
120. As a User, I want no two side-by-side buttons to share an icon, so that icons stay unambiguous.
121. As a User, I want destructive actions colored red, so that I never confuse delete with save.
122. As a User, I want a toast after every action, so that I know it happened.
123. As a User, I want the Post and Resource modals to have URLs that survive refresh and browser back, so that `perch open post 3` can deep-link to them.
124. As a User, I want the Post modal in two columns, editor left and X-style preview right, with a Resources drawer that slides over the preview, so that I can browse sources while writing.
125. As a User, I want the drawer to have search, type filters, a list with attach, insert-text, and link/unlink actions, and an "Upload from computer" row, so that adding to a Post is one gesture.
126. As a User, I want clicking a Linked Resource or a drawer item to open its detail on the side of the same modal, with a back arrow and an "open full resource" icon, so that I never leave the Post I am writing.
127. As a User, I want a Dashboard with a greeting and current time in my zone, four stat cards (next Official Post, issues, scheduled next 7 days, Cost this month), the next 3 days of Posts, and the Issues list with no cap, so that I see what needs me the moment I open the app.
128. As a User, I want a banner on the Dashboard when no X Account is connected, so that I cannot forget before a Scheduled Post goes Missed.
129. As a User, I want Posts, Resources, and the drawer to load in batches with "load more" on scroll and a "8 of 14 posts" count line, so that long lists never block the page.
130. As a User, I want dropdowns for Tags and authors to load everything and filter as I type, so that small lists feel instant.
131. As a User, I want a custom date-time picker that shows my configured time zone beside it, so that scheduling is precise and consistent across browsers.
132. As a User, I want thin, rounded, theme-colored scrollbars, so that the UI looks finished.
133. As a User, I want a Sign out action and a one-field login screen, so that I can lock and unlock the web UI.
134. As a User, I want empty states when a filter finds nothing, so that "nothing here" is never mistaken for a loading bug.

### CLI and agents

135. As an AI agent, I want every CLI command to print JSON when stdout is not a terminal and tables when it is, with `--json` and `--table` to force either, so that I parse output reliably and the User reads it comfortably.
136. As an AI agent, I want errors on stderr with a non-zero exit code and a JSON error object in JSON mode, so that failures are unmistakable.
137. As an AI agent, I want batch commands to return one result per item with per-item errors and to keep going after a bad item, so that one bad id does not waste the whole call.
138. As an AI agent, I want plain integer ids per table, so that ids are cheap in tokens and easy to quote back.
139. As an AI agent, I want `--limit` and an opaque `--cursor` on list commands with `next_cursor` in the JSON output, so that I can page through large lists without offsets that shift.
140. As an AI agent, I want `perch open post <id>` and `perch open resource <id>` to print and open the web URL, so that I can hand a Post to the User for review.
141. As a User, I want `perch config get|set` for server-url, token, timezone, and char-limit, so that setup is scriptable.
142. As a User, I want the CLI built as a single binary, so that installing it is copying one file.
148. As an AI agent, I want to pull every Resource into a Mirror of local Markdown files, so that I can read them with file tools.
149. As an AI agent, I want nothing written to the Mirror when the download fails, so that a bad server never corrupts my copy.
150. As an AI agent, I want `perch status` to show the Mirror path and last pull time, so that I know where to read and how fresh it is.

### Operations

143. As a User, I want the server to run on Railway from the GitHub repo with a persistent volume, so that deploys are a push.
144. As a User, I want the same server to run locally with one command against a local SQLite file, so that development needs no emulator.
145. As a User, I want the SQLite database streamed continuously to a Cloudflare R2 bucket with Litestream and uploaded images copied to the same bucket on upload, so that a lost volume does not mean lost Notes or re-paid tweet fetches.
146. As a User, I want every table to carry a user id and every query to filter by it from day one, so that going multi-user later is a login change, not a data migration.
147. As a User, I want the Posts table shaped with a parent post id and position, so that threads can be added later without a rewrite.

## Implementation Decisions

All decisions below come from the design session and are recorded in the ADRs and the design log. This spec is the build order for them.

**Repository and stack**
- The monorepo layout, the stack, and what `packages/core` holds are in `CODING_STANDARDS.md`. The deploy shape is below.
- Deploy: Railway service with a volume, deploying from the GitHub repo on push. Litestream sidecar streams the database to Cloudflare R2; images are copied to the same bucket after upload. Environment holds the shared secret, the X client id and secret, the public host, and the R2 credentials.

**Domain model (tables)**
- users: id, created at. One seeded row.
- x_accounts: id, user id, X user id, username, subscription type, access token, refresh token, expires at, connected at, disconnected at.
- resources: id, user id, type (tweet, image, md), title, notes, created at; tweet fields (url, X id, author id, author username, text, posted at); image fields (path, mime, bytes, width, height); md body.
- posts: id, user id, status (draft, official, published, failed), title, text, scheduled at, published at, X account id, X post id, last error, retry count, parent post id, position, created at, updated at.
- post_media: id, post id, position 1 to 4, path, mime, bytes, from resource id.
- post_links: post id, resource id.
- tags: id, user id, name (unique per user). resource_tags and post_tags join tables.
- api_calls: id, user id, endpoint, cost in USD, post id, resource id, X account id, created at.
- settings: user id, timezone, character limit override.
- Missed is derived, not stored: a Post with a Schedule Time in the past whose status is Draft, or whose X Account was disconnected at that time. Needs attention is also derived.
- Uploaded files live on disk under a per-user directory on the volume; the database stores the path.

**Authentication**
- One shared secret. The web UI posts it once and receives a cookie; the CLI sends it as a bearer header. A single `getUser(request)`-style function resolves either to user 1 and is the only place multi-user would change.
- X OAuth 2.0 with PKCE, "Web App" confidential client, callback at `/auth/x/callback` on the public host, scopes tweet.read, tweet.write, users.read, media.write, offline.access. The server exchanges the code, reads the user's subscription type, stores tokens on an x_accounts row, and refreshes them before expiry, persisting a rotated refresh token atomically and falling back to "reconnect required" on invalid grant.
- Connect creates a new row or updates tokens if the same X user reconnects; any other connected row is disconnected first. Disconnect revokes at X and sets disconnected at.
- Character limit: 25,000 if subscription type is Premium or PremiumPlus, else 280; the settings override wins when set.

**API contract (shape, not paths)**
- Resources: create tweet (batch of URLs, optional tags, refresh flag), create image (multipart, batch), create note (title, body, tags), list (type, tags, author, from, to, search, sort, order, limit, cursor), get, update (title, notes, body for notes), tag add/remove (batch), delete (batch; response lists unlinked posts per resource).
- Posts: create (title, text, from resource ids, tags, at, official flag), list (status, scheduled/unscheduled, missed, needs-attention, tags, search, from, to, limit, cursor), get (includes character count, limit, estimated cost, links, media, X URL), preview text, update (title, text), promote/demote (batch), schedule (at, force), unschedule (batch), link/unlink (batch), attach (resource ids and multipart files), detach (positions or all), tag add/remove (batch), publish, retry, delete (batch).
- Tags: list with counts, create, rename, delete (batch).
- Calendar: range query (from, to, tags) returning posts grouped by day.
- Cost: month summary split by kind, and per-month history with paging.
- Status: account, next 5 due posts, missed count, failed count, month cost.
- Account and auth: status, connect start, callback, disconnect, settings get/set.
- Every list response carries `next_cursor` when more rows exist. Cursors encode the sort key plus id and are opaque to clients.
- Batch endpoints return one result per input item, each either a value or an error, with HTTP 200 for a partially successful batch; a batch where every item failed still returns per-item errors.
- Errors are a JSON object with a stable code and a message. Validation errors list every failing check.

**Post rules**
- New Posts are Drafts. Promote validates: text not empty, weighted characters within the limit, at most four Media, every Media file present on disk. All failures are returned together.
- Publish on a Draft runs Promote first. Publish and Retry require a connected X Account. Publish uploads Media to X (free), then creates the post, then stores X post id, published at, and X account id, clears the Schedule Time, and logs the api_calls row with the estimated Cost ($0.015, or $0.200 when the text contains an http(s) URL).
- Demote works on Official and Failed Posts and clears last error and retry count.
- Published Posts reject every mutation except local delete.
- Scheduling in the past requires a force flag. Scheduling a Published Post is an error.
- Attach from a Resource copies the file into the Post's media directory and adds a Link. Attach from a file stores the upload as Media only. Total Media may not exceed four. No alt text exists anywhere.
- Deleting a Resource deletes its Links from all Posts (Published included) and reports the affected Post ids. Media copies are untouched.
- Dismiss is not a state. It is unschedule (for Missed Posts) or demote (for Failed Posts). This rule came out of the mockup prototype; the decision-bearing part is:

  ```
  needsAttention(post, now) =
    missed(post, now) || post.status == failed
  dismiss(post) = status failed ? demote(post) : unschedule(post)
  ```

**Scheduler**
- A loop in the server process ticks every 30 seconds. Each tick, with an injected clock, it selects Posts whose Schedule Time is due: Drafts and Posts with no connected X Account are left as is (they read as Missed); Official Posts are Published. A failed attempt schedules retries at +1, +5, and +15 minutes from the original time by recording the retry count and next attempt; after the third retry the Post becomes Failed with the error text kept and the Schedule Time kept.
- The tick is idempotent: a Post is claimed before sending so a slow tick and the next tick cannot double-post. A Published Post is never touched again.
- The Scheduler's tick is a plain function the tests call with a fixed "now"; the timer only calls it.

**X client**
- One internal interface with the five calls Perch makes: get tweet by id (with the fields needed to detect media, article, note tweet, referenced tweets, and author), get me (with subscription type), upload media, create post, revoke token, plus the OAuth exchange and refresh. The real implementation is raw `fetch` behind that interface (ADR-0010). Tests substitute a fake that records calls and returns canned results.
- Every real call writes an api_calls row with the price from the Cost table in the design log. Duplicate tweet saves make no call and log nothing.

**CLI conventions**
- Output is a table on a TTY and JSON otherwise; `--json` and `--table` force it. Errors go to stderr with a non-zero exit and a JSON object in JSON mode. Destructive commands prompt on a TTY and require `--yes` without one.
- Text input via `--text`, `--file`, or `-` for stdin; `-e` opens `$EDITOR` on a TTY. Time input accepts ISO, "YYYY-MM-DD HH:mm", and relative forms, interpreted in the configured time zone.
- Configuration in a dotfile under the home directory and environment variables for server URL and token; `--server` overrides.
- The full command tree and per-command rules are the CLI spec in the repo docs; it is the contract, not this list.

**Web UI**
- The web UI spec and the clickable mockup in the repo docs are the contract for pages, layout, colors, icons, confirmations, tooltips, paging sizes (posts 50, resources 30, drawer 20), Calendar caps, and the custom date-time picker. Where the spec and the mockup disagree, the spec wins.
- Modals are routes rendered over their list page. Theme is three CSS token sets (light, dark, system).

## Testing Decisions

- How a test is written, the seam, and the hermetic rules are in `CODING_STANDARDS.md` under "Tests". The list below is what must be covered.

**What gets tested**
- Auth: no secret is rejected; cookie and bearer both resolve to user 1.
- Resources: tweet save accepts standalone text (including note tweets), rejects each of the five reasons with the reason named, returns the existing row for a duplicate URL with no X call, re-fetches with refresh; image upload validates size and type and records dimensions; notes default their title from the first heading; list filters, sorts, search, and cursor paging return stable pages when rows are inserted mid-walk; delete reports unlinked posts and leaves Media copies in place.
- Posts: create defaults to Draft and copies tags from linked resources; promote returns every failing check; demote clears errors; schedule rejects past times without force and rejects Published Posts; link and attach honor the four-Media cap and the copy-and-link rule; publish on a Draft promotes first, uploads media, creates the post, stores the X ids, clears the time, and logs the Cost with the URL price when a link is present; Published Posts reject edits; delete never calls X.
- Scheduler: at a due time a Draft is left and reads as Missed; an Official Post is Published; a disconnected account leaves it Missed; failures retry at +1, +5, +15 and then become Failed with the error; a Failed Post is never retried by the tick; a Post claimed by one tick is not sent by a second tick; retry by hand sends once.
- Issues and dismiss: the two groups appear with their reasons; dismiss unschedules or demotes and the row disappears; nothing is deleted.
- Tags: shared across types, rename applies everywhere, delete removes from everything, counts are correct.
- Calendar and cost: range query groups by day in the configured time zone; month summaries match the api_calls rows.
- X Account: connect stores tokens and subscription type and sets the limit; a second connect disconnects the first; refresh persists a rotated token; disconnect revokes and keeps the row; Published Posts keep their account after disconnect.
- Core package: weighted character counting (URLs 23, wide characters 2, limit boundaries), Cost estimation (mentions and hashtags are not URLs), time parsing in a time zone, needs-attention window edges.

## Out of Scope

- Threads (multi-tweet Posts), even though the schema leaves room.
- A queue or posting slots; a Post has a Schedule Time or none.
- Quote or reply semantics when Linking a Tweet Resource.
- Alt text on Media.
- Deleting or editing anything on X.
- Multiple connected X Accounts at once.
- Multi-user: signup, sessions, per-user API keys, billing, or deciding who pays X.
- Drag-and-drop rescheduling on the Calendar.
- Tweet Resources with media, articles, retweets, replies, or quotes.
- Mobile layout beyond what the responsive shell gives for free.
- Postgres; SQLite is the only database in v1.
- Restoring from Litestream is an operational runbook, not a feature of the app.

## Further Notes

- Vocabulary is fixed by the glossary in the repo: Resource, Tweet Resource, Image Resource, Note, Tag, Post, Draft, Official, Published, Failed, Scheduled, Missed, Publish, Promote, Demote, Link, Media, Attach, Detach, Scheduler, Schedule Time, Cost. Code, API fields, and UI copy use these words and not the "avoid" alternatives.
- The repo docs are the detailed contracts: the CLI spec for every command and flag, the web UI spec and mockup for every screen, the design log for the full decision table, the X API research for endpoints, fields, prices, and limits, the ADRs for the constraints that must not be broken, and `CODING_STANDARDS.md` for how code is written.
- X prices assumed: save a tweet $0.005, publish $0.015, publish with a URL $0.200, connect $0.010, media upload free. They are configuration, not constants, so a price change is a one-line edit.
- Suggested build order: core package (schemas, counting, Cost, time parsing); server database and auth; Resources API; Posts API with validation; X client and OAuth; publish and Scheduler; Tags, Calendar, Cost, Status; CLI; web UI shell and pages; Railway and Litestream deployment.
- After this spec is accepted, split it into build tickets by the order above so each ticket is one seam-tested slice.
