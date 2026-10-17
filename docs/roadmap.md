# Feature roadmap and sequencing

**Status: planned, not implemented.** All tool names outside the [current six](overview.md) are proposals. Scope includes OAuth, inventory, private reads, and writes under the revised [policy](access-policy.md).

## Research basis and coverage

On 2026-10-16, the `etsy-api-dev-information` MCP catalog listed **105 operations**. The [matrix](api-coverage.md) accounts for every one. The current six MCP tools reach six distinct API operations: five directly and `getShop` indirectly through exact-name lookup. **99 cataloged operations are not reached at all**; direct shop-by-ID access is an additional MCP-surface gap on an already-used operation.

Research used `learn_etsy_api`, the complete `list_endpoints` inventory, selected `get_endpoint` details, and the authentication, inventory/shipping data migration, processing-profile migration, and webhook guides. Endpoint details were examined for important access and behavior boundaries, not every request schema for all 105 operations. Before implementing each tool, re-fetch its exact operation details, constraints, and scope requirements. These high-level access plans deliberately do not freeze every low-level field or migration flag.

## Delivery sequence

These are suggested priorities, not a restriction on the permitted feature set. Public additions may proceed independently of account access; private reads and mutations depend on the OAuth foundation.

The detailed [implementation tasks and milestones](../TASK.md) expand these phases into dependency-ordered work packages with task IDs, concrete deliverables, verification requirements, and milestone exit gates.

| Phase | Deliverable | Dependencies | Completion evidence |
| --- | --- | --- | --- |
| 1 | [Public discovery expansion](planned-public-discovery.md) | Existing API-key access. | Each new public tool is discoverable, has bounded results, rejects invalid input, and works in mocked MCP tests. |
| 2 | [OAuth and account foundation](planned-oauth-and-accounts.md) | Reviewed consent/callback and secret-storage design. | Connection, denied consent, refresh, disconnect, account isolation, and missing-scope paths are tested without leaking secrets. |
| 3 | Private listing, inventory, shipping, processing, order, and payment reads. | Phase 2 plus the relevant read scopes. | Ownership/field restrictions and complete-versus-truncated data are represented accurately. |
| 4 | [Listing and inventory writes](planned-listing-management.md). | Phases 2–3; confirmation and outcome-verification controls. | Draft, publish/update/delete, variation replacement, and media/file workflows have positive, denial, and uncertain-outcome tests. |
| 5 | [Shop configuration](planned-shop-management.md) and [fulfillment writes](planned-orders-and-payments.md). | Phase 2 and the corresponding read-before-write paths. | Shared-resource impact, destructive changes, buyer notifications, and conflict handling are tested. |
| 6 | [Event-backed access](planned-orders-and-payments.md#events-and-change-notifications). | OAuth, approved webhook setup, a reviewed HTTPS receiver, and resource read tools. | Signature/replay checks, deduplication, account isolation, and safe refresh are verified. |

## MCP surface principles

- Use explicit snake_case tool names, preserving the existing six names and behavior unless a separately documented breaking change is necessary.
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
