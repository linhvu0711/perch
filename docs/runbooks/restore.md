# Restore Perch from R2

How to bring a deploy back after its volume is lost. Restore runs before the server starts, inside the container, driven by one environment variable.

## When

The Railway volume is new or wiped: the service comes up but shows an empty Perch — no Resources, no Posts.

## Before

- The four `PERCH_R2_*` variables are set on the service.
- The bucket holds `litestream/` (the database replica) and `uploads/` (the copied files).

## Steps

1. Railway → the service → Variables → set `PERCH_RESTORE_FROM_R2` to `true` → Deploy.
2. Watch the deploy logs for `restoring from R2`, then `restored N uploads to /data/uploads`, then the Litestream `replicating to` line.
3. Open the app; Resources and Posts are back.
4. Set `PERCH_RESTORE_FROM_R2` back to `false` → Deploy.

## If it fails

A restore that cannot reach R2 exits non-zero, so the deploy fails instead of starting empty. The log names the step that failed; fix the variable and redeploy.

## Point in time

From any machine with the four `PERCH_R2_*` variables set:

```sh
litestream restore -config litestream.yml -timestamp <RFC3339> -o <path> <db path>
```

Copying that file onto the volume is the manual variant of the steps above and is out of scope here.

## Local check

`docker build -t perch .` and a `docker run` with dummy `PERCH_R2_*` values prove the image starts and Litestream supervises the server; the dummy bucket only produces `monitor error` retries. A real restore needs the real bucket.
