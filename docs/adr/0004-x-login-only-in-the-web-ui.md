---
status: accepted
date: 2026-09-03
---

# The X OAuth flow lives only on the server, started from the web UI

X hands out tokens by redirecting a browser to a pre-registered callback URL. The server has a public URL and can hold a client secret, so we register one X app of type "Web App" with callback `https://<host>/auth/x/callback`. The user clicks "Connect X" in the web UI, X redirects back, the server stores access + refresh tokens in `x_accounts` and refreshes them itself (access tokens live 2 hours; refresh tokens may rotate, so we persist the returned one atomically and fall back to a fresh login on `invalid_grant`).

Scopes: `tweet.read tweet.write users.read media.write offline.access`. At connect time (and on each refresh) we also read `GET /2/users/me?user.fields=subscription_type` to set the character limit (280, or 25,000 for `Premium` / `PremiumPlus`).

The CLI does not run its own OAuth. It would need a second X app of type "Native" (public client), a temporary local web server on `127.0.0.1`, and a way to ship tokens up to the server, only to do once what the server already does. `perch auth login` just opens the web page.

## X accounts are rows, not fields on the user

`x_accounts(id, user_id, x_user_id, username, subscription_type, access_token, refresh_token, expires_at, connected_at, disconnected_at)`. Connect = new row (or token update if the same X user reconnects). Disconnect = set `disconnected_at`, revoke at X, keep the row. Rule for v1: one connected account at a time; connecting another disconnects the current one.

Resources belong to the user, never to an X account. A post's `x_account_id` is empty until publish time, when it is set to the account that sent it, forever. So drafts written under account A go out from account B if B is the one connected when they fire.
