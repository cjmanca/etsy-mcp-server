# Browse buyer and seller taxonomies Implementation Plan

> **For agentic workers:** This task is being executed inline by the assigned worker. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `get_taxonomy_nodes` so callers can browse bounded, validated buyer or seller taxonomy nodes and receive stable IDs and hierarchy paths.

**Architecture:** Keep public tool registration and response serialization in `src/index.ts`; put complete-tree validation, normalization, and a two-selector single-flight TTL cache in a focused taxonomy module. Acquire each full tree through the existing fixed-origin requester and 1 MiB response limit; cache only a complete validated tree and return bounded local slices.

**Tech Stack:** Existing TypeScript, MCP SDK, Axios requester, and Node.js test runner; no new dependencies.

**Spec:** `.superpowers/sdd/TASK/task-M1.1-brief.md`

## Global Constraints

- Preserve all six existing tools and the API-key-only `public` capability.
- Require `taxonomy_type` (`buyer` or `seller`); accept optional positive safe-integer `taxonomy_id`, nonempty `name` up to 200 characters, `limit` 1–100, and `offset` 0–12000.
- Subtree/name filters are explicitly local; Etsy node endpoints accept no filters.
- Preserve the 10-second request timeout, 1 MiB upstream body limit, and 128 KiB MCP output limit; do not lift shared limits.
- Cache buyer and seller independently for a bounded TTL and memory; never cache incomplete, malformed, oversized, or over-depth trees.
- Keep errors sanitized, taxonomy text marked untrusted, and output as flat selected summaries with truthful count/returned/truncated metadata.
- Do not edit `AGENTS.md` or `README.md`, make live Etsy requests, add unrelated tools, or commit.

## Review Focus

- Buyer/seller selector mix-up or endpoint mismatch — route tests assert the two exact paths and distinct taxonomy output.
- Malformed, duplicate, cyclic, inconsistent, too-deep, or over-budget nodes — normalization tests reject the entire tree before it can be cached.
- Oversized full-tree response — error and client-configuration tests verify bounded actionable failure, no partial success/cache, and an unchanged 1 MiB cap.
- Concurrent cold requests, selector isolation, and expiration — cache tests verify per-selector single-flight, independent entries, and controlled-clock expiry.
- Name/subtree filtering and output clipping — MCP tests verify local filtering metadata, subtree misses, page semantics, untrusted text, and <=128 KiB truthful results.

---

### Task 1: Pin the MCP contract with tests

**Files:**
- Modify: `test/mcp-contracts.test.js`
- Modify: `test/security.test.js`
- Test: shared `test/helpers/mcp.js`

**Interfaces:** Uses the existing mocked MCP client/server and Axios adapter; production contract is one new public tool.

- [x] Add discovery/schema and buyer/seller route tests; update exact discovery expectations from six tools to seven.
- [x] Add input rejection-before-request tests and expected output fields for local subtree/name filtering, paging, stable IDs/paths, and bounded output.
- [x] Run `npm test` and capture the expected RED caused by the missing tool.

### Task 2: Validate and cache full taxonomy trees

**Files:**
- Create: `src/taxonomy.ts`
- Modify: `test/mcp-contracts.test.js`

**Interfaces:** Exercise normalization and caching through real MCP calls with only the external Axios boundary mocked; the server factory accepts an injectable clock for deterministic expiry tests.

- [x] Write MCP behavior tests for hierarchy, IDs/path validation, text/depth/node bounds, duplicate IDs, selector isolation, single-flight, expiry, and failed-load non-caching.
- [x] Run focused tests to verify RED before implementation.
- [x] Implement iterative whole-tree validation and bounded flat normalization; cache only the completed normalized tree with independent per-type TTL entries.
- [x] Run focused tests to verify GREEN.

### Task 3: Register local taxonomy browsing

**Files:**
- Modify: `src/index.ts`
- Modify: `test/mcp-contracts.test.js`
- Modify: `test/security.test.js`

**Interfaces:** `get_taxonomy_nodes` returns `count` as locally matched total, `returned`, `offset`, `limit`, `taxonomy_type`, explicit `filters_applied` local metadata, flat results (`id`, `name`, `level`, `parent_id`, `full_path_taxonomy_ids`, bounded `child_ids`), `truncated`, and the untrusted-content notice.

- [x] Add tests for required/invalid selectors, positive IDs, bounded name/pagination, subtree miss vs. zero name matches, exact route selection, and no invented query parameters.
- [x] Run these tests to verify RED before registration/handler code.
- [x] Implement request-on-cache-miss via existing `get`, selector-specific actionable oversize failure, local filtering/pagination, bounded paths/child summaries, and response serialization.
- [x] Run focused tests to verify GREEN and <=128 KiB output.

### Task 4: Document and verify M1.1 only

**Files:**
- Modify: `docs/index.md`, `docs/overview.md`, `docs/planned-public-discovery.md`, `docs/response-handling-and-safety.md`, `docs/setup-and-access.md`, `docs/planned-oauth-and-accounts.md`, `docs/roadmap.md`, `docs/api-coverage.md`, `TODO.md`, `TASK.md`, `EXAMPLES.md`, `QUICKREF.md`, `CHANGELOG.md`
- Create: `.superpowers/sdd/TASK/task-M1.1-report.md`

- [x] Document actual taxonomy node browsing and the bounded cache/acquisition behavior; mark only the two node operations current.
- [x] Record exact official API contract sources, RED/GREEN evidence, safe acquisition design, final test/audit output, and a proposed README feature snippet in the report.
- [x] Run `npm test`, `npm audit --omit=dev --audit-level=high`, relevant transport checks, and `git diff --check`; verify no `README.md`/`AGENTS.md` changes were introduced.
