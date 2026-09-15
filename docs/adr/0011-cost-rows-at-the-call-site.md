---
status: accepted
date: 2026-09-15
---

# Cost rows are written at the call site, not by a wrapping X client

Every billed X call writes one `api_calls` row through `logApiCall` in `apps/server/src/db/apiCalls.ts`, from the module that made the call. A client that wraps `XClient` and writes the row itself was considered and rejected. The row carries the `post_id` or `resource_id` the call was for, the price for one tweet read is a bundle (post plus author, `X_COSTS_USD.saveTweet`), the price of a publish depends on the text, and the free token calls write no row. Only the call site knows all four. A wrapper would need a charge context on every billed method, which changes the ADR-0010 interface and adds nothing behind it.

## Consequences

- A new billed X call must add its own `logApiCall`. One test pins that the fake client's billed calls equal the rows written after a publish with media.
- `costKindOf` returns `null` for an endpoint that is not billed. Readers do not catch around it.
