---
status: accepted
date: 2026-09-03
---

# Perch never deletes on X, never sets alt text, and only reads standalone text tweets

Explicit no-s, each chosen to keep the API surface and the bill small:

- **No delete on X.** `perch post delete` removes the local record only. Deleting a live tweet is done on X itself. (X bills deletes at ~$0.010 under "Interaction: Delete"; we simply do not call it.)
- **No alt text on media.** The `POST /2/media/metadata` call costs $0.005 per image and was judged not worth it. There is no `--alt` flag anywhere.
- **Tweet Resources accept only standalone, text-only posts.** Rejected with a reason: has media, is an article, is a retweet, is a reply, is a quote. Long-form text (`note_tweet`) is accepted and saved in full. Saving a URL already saved returns the existing resource without calling X; `--refresh` forces a re-fetch.
- **No threads in v1.** One post = one tweet. The `posts` table is shaped so a thread later is `parent_post_id` + `position`.
- **No queue / slots in v1.** A post has a schedule time or none. `--next-slot` style queueing may come later.
- **One connected X account at a time.**
