# proofbox demo, run 3

A record of a third end-to-end run of Perch on a disposable Linux machine made by [proofbox](https://github.com/linhvu0711/proofbox), on proofbox `main` at `0354576`. It checks proofbox, not Perch. Nothing in the app changed. Run 2 is on the `chore/proofbox-demo` branch.

## How it ran

1. `proofbox create --os linux --work . --setup setup-linux.sh --env-file app.env` on a Namespace Linux Sandbox. The Setup script runs as user `app` with no sudo, so it installs Bun 1.4.0 from the `@oven/bun-linux-x64` npm tarball, then runs `bun install --frozen-lockfile`. The env file holds only a throwaway `PERCH_TOKEN`. The Base image had changed since run 2, so proofbox built it, ran the Setup script, and saved a new Snapshot (Fingerprint `d5d432f0ecc8`).
2. `proofbox exec` runs `bun run build` and `bun run cli:build`, then starts `bun apps/server/scripts/devFake.ts` (fake X, fresh SQLite database per start).
3. Chromium from the Base image starts with `--no-sandbox`. proofbox drives it with `click`, `type`, `key`, and `scroll`, and `mark` names each step.
4. `proofbox mark --wait` names the one real wait, the scheduler publishing the post. proofbox cuts every other Still part with no label.
5. `proofbox record stop` builds each Proof video and a Proof screenshot per step.

## What the run covers

Video 1, the normal path: sign in with the access token, connect X through the fake OAuth page, create a tag, save a tweet from its X URL, upload an image, write a post that attaches the image, links the tweet, and carries the tag, schedule it two minutes ahead, promote it to official, and wait for the 30-second scheduler to publish it. The Posts list, the Calendar, and the Dashboard cost table then show it published.

Video 2, the failure path: the server restarts with `--fail-send`, a post is published now, X answers 503, the post turns failed, and the Dashboard lists it under Issues with the reason.

The CLI ran against the same data: `perch status`, `post list`, `calendar`, `cost`, and `resource pull`.

## Compared with run 2

| | Run 2 | Run 3 |
|---|---|---|
| Sandbox up | 1 min 22 s, Snapshot reused | 2 min 31 s, Base image built and new Snapshot saved |
| Build and server | 36 s | 32 s |
| Dry run | 8 min 5 s | 3 min 18 s, click targets known from run 2 |
| Both videos | 7 min 39 s | 8 min 42 s |
| Video 1 length | 2 min 22 s | 2 min 14 s |
| Video 2 length | 52 s | 50 s |
| Still parts | each one cut and labelled "» N s later" | cut with no label, except the scheduler wait: "» 2 min 14 s later · waiting for the scheduler to publish at 01:50" |

## A drawing glitch to know about

Perch shows text boxes in JetBrains Mono, which joins `//` into one shape. Chromium draws the typed `https://x.com/...` as `https: /x.com/...`, here even at fast pace. The value is right: the saved row and the API both hold `https://x.com/perchtester/status/1`. Check the saved value before you call a typed URL wrong.
