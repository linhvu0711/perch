# Perch

A single-user tool to collect ideas, write X (Twitter) posts from them, and send those posts at a chosen time. One X account is connected at a time.

## Language

### People and accounts

**User**:
The person who owns the resources and posts in Perch. Today there is exactly one.
_Avoid_: Account, owner, member

**X Account**:
An X (Twitter) account that the User has connected to Perch, with the tokens Perch uses to act as it. At most one is connected at a time; older ones stay on record as disconnected.
_Avoid_: Twitter account, profile, handle (the handle is a property of it)

### Resources

**Resource**:
A saved piece of source material the User may write a Post from. It is always one of the types below and belongs to the User, never to an X Account.
_Avoid_: Idea, asset, source, item, reference

**Tweet Resource**:
A Resource holding the text of someone else's standalone, text-only X post, fetched from its URL. Posts with media, articles, retweets, replies, and quotes are not accepted.
_Avoid_: Saved tweet, bookmark, imported post

**Image Resource**:
A Resource holding one image file uploaded from the User's machine.
_Avoid_: Picture, photo, media (media is what is on a Post)

**Note**:
A Resource holding Markdown text that the User wrote or uploaded and can edit in Perch.
_Avoid_: Md file, markdown resource, doc, document

**Tag**:
A free-text label the User puts on Resources and Posts to group and filter them. One shared set of Tags serves both.
_Avoid_: Label, category, topic

### Mirror

**Mirror**:
A read-only copy of every Resource as files on the User's machine, one Markdown file per Resource with front matter, so an outside AI agent can read them with file tools. The server's database stays the truth.
_Avoid_: Cache, export folder, local copy, sync folder

**Pull**:
The CLI command that refreshes the Mirror from the server in one full copy. Nothing ever goes the other way.
_Avoid_: Sync, fetch, download, refresh

**Manifest**:
The file inside the Mirror that lists every path Pull wrote, so Pull deletes only its own files.
_Avoid_: Index, lock file, state file

### Posts

**Post**:
A single X post the User intends to send from the connected X Account. It holds text, up to four Media, Links to Resources, an optional schedule time, and a status.
_Avoid_: Tweet (that is what it becomes on X), entry, item

**Draft**:
A Post status meaning "not ready to send". A Draft can have a schedule time, but Perch never sends it.
_Avoid_: Unpublished, pending, WIP

**Official**:
A Post status meaning "ready to send". Only an Official Post is sent by the Scheduler or by an explicit publish.
_Avoid_: Approved, final, ready, live

**Published**:
A Post status meaning it has been sent to X. A Published Post is read-only and records which X Account sent it.
_Avoid_: Sent, posted, live

**Failed**:
A Post status meaning Perch tried to send it and gave up after its retries. The error is kept. The User must retry it by hand.
_Avoid_: Errored, broken, stuck

**Scheduled**:
A Post that has a schedule time in the future. Being Scheduled is independent of being Draft or Official.
_Avoid_: Queued, planned, timed

**Unscheduled**:
A Draft or Official Post with no schedule time in the future (no time, or a time already past). Published and Failed Posts are neither Scheduled nor Unscheduled; the distinction only applies to Posts still waiting to be sent.
_Avoid_: Undated, untimed, backlog

**Missed**:
A Post whose schedule time has passed while it was still a Draft (or its X Account was disconnected), so it was skipped. It is not Failed; nothing was attempted.
_Avoid_: Overdue, late, expired, blocked

**Issues**:
The set of Posts that were meant to go out but did not: Missed Posts and Failed Posts. Derived, never stored. Shown only on the Dashboard, with no cap.
_Avoid_: Needs attention, inbox, alerts, todo

**Dismiss**:
Taking a Post out of Issues without deleting it: clear the time of a Missed Post, or Demote a Failed Post to Draft and clear its time. There is no dismissed flag.
_Avoid_: Snooze, archive, acknowledge

**Publish**:
The act of sending an Official Post to X, either by the Scheduler at its schedule time or by the User right now.
_Avoid_: Post (verb), send, tweet (verb), push

**Promote / Demote**:
Changing a Post from Draft to Official (promote) or back (demote). Promote checks the Post is valid to send.
_Avoid_: Approve, finalize, unapprove

### Relations between Posts and Resources

**Link**:
A passive relation saying a Post was made from, or belongs with, a Resource. A Link never changes what is sent to X. A Post may Link many Resources.
_Avoid_: Reference, attachment, source, relation

**Media**:
An image that will be sent to X as part of a Post, copied in from an Image Resource or a file. A Post holds at most four. Media has no alt text.
_Avoid_: Image (that is the Resource), photo, upload

**Attach / Detach**:
Adding Media to a Post (attach) or removing it (detach). Attaching from an Image Resource also Links it; Linking never attaches.
_Avoid_: Add image, upload, embed

### Time and money

**Scheduler**:
The part of the server that watches the clock and Publishes each Official, Scheduled Post at its schedule time.
_Avoid_: Cron, worker, queue, job runner

**Schedule Time**:
The single moment a Post is meant to go out, entered and shown in the User's configured time zone.
_Avoid_: Publish date, due date, slot, send time

**Cost**:
The money X charges Perch for one call to the X API, estimated before a Publish and recorded after every call.
_Avoid_: Price, fee, credits, spend (spend is a total of Costs)
