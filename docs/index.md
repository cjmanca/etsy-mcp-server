# Documentation index

Start here and load only the slices relevant to your task. **Current** documents describe the seven public tools implemented in `src/`. **Policy** defines permitted development scope. **Planned** documents describe unimplemented tools, not callable functionality. The 2026-10-16 MCP catalog was revalidated against the official OpenAPI document and relevant guides on 2026-10-17; see the contract audit for restrictions and unresolved differences.

| Document | Status | Read when your task is to… |
| --- | --- | --- |
| [Project overview](overview.md) | Current | Understand the product, supported workflows, and boundaries before choosing a tool. |
| [Setup and access](setup-and-access.md) | Current | Connect an MCP client, configure credentials, or diagnose startup and connectivity problems. |
| [Listing discovery and details](listing-discovery.md) | Current | Search products, compare prices, inspect a listing, or retrieve its image/video metadata. |
| [Shop discovery and catalogs](shops.md) | Current | Resolve a shop name, distinguish search from exact lookup, or browse a shop's active products. |
| [Shop reviews](reviews.md) | Current | Retrieve dated review samples and explain the limits of reputation analysis. |
| [Response handling and safety](response-handling-and-safety.md) | Current | Interpret JSON, pagination, incomplete results, truncation, errors, or untrusted Etsy content. |
| [Access and operation policy](access-policy.md) | Policy | Add OAuth, inventory, private-data, or write capabilities without weakening authorization and safety boundaries. |
| [Feature roadmap and sequencing](roadmap.md) | Planned | Choose a subsystem to build, understand dependencies, or check the definition of done. |
| [Implementation tasks and milestones](../TASK.md) | Planned | Choose the next implementable task, check prerequisites, and record milestone completion evidence across the complete backlog. |
| [Public discovery expansion](planned-public-discovery.md) | Current + planned | Browse taxonomy nodes; add richer searches, batch lookups, buyer prices, listing reviews, public sections, or richer media metadata. |
| [OAuth and account access](planned-oauth-and-accounts.md) | Planned | Plan account connection, consent, token lifecycle, identity, scope inspection, or address access. |
| [Listing, inventory, and media management](planned-listing-management.md) | Planned | Add non-public catalogs, SKU/variation inventory, listing lifecycle writes, personalization, translations, or media/file management. |
| [Shop, shipping, and policy management](planned-shop-management.md) | Planned | Add shop settings, sections, production partners, shipping destinations/upgrades, processing profiles, holidays, or return-policy management. |
| [Orders, payments, and events](planned-orders-and-payments.md) | Planned | Add receipts, transactions, fulfillment updates, financial reconciliation, or webhook-backed event access. |
| [Complete API coverage matrix](api-coverage.md) | Current + planned | Find the proposed MCP surface for any of the 105 cataloged API operations, or check whether access is direct, indirect, or missing. |
| [Verified operation contracts and audit findings](contracts/README.md) | Research, not implementation | Before endpoint implementation/review, inspect all 105 exact method/path/input/scope/response contracts, guide semantics, six existing-tool extension checks, and explicit release blockers. Includes the original checksum-pinned official OpenAPI snapshot and offline coverage verification. |
| [Unimplemented-feature checklist](../TODO.md) | Planned | Select or track outstanding features; each group links to its focused access plan. |

For a multi-step task, combine only the applicable feature slice with response handling. Setup is needed only when configuring or troubleshooting the connection. Existing root-level [README](../README.md), [examples](../EXAMPLES.md), and [changelog](../CHANGELOG.md) remain useful entry points.

For a feature addition, read the policy, the relevant planned subsystem, and the matching coverage rows. Do not ingest every subsystem just to implement one tool. This index links every other new documentation file, including the root TODO list.
