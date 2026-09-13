---
status: accepted
date: 2026-09-13
---

# The X client is hand-written fetch behind one interface, not the xdk

ADR-0008 named `@xdevplatform/xdk` for the X client. When the client was built (issue #5, 2026-09-13) it went the other way: `XClient` in `apps/server/src/x/client.ts` is a small interface with only the calls Perch makes, `x/real.ts` implements it with raw `fetch`, and `x/fake.ts` implements it for tests and the dev walkthrough. Perch makes five calls, each one is a short request with a known shape, and the user watches X costs closely, so every request had to be visible in one place. A generated SDK would add a dependency, hide the wire format, and make the fake harder to keep honest. The interface is the contract; swapping in the xdk later means one new file behind it.
