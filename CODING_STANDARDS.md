# Coding standards

One rule per line. A rule a tool checks names the tool in brackets. Product
rules live in `docs/spec/perch-v1.md` and `docs/cli.md`; vocabulary lives in
`CONTEXT.md`; decisions that are hard to reverse live in `docs/adr/`. This file
is only about how code is written.

## Stack

- TypeScript everywhere. Bun is the runtime, package manager, test runner, and bundler.
- Server is Hono. Web is a React and Vite single-page app with TanStack Query, react-router, Tailwind, and shadcn-style components. CLI is Commander and ships as one compiled binary.
- Database is SQLite through Drizzle on `bun:sqlite`. Migrations are generated from the schema with `drizzle-kit generate`, never written by hand. [drizzle-kit]
- The X client is hand-written `fetch` behind the `XClient` interface in `apps/server/src/x/client.ts`, with a fake and a real adapter (ADR-0010).

## Names

- Code, API fields, and UI copy use the terms in `CONTEXT.md` and never the words listed under `_Avoid_`.
- Multi-word `.ts` files are `camelCase` (`charLimit.ts`, `apiCalls.ts`). [biome useFilenamingConvention]
- React component files are `PascalCase.tsx` and match the component name. Files under `apps/web/src/components/ui/` are lowercase because shadcn generates them. [biome useFilenamingConvention]
- Types and interfaces are `PascalCase`. `interface` for hand-written shapes, `type` for unions and `z.infer` results.
- Functions are `camelCase` and declared with `function`. Arrow constants are only for values that must satisfy a handler type, such as Hono's `ErrorHandler`.
- React components are named exports, one public component per file. Private sub-components may share the file.
- Config and threshold constants are `UPPER_SNAKE_CASE`. Schemas, tables, and instances are `camelCase`. Zod schemas end in `Schema`.
- Database tables are plural `snake_case`. Columns and JSON fields are `snake_case`. TypeScript properties are `camelCase`; the Drizzle column name carries the `snake_case` form.
- Environment variables are `UPPER_SNAKE_CASE` with a `PERCH_` prefix. `PORT` is the one exception because hosts set it.

## Layout

- Bun workspaces: `apps/server`, `apps/web`, `apps/cli`, `packages/core`. A new module goes in the package that owns the behavior.
- `packages/core` holds Zod schemas for every API type, the inferred types, and every rule that decides something: character limits, costs, list limits, title derivation, ready checks, needs-attention. It imports nothing from the apps.
- Web and CLI import deciding rules, constants, limits, and prices from `@perch/core`. They never re-implement one, not even as a placeholder or a number in UI copy.
  A hardcoded `280` or `$0.010` in a page is a second source of truth that drifts silently.
- Server routes live in `apps/server/src/routes/`, database access in `apps/server/src/db/`, X access in `apps/server/src/x/`. Web pages live in `apps/web/src/pages/`, components in `apps/web/src/components/`, hooks and API in `apps/web/src/lib/`. CLI commands live in `apps/cli/src/commands/`.
- Web and CLI reach the server only through the HTTP API with Hono's typed RPC client. They import `type { AppType }` from `@perch/server` and nothing else from it, except `@perch/server/testing` in tests.
- Imports are ordered node builtins, then packages, then relative paths, with a blank line between groups. [biome organizeImports]
- Web imports its own files through the `@/` alias. Server, CLI, and core use relative paths.
- Type-only imports use `import type` or an inline `type` marker. [tsc verbatimModuleSyntax] [biome useImportType]

## Errors

- Server routes throw `ApiError` with a status and a stable code. One `onError` handler in `apps/server/src/errors.ts` turns it into the error JSON. Routes do not catch, except to translate a lower-level error into an `ApiError`.
- CLI commands throw `CliError` with an exit code. One catch in `apps/cli/src/cli.ts` maps it to stderr and the exit code.
- Web handles errors where the action happens, with a toast or an inline message. There is no error boundary in v1.
- Plain `throw new Error` is only for invariants that cannot happen. Anything a client can trigger gets a typed error.
- A `catch` either rethrows, translates, or returns a documented fallback. It never swallows silently.

## Logging

- No logging library in v1.
- Server calls `console.*` only in the entry file at boot and in the error handler.
- CLI writes only to the injected `ctx.stdout` and `ctx.stderr`, never to `console`.
- Web never logs.
- Tokens, cookies, secrets, and env values are never logged. The error handler logs the message and stack, not request bodies or headers.

