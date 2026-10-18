# Feature roadmap and sequencing

**Status: planned work remains.** The twenty-nine public tools remain available by default. After operator setup, conditional OAuth consent and reviewed local status/disconnect controls are implemented (M3.4 complete). The internal scope-authorization core is reviewed and complete (M3.5a); no private resource handler invokes it. The scope diagnostic is blocked by the empty official response contract (M3.5b), so parent M3.5 and overall M3 remain open. Private reads, inventory, and writes remain planned under the revised [policy](access-policy.md). Tool names outside the [current public set](overview.md) are proposals unless explicitly marked conditional/current.

## Research basis and coverage

On 2026-10-16, the `etsy-api-dev-information` MCP catalog listed **105 operations**. The [matrix](api-coverage.md) accounts for every one. The twenty-nine current public MCP tools reach twenty-nine distinct API operations; `getShop` is directly available as well as internally used by exact-name lookup, and owner-ID lookup uses `getShopByOwnerUserId`. The conditional `begin_etsy_connection` tool is non-catalog OAuth orchestration, but its internal identity check reaches the cataloged `getMe` operation when OAuth is enabled and ready: **30 cataloged operations are reachable and 75 remain unreached**. The default public-only configuration reaches 29 operations and leaves 76 unreached. The direct `get_me` tool remains planned for M4, and `tokenScopes` remains planned/unreached.

The initial research used the MCP catalog and selected guides. M0.1 subsequently revalidated all 105 IDs/methods against the current official OpenAPI document on 2026-10-17 and retained all exact schemas in the [contract audit](contracts/README.md), with per-operation indexes and separately inspected guide semantics. Read that audit before implementation; its 501-only, scope-conflict, ownership, financial-unit and rollout blockers override optimistic assumptions in the original feature grouping. Re-fetch affected contracts before coding; this dated snapshot is not a perpetual API guarantee.

## Delivery sequence

These are suggested priorities, not a restriction on the permitted feature set. Public additions may proceed independently of account access; private reads and mutations depend on the OAuth foundation.

The detailed [implementation tasks and milestones](../TASK.md) expand these phases into dependency-ordered work packages with task IDs, concrete deliverables, verification requirements, and milestone exit gates.

| Phase | Deliverable | Dependencies | Completion evidence |
| --- | --- | --- | --- |
| 1 | [Public discovery expansion](planned-public-discovery.md) | Existing API-key access. | Each new public tool is discoverable, has bounded results, rejects invalid input, and works in mocked MCP tests. |
| 2 | [OAuth and account foundation](planned-oauth-and-accounts.md) | Reviewed consent/callback and secret-storage design. | Conditional browser consent, durable callback completion, internal refresh, local status/disconnect, and the authorization core are verified and reviewed; the scope diagnostic remains blocked by its empty official response contract. Overall M3 acceptance remains open; private resource integration is M4+. |
| 3 | Private listing, inventory, shipping, processing, order, and payment reads. | Phase 2 plus the relevant read scopes. | Ownership/field restrictions and complete-versus-truncated data are represented accurately. |
| 4 | [Listing and inventory writes](planned-listing-management.md). | Phases 2–3; confirmation and outcome-verification controls. | Draft, publish/update/delete, variation replacement, and media/file workflows have positive, denial, and uncertain-outcome tests. |
| 5 | [Shop configuration](planned-shop-management.md) and [fulfillment writes](planned-orders-and-payments.md). | Phase 2 and the corresponding read-before-write paths. | Shared-resource impact, destructive changes, buyer notifications, and conflict handling are tested. |
| 6 | [Event-backed access](planned-orders-and-payments.md#events-and-change-notifications). | OAuth, approved webhook setup, a reviewed HTTPS receiver, and resource read tools. | Signature/replay checks, deduplication, account isolation, and safe refresh are verified. |

## MCP surface principles

- Use explicit snake_case tool names, preserving all twenty-nine public tools and behavior by default unless a separately documented breaking change is necessary. Optional account-consent controls remain conditional on operator configuration.
- Group discovery into public, account, catalog, shop configuration, order, and finance domains. Advertise only usable capability sets; provide a safe connection-status explanation for disabled/missing-scope features.
- All account tools take an opaque `connection_id`, not raw tokens. Additional resource IDs, filters, and changes are defined in the subsystem plans.
- Keep list/detail pairs where they support different tasks. Do not add unsupported CRUD verbs just for symmetry; some Etsy families are read-only or expose deletion but no creation.
- Prefer one bounded page or batch per call. A caller can deliberately assemble a larger workflow rather than triggering an unlimited crawl or bulk mutation.
- Keep public product lookup separate from private inventory and shipping access. Do not restore removed `Inventory`/`Shipping` listing includes.

## Definition of done for each feature

- [ ] Recheck the exact Etsy operation, required scopes, field restrictions, and current migration state.
- [ ] Specify the MCP tool name, required inputs, selected output fields, pagination, and safety annotations.
- [ ] Add mocked tests first: success, input rejection, access denial, size limits, sanitized errors, and applicable mutation/ownership cases.
- [ ] Implement and register only the planned capability, preserving fixed-origin and untrusted-content protections.
- [ ] Verify the resulting behavior with `npm test`; use separately authorized live smoke tests only when appropriate, never as a prerequisite for ordinary local tests.
- [ ] Update the feature slice, coverage status, [TODO](../TODO.md), README, and changelog. A documented proposal is not a shipped feature.

## Source references

- [Official API reference](https://developers.etsy.com/documentation/reference/) — operation identifiers in the matrix can be located here.
- [Authentication](https://developers.etsy.com/documentation/essentials/authentication/) — consent, PKCE, refresh, and scopes.
- [Inventory/shipping data migration](https://developers.etsy.com/documentation/tutorials/inventory-shipping-migration/) — dedicated OAuth endpoints replacing removed includes. The MCP guide ID is `tutorials/inventory-shipping-data-migration`; its public URL uses a different slug.
- [Processing profiles migration](https://developers.etsy.com/documentation/tutorials/migration/) — distinguish processing readiness from shipping profiles; check current rollout status before use.
- [Webhooks](https://developers.etsy.com/documentation/essentials/webhooks/) — events, delivery verification, and portal setup.

“All functionality” means the documented API catalog and separately documented auth/events, not undocumented website behavior. No supported trending, buyer checkout/cart, messaging, review-write, refund-initiation, or shipping-label-purchase operation appeared in this catalog. Do not invent those tools from a scope name or a response field.
