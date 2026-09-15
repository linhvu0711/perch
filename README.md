# Perch

Perch is a single-user workspace for preparing and managing X content. This initial scaffold provides one Bun process with a SQLite database, authenticated HTTP API, built React web shell, and Commander CLI.

## Quick start (server)

Prerequisite: Bun 1.4 or newer.

```sh
bun install
cp .env.example .env
```

Set `PERCH_TOKEN` in `.env` to a private shared secret, then build the web app and start the server in one command:

```sh
bun run start:local
```

Open http://127.0.0.1:3000.

## Web login

The login card has one field, "Access token". Type the `PERCH_TOKEN` value and click "Sign in". The session is stored in the `perch_session` cookie.

## X app setup

To enable Connect X, create a "Web App" client at console.x.com with callback `<PERCH_PUBLIC_URL>/auth/x/callback`, then set `PERCH_X_CLIENT_ID`, `PERCH_X_CLIENT_SECRET`, and `PERCH_PUBLIC_URL`. After signing in, connect the account under Settings → Connect X.

## CLI install

Build the single-file binary and install it on your PATH:

```sh
bun run cli:build
install -m 755 apps/cli/dist/perch /usr/local/bin/perch
```

(`sudo` the `install` line if the folder is not writable.) Then:

```sh
perch --help
perch config set server-url <url>
perch config set token <value>
perch auth status
```

`PERCH_TOKEN` works in place of `perch config set token`.

For development you can link the source CLI instead:

```sh
cd apps/cli
bun link
perch auth status
```

The CLI stores local configuration at `~/.perch/config.json` unless `PERCH_CONFIG_PATH` overrides it.

## Development

```sh
bun run dev        # server with --watch on port 3000
bun run dev:web    # Vite on port 5173, proxies /api to the Bun server
bun run build      # build the web app into apps/web/dist
bun run test
bun run typecheck
```

Both `bun run dev` and `bun run start` run from the repository root. Relative paths in `.env` are resolved from that root. `bun run start` alone 503s when the web app is not built; `bun run start:local` builds first.

## For agents

- Run `perch resource pull` first. It copies every resource into a local folder of Markdown files.
- Read the Mirror at `~/.perch/resources/` with your file tools. `perch status` prints the Mirror path and the last pull time.
- Write through the CLI (`perch resource add`, `edit`, `delete`), never into the Mirror. Pull again to pick up changes.

## Docker

```sh
docker build -t perch .
docker run -d --name perch -p 3000:3000 -e PERCH_TOKEN=perch-dev -e PERCH_SECURE_COOKIES=false perch
```

The image holds Bun, the built web app, and the Litestream binary. `docker/start.sh` runs `litestream replicate -exec` around the server when `PERCH_R2_BUCKET` is set, and plain `bun` when it is not; `PERCH_RESTORE_FROM_R2=true` restores the database and uploads from R2 before boot.

## Railway settings

Railway builds the repo `Dockerfile` on push. In the service settings:

- Volume mount path: `/data`
- Health check path: `/health` (needs no login; the check runs once per deploy on the injected `PORT`)
- Start command: none — the Dockerfile `CMD` starts the server

Set the variables from the Environment table below; `PERCH_PUBLIC_URL` is `https://<RAILWAY_PUBLIC_DOMAIN>`.

## Backups and restore

When the four `PERCH_R2_*` variables are set, Litestream streams the database to `PERCH_R2_BUCKET` under `litestream/`, and every upload is copied under `uploads/` after its local write (a failed copy is logged, never fatal). To restore onto a new or wiped volume, follow `docs/runbooks/restore.md`.

## Environment

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PERCH_TOKEN` | Yes | — | Shared secret used by the web app and CLI |
| `PERCH_DB_PATH` | No | `./data/perch.db` | SQLite database path |
| `PERCH_UPLOAD_DIR` | No | `./data/uploads` | Upload directory |
| `PERCH_WEB_DIST` | No | `./apps/web/dist` | Built web application directory |
| `PERCH_SECURE_COOKIES` | No | `true` | Mark the session cookie Secure; local development over `http://localhost` works with `true` because browsers treat localhost as a secure context |
| `PORT` | No | `3000` | Server listen port |
| `PERCH_X_CLIENT_ID` | No | — | X OAuth "Web App" client id; enables Connect X |
| `PERCH_X_CLIENT_SECRET` | No | — | X OAuth "Web App" client secret |
| `PERCH_PUBLIC_URL` | No | `http://127.0.0.1:3000` | Public base URL; must match the callback URL registered at X, so open the app at this URL |
| `PERCH_TIMEZONE` | No | `UTC` | Time zone seeded into Settings on the first boot; Settings wins after that |
| `PERCH_R2_ACCOUNT_ID` | No | — | Cloudflare account id; the R2 endpoint is `https://<id>.r2.cloudflarestorage.com`; set all four or none |
| `PERCH_R2_BUCKET` | No | — | R2 bucket that holds the Litestream replica under `litestream/` and upload copies under `uploads/`; set all four or none |
| `PERCH_R2_ACCESS_KEY_ID` | No | — | R2 API token key id; set all four or none |
| `PERCH_R2_SECRET_ACCESS_KEY` | No | — | R2 API token secret; set all four or none |
| `PERCH_RESTORE_FROM_R2` | No | `false` | Set to `true` for one deploy to restore the database and uploads from R2; read by `docker/start.sh`, not by the server |
