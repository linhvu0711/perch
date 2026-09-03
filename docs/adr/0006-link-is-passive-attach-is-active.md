---
status: accepted
date: 2026-09-03
---

# Linking a resource to a post never changes what is sent to X; attaching does

A **link** is a reference: "this post was made from / belongs with that resource". It is the same passive relation for every resource type. Linking a Tweet Resource does **not** make the post a quote or a reply; linking an Image Resource does **not** put the image on the post. If quote/reply is wanted later it becomes its own explicit field (`--quote`, `--reply-to`), not a side effect of a link.

**Attach** is the active verb: it copies an image (from an Image Resource or a file) into the post's media list (max 4, 5 MB each, PNG/JPG/WebP/GIF). Attaching from a resource also links it for free. Linking never attaches.

Because media is a copy, deleting a resource is always allowed: it removes its links from every post, published or not, and reports which posts were unlinked. Posts never lose data. We chose this over "block delete while used" and over "archive instead of delete" to keep one simple rule.