## Tests

- Runner is `bun test`. [bun]
- Tests live in a `test/` folder next to `src/` and are named `<topic>.test.ts`. Web has no tests in v1.
- A test drives Perch the way a client does and asserts on what a client can see: HTTP responses, rows the next request returns, files that exist, stdout, stderr, exit codes, and the calls the fake X client received.
- The seam is `createTestServer` in `apps/server/src/testing.ts`. Server tests send requests to the app in-process. CLI tests inject that app as `fetch` through `makeCtx` in `apps/cli/test/helpers.ts`.
- Pure modules in `packages/core` and adapters such as the real X client may be tested directly, with canned inputs.
- Every test starts from an empty temp database and an empty temp upload directory, with an injected clock and a fake X client. A test never reads or writes `process.env`, `~/.perch`, the real clock, or the network.
  A test that uses `new Date()` or the real env passes on one machine and fails on the next.
- Every server route, every CLI command, and every rule in core has a test.

## Commits

- Conventional Commits. Type is one of `feat`, `fix`, `docs`, `test`, `chore`, `refactor`.
- Scope is the package when one package changes: `web`, `server`, `cli`, `core`. No scope when several change.
- Subject is imperative and under 72 characters. A body explains why when the subject is not enough.
- Branches are `<type>/<slug>`, for example `feat/note-resources`, `docs/grill-20-file-mirror`.
- Every change lands through a pull request against `main`, one topic per PR.

## Dependencies

- Versions are exact. No caret, no tilde. [bunfig exact]
- `bun.lock` is committed. No other lockfile.
- A dependency is declared in the package that imports it. Tooling every package uses, such as `typescript` and `@types/bun`, is declared once at the root.
- `@perch/server` is a devDependency of web and CLI, for its types and test seam only.
- Bun 1.4 or newer. [package.json engines]

## Config and secrets

- Each app reads env in its entry file only: `apps/server/src/index.ts` and `apps/cli/src/context.ts`. Env is parsed once through a Zod schema and passed in as typed options. Routes, commands, and core never touch `process.env`.
- Every variable has a line in `.env.example` with its default. `.env` is never committed. [.gitignore]
- Runtime data lives under `data/` and is never committed. [.gitignore]
- The CLI keeps its config at `~/.perch/config.json`, written with mode `0600`.
- Prices are configuration in `packages/core`, not scattered constants.

## API shape

- Every route sits under `/api`. No version prefix.
- Paths are lowercase plural nouns: `/api/resources`, `/api/resources/:id`.
- Request bodies, queries, and params are validated with `zValidator` and a schema from `@perch/core`. [@hono/zod-validator]
- A successful response returns the resource itself, or a list as `{ items, total, next_cursor }`. Auth's `{ user }` and `{ ok: true }` are the two exceptions and stay as they are.
- Errors, cursor paging, and batch results follow the contract in `docs/spec/perch-v1.md` under "API". Limits come from `@perch/core`.
- Auth is one `getUser(request)` function in `apps/server/src/auth.ts`. Multi-user changes only that function.

## Formatting

- Biome is the formatter and linter. `bun run check:changed` must pass on every change. The whole-repo `bun run lint` must pass once #32 fixes the remaining lint errors. [biome]
- Two spaces, no tabs. [biome]
- Line width 100. [biome]
- Single quotes in TypeScript, double quotes in JSX attributes. [biome]
- Semicolons always. Trailing commas everywhere. [biome]
- Generated files are not formatted: `apps/server/drizzle/`, `dist/`, `bun.lock`.

## TypeScript

- `strict` and `noUncheckedIndexedAccess` stay on. [tsc]
- No `any`. No `@ts-ignore`. `@ts-expect-error` is allowed with a reason on the same line. [biome noExplicitAny]
- `async`/`await` over `.then()` chains. A fire-and-forget promise is written `void promise.catch(...)`.
- Database access goes through the Drizzle query builder. Raw SQL only for pragmas and the one `LIKE` search fragment.
- React components are functions. Server state lives in TanStack Query hooks in `apps/web/src/lib/queries.ts`. No fetch inside `useEffect`.
- Modals are routes rendered over their list page.

## Not covered

- Web tests. Out of scope for v1 by the spec.
- Structured logging and request ids. One process, one user; revisit when a second user exists.
- A React error boundary. Revisit when a page can crash on render.
- Commit hooks and CI. Recommended as separate issues.
