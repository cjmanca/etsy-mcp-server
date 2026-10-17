# Agent instructions

## Required reading and context recovery

Before starting work, read this `AGENTS.md`, [README.md](README.md), and the
[documentation index](docs/index.md). Then read the documents relevant to the
task using the routing table below. Read any applicable nested `AGENTS.md`
before working in its directory.

**After every context compaction, before resuming work or making changes,
read `AGENTS.md` again, reread the documentation index, and reread all
documentation relevant to the active task.** This includes applicable nested
agent instructions and the active task/plan and prerequisite contracts. Do not
rely on a compaction summary or a previous read as a substitute. Recheck the
working-tree state before continuing so existing user or agent changes are
preserved. Apply this recovery rule to sub-agents as well.

Load only the relevant documentation slices, not every subsystem. If the task
scope changes, read the newly relevant documents before proceeding.

## Documentation routing

All paths below are relative to the repository root.

| Task | Required documentation |
| --- | --- |
| Understand current capabilities and boundaries | `docs/overview.md` |
| Configure clients, credentials, startup, or connectivity | `docs/setup-and-access.md`, `SETUP.md` |
| Change listing search or details | `docs/listing-discovery.md` |
| Change shop lookup, search, or active catalogs | `docs/shops.md` |
| Change shop reviews or date filtering | `docs/reviews.md` |
| Change tool responses, pagination, truncation, validation, errors, or safety | `docs/response-handling-and-safety.md`, `docs/access-policy.md` |
| Implement, fix, test, or review code | `CONTRIBUTING.md`, `CHECKLIST.md`, plus the relevant feature and safety documents |
| Select or implement planned features | `docs/roadmap.md`, relevant tasks and prerequisites in `TASK.md`, matching entries in `TODO.md` and `docs/api-coverage.md`, `docs/access-policy.md`, and the relevant planned subsystem below |
| Add taxonomy, richer public discovery, batch lookups, buyer prices, or public research | `docs/planned-public-discovery.md` |
| Add OAuth, connections, consent, token lifecycle, identity, or account access | `docs/planned-oauth-and-accounts.md` |
| Add private catalogs, inventory, listing writes, personalization, translations, or media/files | `docs/planned-listing-management.md` |
| Add shop settings, sections, shipping, processing, production partners, or policies | `docs/planned-shop-management.md` |
| Add orders, receipts, transactions, payments, fulfillment, or events | `docs/planned-orders-and-payments.md` |
| Update user-facing documentation, examples, or release notes | `README.md`, `EXAMPLES.md`, `QUICKREF.md`, `CHANGELOG.md`, and affected current/planned feature documents |

For tool changes, also read `docs/response-handling-and-safety.md`. For API
changes, verify the affected operations against the current official Etsy API
reference; the coverage matrix is a research baseline, not a frozen API contract.
Keep implemented capabilities distinct from planned ones. A roadmap or task
entry does not authorize unrelated implementation or live Etsy actions.

You can use the mcp tool `etsy-api-dev-information` to retrieve information about the etsy API.

This tool that this workspace is building is also an MCP server. It is setup for you to use for testing, as the tool `mcp-etsy`. It's launched with --watch, so each time you re-build the project, it will automatically be updated for testing. Don't call mutating endpoints at `mcp-etsy`.

## Sub-agent model policy

Use sub-agents only when needed. When delegating, explicitly select the model
and reasoning level for the role:

| Role | Model | Reasoning |
| --- | --- | --- |
| Planning, design, analysis, or review | `gpt-6.1-sol` | Medium |
| Implementation, including code and test changes | `gpt-6-luna` | Maximum |

Resolve these model names and reasoning levels to the harness's available exact
model/variant identifiers before dispatch; do not guess identifiers or silently
substitute models or reasoning levels. If a required configuration is unavailable,
report the blocker and ask the user how to proceed. Split mixed planning/review
and implementation assignments into separate role-appropriate dispatches.

Give each sub-agent its bounded task, applicable documentation paths, and the
requirement to read this file and relevant documentation before work and again
after every context compaction. The coordinating agent remains responsible for
reviewing changes and verification evidence.

## Repository and verification basics

- `src/` is authoritative TypeScript; `test/` contains mocked behavioral tests.
  `build/` is generated and must not be edited as source.
- Follow `CONTRIBUTING.md` and `CHECKLIST.md` for build, test, audit, and review
  requirements. Tests do not require real Etsy credentials or live requests.
- Preserve authorization, fixed-origin networking, bounded data, sanitized errors,
  and untrusted-content protections. Development permission is not authorization
  to perform live account operations, publish packages, or deploy callbacks.
- Update affected documentation when behavior changes; mark planned work complete
  only with implementation and verification evidence.
