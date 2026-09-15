# Claude Code

Read `CODING_STANDARDS.md` before you write or review code.

Vocabulary is in `CONTEXT.md`. Product rules are in `docs/spec/perch-v1.md` and
`docs/cli.md`. Decisions that are hard to reverse are in `docs/adr/`.

Before you finish a change, run `bun run typecheck`, `bun run test`, and
`bun run check:changed`. The last one runs Biome on the files that differ from
`main`. The whole-repo `bun run lint` must pass. Do not fix unrelated files in a
feature PR; open a chore.

Read `REVIEW.md` before you review a pull request.
