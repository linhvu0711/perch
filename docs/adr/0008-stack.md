---
status: accepted
date: 2026-09-03
---

# TypeScript everywhere on Bun: Hono server, React + Vite SPA, Commander CLI, one monorepo

One person maintains three entry points that share one data model, so one language wins: shared Zod schemas, cost rules, and character counting live in `packages/core` and every app imports them. Bun is runtime, package manager, test runner, and bundler (and `bun build --compile` yields a single CLI binary). Hono is the HTTP layer because it runs natively on Bun and its RPC client gives the CLI and web UI typed calls from the route definitions. The web UI is a plain Vite build that Hono serves as static files from the same process (`/api/*` → routes, everything else → `dist/`). Commander is the CLI framework for stability. Drizzle is the DB layer (see ADR-0002).

```
apps/server    Hono + scheduler + X client; serves apps/web build
apps/web       React + Vite SPA (TanStack Query, shadcn/ui)
apps/cli       Commander; talks to the server over HTTP
packages/core  shared types, Zod schemas, cost + char-count rules
```

X client: the official `@xdevplatform/xdk` for typed v2 endpoints and OAuth, raw `fetch` where it falls short, and `twitter-text` for weighted character counting. Superseded for the X client by ADR-0010: the client is hand-written `fetch`; `twitter-text` is still the plan for counting.

Rejected: Elysia (more churn), Next.js (see ADR-0001), citty (less proven), raw `bun:sqlite` without an ORM (hand-written migrations and mapping).
