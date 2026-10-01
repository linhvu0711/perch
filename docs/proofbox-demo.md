# proofbox demo

A record of one end-to-end run of Perch on a disposable Linux machine made by [proofbox](https://github.com/linhvu0711/proofbox). It checks proofbox, not Perch. Nothing in the app changed.

## How it ran

1. `proofbox create --os linux --work . --setup setup-linux.sh --env-file app.env` on a Namespace Linux Sandbox. The Setup script runs as user `app` with no sudo, so it installs Bun 1.4.0 from the `@oven/bun-linux-x64` npm tarball, then runs `bun install --frozen-lockfile`. The env file holds only a throwaway `PERCH_TOKEN`.
2. `proofbox exec` runs `bun run build` and `bun run cli:build`, then starts `bun apps/server/scripts/devFake.ts` (fake X, fresh SQLite database per start).
3. Chromium from the base image starts with `--no-sandbox`. proofbox drives it with `click`, `type`, `key`, and `scroll`, and `mark` names each step.
4. `proofbox record stop` builds each Proof video and a Proof screenshot per step.

## What the run covers

Video 1, the normal path: sign in with the access token, connect X through the fake OAuth page, create a tag, save a tweet from its X URL, upload an image, write a post that attaches the image, links the tweet, and carries the tag, schedule it two minutes ahead, promote it to official, and watch the 30-second scheduler publish it. The Posts list, the Calendar, and the Dashboard cost table then show it published.

Video 2, the failure path: the server restarts with `--fail-send`, a post is published now, X answers 503, the post turns failed, and the Dashboard lists it under Issues with the reason.

The CLI ran against the same data: `perch status`, `post list`, `calendar`, `cost`, and `resource pull`.

## A drawing glitch to know about

Perch shows text boxes in JetBrains Mono, which joins `//` into one shape. When `https://x.com/...` is typed key by key, Chromium can draw it as `https: /x.com/...`. The value is right: the saved row and the API both hold `https://x.com/perchtester/status/1`. Check the saved value before you call a typed URL wrong.
