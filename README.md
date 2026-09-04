# Perch

Perch is a single-user workspace for preparing and managing X content. This initial scaffold provides one Bun process with a SQLite database, authenticated HTTP API, built React web shell, and Commander CLI.

## Prerequisites

- Bun 1.4 or newer

## Install

```sh
bun install
cp .env.example .env
```

Set `PERCH_TOKEN` in `.env` to a private shared secret before starting the server.

## Run

Build the web app, then start the server on port 3000:

```sh
bun run build
bun run dev
```

The server serves `apps/web/dist` at `/` and the API at `/api/*`. For web development with hot reload, run Vite on port 5173; it proxies `/api` to the Bun server:

```sh
bun run dev:web
```

## Check and build

```sh
bun run build
bun test
bun run typecheck
```

## CLI

Link the source CLI globally:

```sh
cd apps/cli
bun link
perch auth status
```

Alternatively, build the standalone executable from the repository root:

```sh
bun run cli:build
apps/cli/dist/perch auth status
```

The CLI stores local configuration at `~/.perch/config.json` unless `PERCH_CONFIG_PATH` overrides it. Use `perch config set token <value>` or set `PERCH_TOKEN`, then use `perch auth status` to verify authentication.

## Environment

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PERCH_TOKEN` | Yes | — | Shared secret used by the web app and CLI |
| `PERCH_DB_PATH` | No | `./data/perch.db` | SQLite database path |
| `PERCH_UPLOAD_DIR` | No | `./data/uploads` | Upload directory |
| `PERCH_WEB_DIST` | No | `./apps/web/dist` | Built web application directory |
| `PORT` | No | `3000` | Server listen port |
