---
name: perch-fake-x-ui-walkthrough
description: Run Perch UI walkthroughs locally with fake X, capture transient toasts, and preserve real-speed video evidence.
---

# Perch fake-X UI testing

## Devin Secrets Needed
None for fake X. Set a disposable `PERCH_TOKEN` and use it on the login screen. Real X testing is separate and requires the application's configured OAuth credentials.

## Local setup
- Ensure Bun is available; this environment has `~/.bun/bin/bun`.
- From the repo root, install dependencies if needed and build the web app; the fake server serves `apps/web/dist`, not a live frontend dev bundle.
- Start `PERCH_TOKEN=<disposable-token> bun apps/server/scripts/devFake.ts`.
- Open `http://127.0.0.1:3000`, enter the configured token, and press Enter. Keep this origin consistent through the test; the fake OAuth callback always returns to 127.0.0.1, so testing on another origin loses authentication.
- Every server process creates a fresh temporary SQLite DB. Restarting is a clean-state reset, and may require reauthentication.
- Verify the listening process actually stopped before restarting: a terminated shell wrapper can leave its child alive. Send SIGTERM to the verified server PID if needed.
- Stop the process after testing; confirm port 3000 is no longer listening.

## Account scenarios
- Sidebar Settings → Connect X → Continue to X uses a local fake authorization redirect, exercising the application callback without real X access.
- Start with `--invalid-grant` to issue immediately expired tokens whose refresh is rejected. After connection, wait at least 40 seconds for the 30-second tick, then reload to see reconnect-required UI.
- Capture console/request events before navigation. Signed-out `/api/auth/me` can return 401 and emit a browser resource error; report it separately from authenticated feature errors rather than hiding it.
- Assert cancellation sends zero disconnect POSTs, and confirmation sends exactly one.

## Posts and resources
- Seed only the fixtures authorized by the plan, using the disposable bearer-token API or the UI. Do not extract browser session cookies for API calls.
- Wait for the rebuilt bundle to load before retesting a frontend fix; restarting the fake server additionally resets all fixture IDs.
- Test close-before-debounce on both existing and new posts. Verify the list remains open after closing, then reopen to check saved content.
- For save-queue races, add real CDP network latency and change text after the first POST/PATCH starts but before it resolves. Verify the latest text after reopening and inspect request/response ordering; normal-speed typing alone may miss the race.
- To exercise failed-save restoration, abort one mutation request while leaving the browser online, require a `requestfailed` event, then remove the abort and trigger the next flush without further typing. Offline mode can pause TanStack mutations instead of reaching the application's error handler, so it is not sufficient evidence of retry-after-failure.
- With mixed resources, verify Notes filtering excludes images, linked-image usage is shown, and uploading refreshes the visible sidebar count. When testing exports, check derived-field omission for every resource type, not only notes.
- Check insertion focus, pending-save retention across navigation, and premature DELETE requests independently of visible toasts.
- When testing manual Load more, disable or intercept IntersectionObserver-driven fetching before navigating (the resources list auto-fetches when its sentinel is visible), then click `Load more`, check the initial row count remains stable, and verify the final count and unique IDs.
- If a modal covers the sidebar, inspect live counts after closing it rather than treating hidden DOM text as visible evidence.

## Evidence capture
- Maximize Chrome before recording. Keep authentication/server setup outside the feature recording unless sign-in is itself an explicitly numbered video step.
- Prefer computer-tool UI actions. Attach Playwright to the available Chrome CDP endpoint for screenshots and passive console/request logging. Python tooling, if missing, can be installed with `pip install playwright`; attaching to existing Chrome does not need a browser download.
- Arm screenshot capture with `getByText(exactToast).waitFor({state:'visible'})` before the UI action, then screenshot immediately, so short-lived callback/disconnect toasts are preserved.
- Callback query cleanup is visible in the browser address bar/video and can additionally be logged from `page.url()`. Page screenshots omit browser chrome.
- For plans requiring video-derived screenshots, log a wall-clock marker at every specified Shows state and leave it rendered for at least two captured frames.
- For real-speed requirements, preserve the raw recording. The recording tool's edited/clean derivatives can compress idle time; do not use those as real-speed proof.
- Raw x11grab recordings expose their epoch start in `ffmpeg.log` (`Duration: N/A, start: ...`). Subtract it from step timestamps to find source offsets. Trim only lead-in/tail without speed filters, then extract PNGs from the final MP4.
- Inspect every extracted PNG visually, including transient toasts and pagination states. Keep a manifest of video timestamp → screenshot filename so evidence provenance is auditable.
