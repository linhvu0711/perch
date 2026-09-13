---
name: perch-fake-x-ui-walkthrough
description: Run Perch OAuth account UI walkthroughs locally with fake X and capture transient toast evidence.
---

# Perch fake-X UI testing

## Devin Secrets Needed
None for fake X. Set a disposable `PERCH_TOKEN` and use it on the login screen. Real X testing is separate and requires the application's configured OAuth credentials.

## Local setup
- Ensure Bun is available; this environment has `~/.bun/bin/bun`.
- From the repo root, install dependencies if needed and build the web app; the fake server serves `apps/web/dist`, not a live frontend dev bundle.
- Start `PERCH_TOKEN=<disposable-token> bun apps/server/scripts/dev-fake.ts`.
- Open `http://127.0.0.1:3000`, enter the configured token, and press Enter.
- Every server process creates a fresh temporary SQLite DB. Restarting is a clean-state reset, and may require reauthentication.
- Stop the process after testing; confirm port 3000 is no longer listening.

## Account scenarios
- Sidebar Settings → Connect X → Continue to X uses a local fake authorization redirect, exercising the application callback without real X access.
- Start with `--invalid-grant` to issue immediately expired tokens whose refresh is rejected. After connection, wait at least 40 seconds for the 30-second tick, then reload to see reconnect-required UI.
- Capture console/request events before navigation. Signed-out `/api/auth/me` can return 401 and emit a browser resource error; report it separately from authenticated feature errors rather than hiding it.
- Assert cancellation sends zero disconnect POSTs, and confirmation sends exactly one.

## Evidence capture
- Maximize Chrome before recording. Keep authentication/server setup outside the feature recording.
- Use computer-tool UI actions. Attach Playwright to the available Chrome CDP endpoint for `page.screenshot` files and passive console/request logging.
- Arm screenshot capture with `getByText(exactToast).waitFor({state:'visible'})` before the UI action, then screenshot immediately, so short-lived callback/disconnect toasts are preserved.
- Callback query cleanup is visible in the browser address bar/video and can additionally be logged from `page.url()`. Page screenshots omit browser chrome.
