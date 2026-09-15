# Perch web UI

Spec for the React SPA. The clickable mockup is `docs/ui/perch-ui.html` (open it in a browser; all data is fake and in memory). Where this file and the mockup disagree, this file wins. Vocabulary is in `CONTEXT.md`, decisions in `docs/design.md`.

## Look

- **Vibe**: quiet tool. Linear-like. Lots of space, small type (14 px), few words on screen. Color only where it means something.
- **Theme**: light / dark / system. Tokens in the mockup's `:root`. Grays have a cool tint. Accent is Linear indigo (`#5e6ad2` light, `#7b83eb` dark). "Official" status uses X blue (`#1d9bf0`).
- **Fonts**: Inter for UI, JetBrains Mono for IDs, times, counts, cost.
- **Status colors** (pill + dot): draft gray, official X blue, published green, failed red, missed amber. Semantic colors are never used as accent.
- **Icons**: Lucide. Perch logo is a feather (same as the favicon). Tweet = bird.

## Rules that apply everywhere

- **Icon-only buttons.** If an icon is clear on its own, no text. Every icon button, tab, and dropdown trigger has a tooltip (custom, ~350 ms, also on keyboard focus). Text stays on: status tabs' tooltips, Month/Week, Today, form submit buttons, confirm dialogs. No tooltips on sidebar items unless the sidebar is collapsed.
- **No repeated icons in one view.** Two buttons side by side never share an icon.
- **Destructive = red.** Delete, disconnect, discard, remove (on hover for small x buttons).
- **Confirm before**: publish or retry (shows cost), delete post, delete resource (lists posts it unlinks), delete tag, disconnect X, remove an image uploaded straight to a post (not a resource), close or cancel a note editor with unsaved changes. No confirm for reversible things: unlink, detach a resource image, remove a tag from an item, clear a time, dismiss.
- **Toast after every action.**
- **Big lists** load in batches with "load more" on scroll: posts 50, resources 30, drawer 20. Filters, sort, and search run on the server (see paging in `docs/cli.md`). A count line under the list: "8 of 14 posts".
- **Modals have URLs**: `/posts/:id`, `/resources/:id` render on top of the list. Refresh and back keep them open. `perch open post 3` links here.
- **Date-time picker**: custom component, not the browser's native input. Shows the configured time zone next to it.
- **Scrollbars**: thin, rounded, theme colored.

## Shell

- Left sidebar, 224 px, collapsible to 64 px (icons only). Collapse button next to the logo; when collapsed, clicking anywhere on the sidebar expands it, nav icons still navigate. State remembered.
- Sidebar: logo, nav (Dashboard, Posts with count, Resources with count, Calendar, Settings), account block at the bottom (@handle, plan, char limit; or "No X account · Connect in Settings").
- Content area centered, max width 1280 px, equal padding left and right.

## Pages

### Dashboard `/`

Greeting + date/time in the configured zone. Banner if no X account is connected.

Four stat cards: next official post · issues (count, amber if > 0) · scheduled next 7 days · cost this month.

**Issues** = missed posts + failed posts (drafts due soon are not Issues). Shown after Next 3 days. Each row: date/time, title or first line, reason in gray, status pill, and a **dismiss** (check icon). Dismiss clears the time (missed) or demotes to draft (failed). Never deletes. No cap, no "See all".

**Next 3 days**: every post with a time until end of day +3.

**Cost by month**: table, 6 rows per page, newest first, all-time total in the pager row, cost rule line under it.

### Posts `/posts`

Header: title, `+` new post. Filters: status tabs as icons (all, drafts, official, published, needs attention; active icon takes the status color), scheduled filter as 3 icons (any, scheduled, unscheduled), tag dropdown, search. Rows: date/time (mono), **title** bold + first line of text muted, image count, tags, status pill. Sorted by time desc, untimed at the end.

### Post modal

Two columns.

Left (editor): title input (internal only), text area, images (4 slots; filled slot = click to view full size, x to remove; empty slot = opens drawer on Images), schedule (picker + zone + clear), tags (chips + "add" → tag picker with search and "Create …"), linked resources (label row has the browse button on the right; each item opens the resource **on the side** in the drawer; x = unlink).

Right (preview): X-style card (name, @handle, time, text with links/mentions blue, image grid 1–4, date line). Text over 280 weighted chars folds behind **Show more** like X. Three metrics: characters (green / amber if 0 / red if over limit), estimated cost ($0.015, $0.200 with a link, amber), publish as. "Ready to publish?" checklist: text not empty, chars ≤ limit, ≤ 4 images, X account connected. Cost rule note.

Header by status:

| status | banner | actions |
|---|---|---|
| draft | amber if missed or due soon | delete · promote (↑) · publish now (→) |
| official | — | delete · demote (↓) · publish now (→) |
| failed | red with error + tries | delete · demote (↓) · retry (⟳) |
| published | info: read-only | delete · open on X |

Publish now on a draft = promote (same checks) + send. Confirm dialog shows the cost. Edits save on change; closing saves text.

**Drawer** (slides over the preview, 50 % of modal): search, type filter icons, list of resources (thumbnail/icon, title, snippet, actions: attach 📎 or insert text, link/unlink). "Upload from computer" row at the top attaches without making a resource. Click a thumbnail or title → **detail view** in the drawer: full tweet card / big image (click = lightbox) / rendered note, tags, private note, footer with link state and actions, back arrow, "open full resource" icon.

### Resources `/resources`

Header: title, save tweet (bookmark-plus), upload image, new note (primary). Filters: type icons (all, bird, image, note), tag, author (tweets only), sort (newest, oldest, most used, least used), search. Card grid, 3 columns: type chip, author for tweets, date; body = tweet text / note excerpt / image thumbnail + file name; tags; "used in N posts" or size.

**Save tweets** modal: URLs one per line, tags, cost line ($0.005 each, dupes free), per-URL result (saved / already saved #id / rejected with reason).

**Upload images** modal: drop zone, file list with size check (> 5 MB shown red), tags.

### Resource modal

Header: id, type, title (editable for notes while editing), actions. Left: content. Right panel: details (author/posted, file/size/pixels/type, words/edited, saved), tags, private notes, "used in N posts" (click → post modal).

- Tweet: X card, "Open on X", refresh (confirm, $0.005), new draft from this, delete.
- Image: large preview, new draft from this (attaches the image), delete.
- Note: rendered Markdown. **Edit** → two equal panes labeled **Raw** and **Preview**, live. Save (✓) / discard (↶, red, confirms if dirty). New note opens directly in edit mode. Title follows the first `#` heading.

### Calendar `/calendar`

Month and week. Monday first. Prev/next move by month or week. Today button. Legend. Day cells: number, up to 3 events (dot in status color, time mono, title or first line), then "+N more" which opens that week. Past days have a gray background and dimmed events. Today is highlighted. Only the visible range is fetched.

### Settings `/settings`

Two columns. Left: X account (connected: handle, plan, chars, since, red Disconnect; not connected: Connect X, notes the $0.010), time zone, character limit override, theme (3 icons), CLI token (eye to reveal). Right: **Tags** — slim "new tag" row on top of the table, then name, resource count, post count, rename / delete icons on hover.

Sign out (icon, top right) shows the login screen: one token field.

## Not in v1

Threads, queue/slots, alt text, delete on X, multiple accounts, drag-and-drop on the calendar.
