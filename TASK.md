# Outstanding Features Implementation Plan

> **For agentic workers:** Use the `executing-plans` skill for inline execution, or `subagent-driven-development` if that execution method is explicitly chosen. Complete the tasks below one at a time and retain verification evidence. This file plans future work; it does not authorize starting implementation or performing live Etsy mutations.

**Goal:** Implement every outstanding feature in [TODO.md](TODO.md), including public discovery, OAuth, inventory, private account access, write operations, and events.

**Architecture:** Preserve the local stdio MCP interface and the existing six tools. Add focused, capability-aware tool groups over fixed-origin Etsy access, with shared connection, authorization, bounded-response, and mutation-safety services. OAuth callbacks and webhook delivery use separately reviewed support components, not a public MCP transport.

**Tech Stack:** Existing Node.js 22+, TypeScript, MCP TypeScript SDK, Axios, and Node.js test runner. Additional secret-storage or callback dependencies require an explicit decision in M3 rather than being assumed installed.

**Spec:** [Roadmap](docs/roadmap.md), [API coverage matrix](docs/api-coverage.md), [access policy](docs/access-policy.md), and the subsystem documents linked below.

**Status:** M0.1 contract analysis and M0.2 reusable test baseline passed independent review; other implementation tasks remain outstanding. M0.1 was committed as `7baf7c2`. Based on the 2026-10-16 catalog, revalidated against official schemas/guides on 2026-10-17: 99 API operations are entirely missing, direct shop-by-ID access is missing on an already-used operation, existing listing tools need extensions, and OAuth/events/shared safety features need supporting implementation. The 105-operation catalog is the coverage baseline, not a target of 105 distinct MCP tools. Restricted/feedback-only operations remain explicit blockers in the [contract audit](docs/contracts/README.md).

## How to use this plan

- `TASK.md` owns implementation ordering, task IDs, dependencies, and completion evidence. [TODO.md](TODO.md) remains the feature checklist; the matrix owns exact operation-to-tool mappings.
- Start with M0. Public milestones M1/M2 and OAuth M3 can then proceed independently. Private reads follow OAuth; every write follows the shared mutation gate and its relevant read paths.
- Milestone order is a recommended delivery sequence, not a requirement to finish unrelated work first. Within a milestone, tasks may proceed independently unless a prerequisite is stated. Do not execute writes merely because read tools or OAuth are available.
- Each task is an independently testable work package. Paired list/detail tools and tightly related operations are grouped where they share the same user workflow and acceptance gate.
- For each task, load only its subsystem document, matching matrix rows, policy, and referenced prerequisite contracts. Refresh that operation's Etsy reference before coding; this plan does not freeze changing schemas, scopes, or migration flags.
- Record the resulting commit/PR or reviewed change, commands/results, and any blocker beside the task when it is finished. Do not check a box because a proposal or test stub exists.
- If current Etsy restrictions prevent an operation, record the concrete blocker and keep the task outstanding. Do not silently remove scope or mark the milestone complete.

## Global constraints

- Preserve compatibility for `search_listings`, `get_listing_details`, `get_shop_by_name`, `get_shop_listings`, `search_shops`, and `get_shop_reviews`; public usage must not acquire an OAuth dependency.
- Preserve positive safe-integer IDs, runtime validation, sanitized errors, and third-party-content boundaries. No generic shell, filesystem, arbitrary URL, or unrestricted HTTP tools.
- Keep TLS verification, redirect blocking, destination-specific credential isolation, and bounded queues/requests/responses. Current baseline: 10-second HTTP attempts, 1 MiB upstream bodies, and 128 KiB JSON tool output. Any justified domain-specific exception needs explicit review and tests; never lift limits globally as a shortcut.
- Account tools accept opaque `connection_id` values, never raw tokens. Enforce actual granted scopes and account/resource boundaries server-side; annotations are not permission checks.
- Mutation approval is operation-specific and bound to account, target, and exact payload. Verify outcomes; do not blindly replay an uncertain mutation or promise atomic concurrency control Etsy does not provide.
- Keep inventory/shipping on their dedicated endpoints, not removed listing includes. Never derive an inventory replacement from a truncated or stale display snapshot.
- Local tests use synthetic credentials and mocks. Live account actions, publication, deletion, notifications, and external callback deployment require separate operator authorization.
- CI remains build/test/audit only; this plan does not authorize package publication.

## Work areas

These are implementation boundaries, not files to create during this planning task. Preserve the current layout until extraction is justified; do not refactor the entire server before delivering a feature.

| Area | Current touchpoints | Responsibility for future tasks |
| --- | --- | --- |
| Tool discovery/dispatch | `src/index.ts` | Register focused tool groups; retain existing names and validate capability availability. |
| Etsy requests | `src/etsy-client.ts` | Fixed-origin authenticated requests, method-aware retries, uploads, safe errors, and quotas. |
| Inputs and results | `src/validation.ts`, existing mappings in `src/index.ts` | Reusable validation, selected output fields, money handling, size bounds, and untrusted-content notices. |
| Connections, confirmations, attachments, events | New focused modules under `src/`, introduced with their owning tasks | Keep secrets and complete write snapshots internal; separate each security boundary from tool presentation. |
| Verification | Existing `test/security.test.js`; focused additional `test/*.test.js` files per capability | Mocked MCP contracts plus transport, authorization, mutation, upload, and receiver tests. |
| User documentation | `docs/`, `TODO.md`, this file, README, changelog | Promote only verified features from planned to current and retain traceability to operation IDs. |

## Review focus

| Failure class | Required behavior | Owning tasks |
| --- | --- | --- |
| Truncated, oversized, or stale records | No fabricated completeness and no destructive replacement from an incomplete source. | M1.1, M1.5, M4.4, M5.3, M6.4 |
| Expired consent or a different account's IDs | Fail safely without scope escalation, token leakage, or cross-account cache reuse. | M3.1–M3.5, M4.1–M4.8 |
| Timeout after a mutation reaches Etsy | Verify whether it happened; never blindly retry creation, deletion, or notification. | M5.2, M6.1, M9.2 |
| Shared profile/policy changes | Show the real affected scope and reject stale or mismatched approval. | M5.1, M5.3, M7.3–M7.9 |
| Forged/replayed callbacks, webhooks, or attachment references | Reject before side effects and never fetch untrusted URLs with credentials. | M3.2, M5.4, M10.1–M10.3 |

## Milestone map

| Milestone | Deliverable | Prerequisites | Exit gate |
| --- | --- | --- | --- |
| M0 | Verified contracts and test baseline | Existing checkout | Each feature has an operation/access contract and a reusable test gate. |
| M1 | Taxonomy, search, batch lookup, and buyer prices | M0 | A bounded category-to-product discovery workflow works without OAuth. |
| M2 | Public shop/product research coverage | M0; M1 for shared batch/mapping helpers where needed | Every remaining public-read workflow has a tested tool. |
| M3 | OAuth and connection lifecycle | M0; approved callback/storage decisions | Connect, inspect, refresh, isolate, and disconnect accounts safely. |
| M4 | Private catalog, inventory, configuration, and account reads | M3; relevant M1/M2 contracts | Complete internal snapshots and minimized public-to-model summaries stay distinct. |
| M5 | Mutation authorization and safe upload foundation | M3; relevant M4 read paths for integration tests | Unauthorized, stale, mismatched, and uncertain writes fail safely. |
| M6 | Listing, inventory, content, and media writes | M5 plus task-specific reads from M1/M2/M4 | Seller catalog workflows are authorized, verified, and preserve unrelated data. |
| M7 | Shop, shipping, processing, and policy writes | M5 plus corresponding M2/M4 reads | Shared-resource impact and destructive constraints are enforced. |
| M8 | Order, transaction, payment, and ledger reads | M3 | Authorized fulfillment queues and financial drill-down work with restricted fields absent. |
| M9 | Fulfillment and address deletion | M5, corresponding M4/M8 reads; carrier lookup for tracking | Consequential account operations require explicit approval and avoid duplicate effects. |
| M10 | Signed events and MCP event access | M3, relevant M2/M4/M8 reads; approved receiver deployment | Verified, bounded, account-isolated events refresh resources safely. |
| M11 | Full-coverage integration and release readiness | M1–M10 | Every outstanding feature has implementation evidence, documentation, and regression coverage. |

## M0 — Contracts and verification baseline

**Outcome:** Turn the research snapshot into precise, reviewable work without changing behavior prematurely.

- [x] **M0.1 — Audit endpoint contracts.** Revalidate all matrix operations and the planned extensions against the current Etsy reference. Record per-operation method/path, required scopes, owner/field restrictions, input bounds, supported flags, response shape, and mutation semantics in the appropriate subsystem contract. **Verify:** every one of the 105 catalog rows is accounted for; removed or restricted operations have explicit blockers rather than invented alternatives. **Evidence (2026-10-17, independent review approved; commit `7baf7c2`):** [official snapshot, provenance and guide findings](docs/contracts/README.md), [105-operation index](docs/contracts/operations.md), machine-readable source-pointer index and original full schemas. `python docs/contracts/audit.py` verifies 105/105 IDs/methods, original SHA-256, all local refs/pointers and reproducible indexes. All six existing-tool extensions and guide-only migration/processing/personalization/payment/callback/event semantics were separately checked. Explicit 501, scope, eligibility, rollout and unit blockers are retained; no product capability is marked shipped. Detailed commands/results and self-review: `.superpowers/sdd/TASK/task-M0.1-report.md`.
- [x] **M0.2 — Establish reusable MCP contract tests.** Extend the existing mocked harness to assert tool discovery, validation-before-request, query/body encoding, selected output, sanitized errors, truncation, and correct safety annotations. **Verify:** all six existing tools retain passing regression tests; a deliberately invalid new-tool fixture is rejected without an upstream request. **Evidence (review approved, M0.2 commit pending):** `npm test` RED was 14 passed/1 expected failure because tool annotations were absent; after adding annotations, GREEN was 15/15 passed. `npm audit --omit=dev --audit-level=high` reported 0 vulnerabilities. The invalid test-owned MCP tool was rejected by schema validation before its handler or mocked upstream adapter ran. Full evidence: `.superpowers/sdd/TASK/task-M0.2-report.md`.
- [ ] **M0.3 — Set the capability boundary.** Define public/account/write/event capability registration and reusable result/money conventions. Keep current public behavior stable; extract focused modules only as needed by the first features. **Verify:** an API-key-only client sees working current tools, absent account capabilities explain their prerequisites, and annotations do not bypass dispatch authorization.

## M1 — Taxonomy and richer listing discovery

**Read:** [Public discovery plan](docs/planned-public-discovery.md). **Requires:** M0. **Task order:** M1.2 follows M1.1; M1.6 follows M1.5; other tasks can be developed independently with shared contracts agreed first.

- [ ] **M1.1 — Browse buyer and seller taxonomies.** Add `get_taxonomy_nodes` with an explicit taxonomy selector, bounded subtree/name filtering, stable IDs/paths, and a reviewed cache/acquisition strategy. **Verify:** distinguish both trees, label local filtering, and handle a tree larger than the upstream/output bounds without silently raising global limits.
- [ ] **M1.2 — Discover category properties.** Add `get_taxonomy_properties` for both taxonomy types, including supported scales, values, and variation constraints. **Verify:** IDs from M1.1 resolve correctly and invalid taxonomy/type combinations fail before requests.
- [ ] **M1.3 — Extend listing search.** Add taxonomy, shop location, safe-content, currency, and buyer-country controls to `search_listings`. **Verify:** fields reach the documented parameters, invalid values fail safely, score remains descending as Etsy documents, and existing keyword/price/page behavior remains compatible.
- [ ] **M1.4 — Enrich listing details and summaries.** Extend `get_listing_details` and selected summaries with documented category, policy/readiness, listing-type, variation, personalization, and localization fields/associations. **Verify:** missing/restricted fields remain absent, existing includes work, and removed inventory/shipping includes remain rejected.
- [ ] **M1.5 — Fetch listing batches.** Add `get_listings_batch` with 1–100 deduplicated IDs and bounded supported associations. **Verify:** ID/result mapping survives reordered/missing results, oversize batches are rejected, whole-request failures are not mislabeled as per-ID success, and truncation is explicit.
- [ ] **M1.6 — Expose buyer-facing price components.** Add `get_listing_buyer_prices` through the supported batch association. **Verify:** buyer country is required, original/converted/display/discount/shipping money stays distinct, null conversion is not zero, and null shipping is not automatically free shipping.

**Milestone acceptance:** A client can discover a category, inspect allowed attributes, search compatible products, inspect a shortlist, and compare buyer-price components without a seller connection or unsupported trend claims.

## M2 — Remaining public research tools

**Read:** [Public discovery plan](docs/planned-public-discovery.md). **Requires:** M0; use M1 helpers where relevant. Confirm each endpoint's public-access contract individually; an OAuth requirement discovered in M0 moves that task behind M3 without dropping its scope.

- [ ] **M2.1 — Direct shop discovery.** Add `get_shop` and `get_shop_by_owner`. **Verify:** numeric lookup does not repeat name search, and the existing bounded exact-name outcomes remain unchanged.
- [ ] **M2.2 — Shop organization and featured catalog.** Add `get_shop_sections`, `get_shop_section`, `get_shop_section_listings`, and `get_featured_shop_listings`. **Verify:** section/shop ownership references, supported paging/sorting, empty sections, and featured-versus-trending distinctions are correct.
- [ ] **M2.3 — Product review samples.** Add `get_listing_reviews`. **Verify:** only documented page/date filters are sent; sample counts, missing fields, untrusted text, and truncation follow current review conventions.
- [ ] **M2.4 — Dedicated media metadata.** Add `get_listing_images`, `get_listing_image`, `get_listing_videos`, and `get_listing_video`, including selected image rank/dimensions/alt text. **Verify:** list/detail IDs match their listing, URLs remain data, and no media download or arbitrary fetch occurs.
- [ ] **M2.5 — Structured listing attributes.** Add `get_listing_properties` and `get_listing_property`. **Verify:** listing/shop/property IDs and scale/value arrays map correctly and remain bounded; do not confuse category-allowed values with listing-selected values. **M0.1 blocker:** single-property `getListingProperty` is feedback-only/501-only in current reference; retain this scope outstanding until Etsy releases it.
- [ ] **M2.6 — Personalization and localization reads.** Add `get_listing_personalization` and `get_listing_translation`. **Verify:** current question/options/add-on pricing and language-tag contracts are represented accurately; seller instructions and translated text remain untrusted.
- [ ] **M2.7 — Return-policy discovery and affected listings.** Add `get_shop_return_policies`, `get_shop_return_policy`, and `get_return_policy_listings`. **Verify:** acceptance/deadline/null values and policy/listing associations are correct; partial enumeration never claims a complete impact list. **M0.1 dependency correction:** only policy list/detail are public; linked-listing lookup requires M3 and `listings_r`, with no paging query declared.
- [ ] **M2.8 — Carrier and connectivity diagnostics.** Add `get_shipping_carriers` and `ping_etsy`. **Verify:** supported country/carrier filters are validated and diagnostics neither leak credentials nor claim that private OAuth access is granted.
- [ ] **M2.9 — Offering drill-down.** Add `get_listing_offering` using its independently verified access contract. **Verify:** listing/product/offering IDs, money, quantity, enabled/deleted state, and readiness references map correctly; do not infer a scope from the related inventory route.

**Milestone acceptance:** Public research covers direct shop, catalog organization, product attributes, reviews, metadata, policies, carriers, and offering lookup while retaining API-key-only operation.

## M3 — OAuth and account connections

**Read:** [OAuth and account plan](docs/planned-oauth-and-accounts.md). **Requires:** M0. **Task order:** M3.1 → M3.2 → M3.3 → M3.4 → M3.5. Do not deploy a callback or connect a live account as an implicit implementation step.

- [ ] **M3.1 — Resolve deployment and consent contracts.** Select a protected credential store, connection ownership model, capability-to-scope bundles, and registered HTTPS callback deployment. Document exact approved destinations and callback access controls. **Verify:** the design supports the intended operator environments and never requires model-visible tokens or plaintext committed secrets; unresolved operator decisions are explicit blockers.
- [ ] **M3.2 — Complete authorization securely.** Implement Authorization Code + PKCE S256, one-time state, callback correlation, and internal code exchange; expose `begin_etsy_connection`. **Verify:** denied consent, state mismatch/replay, expired code, redirect mismatch, and wrong-session callbacks produce no account connection or secret disclosure.
- [ ] **M3.3 — Persist and refresh connections.** Implement protected per-connection storage, actual granted scopes, expiry/refresh, rotated-token persistence, and reconnect outcomes. **Verify:** concurrent refresh does not corrupt credentials, expired/reduced consent cannot elevate scope, and another connection cannot reuse credentials or cached private state.
- [ ] **M3.4 — Expose connection status and local disconnect.** Add `get_etsy_connection_status` and `disconnect_etsy_connection`. **Verify:** status contains only nonsecret account/capability information; disconnect removes local access and cache/confirmation references without falsely claiming upstream revocation.
- [ ] **M3.5 — Inspect scopes and enforce capability access.** Add `get_etsy_token_scopes` using an internally resolved token; integrate per-operation scopes and account/resource checks into discovery and dispatch. **Verify:** missing/changed scopes, wrong connection IDs, cross-client access, direct calls to hidden tools, and token-containing error bodies all fail safely.

**Milestone acceptance:** A test account connection can be created, inspected, refreshed, isolated, and disconnected without exposing credentials; public tools still work with no connection.

## M4 — Private catalog, inventory, shop, and account reads

**Read:** [OAuth](docs/planned-oauth-and-accounts.md), [listing management](docs/planned-listing-management.md), and [shop management](docs/planned-shop-management.md), selecting only the relevant slice. **Requires:** M3. Reads are independently deliverable; M4.4 must establish the complete-snapshot contract used by later inventory writes.

- [ ] **M4.1 — Connected identity and permitted profiles.** Add `get_me` and `get_user`. **Verify:** intended account/shop identity, self/linked-buyer restrictions, `email_r` versus other scopes, and missing separately approved email fields are represented honestly.
- [ ] **M4.2 — Address lists and details.** Add `get_user_addresses` and `get_user_address` with sensitive-field minimization and explicit task-needed detail selection. **Verify:** unauthorized address IDs, paging limits, and absent fields do not expose another account's records.
- [ ] **M4.3 — Authorized catalog states.** Add `list_shop_listings` with documented state/filter controls. **Verify:** own draft/inactive/expired/sold-out views require the correct scopes and public `get_shop_listings` continues to use its existing active route.
- [ ] **M4.4 — Single and batch inventory.** Add `get_listing_inventory` and `get_listings_inventory_batch`; separate complete internal records from bounded model-facing summaries. **Verify:** owner-only SKUs, null inventory, deleted-product controls, 100-ID bounds, whole-batch 404 behavior, third variations, dependency arrays, and processing links; oversized/truncated data cannot be treated as a writable complete snapshot.
- [ ] **M4.5 — Inventory product details.** Add `get_listing_product`. **Verify:** product/listing relationship, offerings, property values, SKU restrictions, and enabled/deleted/readiness states follow the endpoint contract, distinct from M2.9 access rules.
- [ ] **M4.6 — Digital files and variation-image reads.** Add `get_listing_files`, `get_listing_file`, and `get_listing_variation_images`. **Verify:** metadata-only file access, physical-listing empty results, related-resource IDs, and current variation mappings are complete or explicitly incomplete.
- [ ] **M4.7 — Shipping-profile reads.** Add `get_shop_shipping_profiles`, `get_shop_shipping_profile`, `get_listings_shipping_batch`, `get_shipping_profile_destinations`, and `get_shipping_profile_upgrades`. **Verify:** scope/ownership, whole-batch missing-ID failure, foreign-owner nulls, digital-listing absence, profile type, prices, destinations, and delivery ranges remain distinct.
- [ ] **M4.8 — Processing, holidays, and production partners.** Add `get_processing_profiles`, `get_processing_profile`, `get_shop_holiday_preferences`, and `get_shop_production_partners`. **Verify:** physical-only processing links, current migration/rollout rules, US/CA holiday restrictions, paging, and selected partner metadata.

**Milestone acceptance:** Operators can inspect all authorized catalog/configuration/account records needed for later writes, with complete source data retained internally and sensitive or unavailable fields correctly handled.

## M5 — Shared mutation and upload safeguards

**Read:** [Access policy](docs/access-policy.md). **Requires:** M3; use completed M4 reads as integration fixtures. **Task order:** M5.1/M5.2/M5.3 define the shared mutation contract before any account write is enabled; M5.4 is additionally required for upload tasks.

- [ ] **M5.1 — Enforce explicit, payload-bound approval.** Implement previews and confirmations tied to connection, target, operation, changed fields, side effects, and expiration. **Verify:** no approval, replayed/expired approval, changed payload/target/account, and text claiming approval inside Etsy data all cause no mutation.
- [ ] **M5.2 — Handle methods and uncertain outcomes safely.** Add validated write-method request support, correct body encodings, method-aware retries, success/204 handling, and read-back/unknown-outcome reporting. **Verify:** a simulated timeout after Etsy applies a create/update/delete does not blindly resend it; raw errors and credentials never escape.
- [ ] **M5.3 — Guard snapshots and shared-resource impact.** Implement complete-source requirements, stale-read detection, dependency-aware previews, and honest incomplete-impact reporting. **Verify:** truncated inventory and changed profile/policy references invalidate approval; no unproven atomicity or exhaustive impact claim is made.
- [ ] **M5.4 — Constrain attachments and multipart requests.** Define operator-selected attachment handles, MIME/size limits, source lifetime, destination isolation, and safe resource association. **Verify:** arbitrary paths/URLs, wrong-client handles, expired handles, oversized/unsupported files, and redirects are rejected before upload; no generic file-access tool is exposed.

**Milestone acceptance:** A mock mutation cannot execute without correct scope, resource authorization, current payload-bound approval, safe request handling, and applicable complete-source/attachment checks.

## M6 — Listing, inventory, and content writes

**Read:** [Listing-management plan](docs/planned-listing-management.md). **Requires:** M5 and the read paths named per task. Image/video/file tasks additionally require M5.4. Each task must test both approval denial and uncertain-outcome behavior in addition to its feature-specific checks.

- [ ] **M6.1 — Create drafts.** Add `create_draft_listing`; use M1 category contracts and M4 profile/partner reads where required. **Verify:** physical/digital required fields, price/title/tag constraints, correct `listings_w`, and returned draft ID/state; no accidental publication or duplicate draft after a timeout.
- [ ] **M6.2 — Edit, activate, deactivate, and renew listings.** Add `update_listing` using M1.4/M4.3 and applicable M4.7/M4.8 references; publishing a newly created draft also requires M6.9 when an image must first be supplied. **Verify:** only requested fields change; image/processing/shipping/policy prerequisites, publication costs/visibility, and sold-out activation's quantity/renewal effects appear in the preview.
- [ ] **M6.3 — Delete listings.** Add `delete_listing` using M4.3 state/ownership checks and the distinct `listings_d` scope. **Verify:** permitted states, conflict/forbidden outcomes, explicit deletion confirmation, and honest not-found/read-back interpretation.
- [ ] **M6.4 — Replace inventory safely.** Add `update_listing_inventory` using M4.4/M4.5 and M4.8 processing references. **Verify:** unaffected variants survive; third variations, scale validation, decimal price encoding, all dependency arrays, SKUs, quantity/enabled states, and readiness links are consistent; incomplete/stale sources cannot produce a replacement.
- [ ] **M6.5 — Set and remove attributes.** Add `update_listing_property` and `delete_listing_property` using M1.2/M2.5. **Verify:** allowed scale/value IDs, listing ownership, endpoint-specific scopes, and preservation of unrelated properties.
- [ ] **M6.6 — Configure personalization.** Add `update_listing_personalization` and `delete_listing_personalization` using M2.6. **Verify:** supported question types/options, required flags, character/file limits, add-on prices, removal semantics, and current rather than deprecated schemas.
- [ ] **M6.7 — Create/update translations.** Add `create_listing_translation` and `update_listing_translation` using M2.6. **Verify:** language validation, create-versus-update behavior, bounded localized fields, and no implicit source-language replacement.
- [ ] **M6.8 — Map variation images.** Add `update_variation_images` using M4.6, M4.4, and M2.4. **Verify:** listing-owned image/property references, complete mapping semantics, and preservation of unrelated valid mappings.
- [ ] **M6.9 — Upload/assign/remove images.** Add `upload_listing_image` and `delete_listing_image` using M2.4. **Verify:** attachment/existing-image selection, rank/alt-text rules, ID relationships, and last-image consequences; do not claim the underlying Etsy binary was erased.
- [ ] **M6.10 — Upload/assign/remove videos.** Add `upload_listing_video` and `delete_listing_video` using M2.4. **Verify:** supported format/size/count restrictions, association/processing states, and removal outcomes without uncontrolled binary fetching.
- [ ] **M6.11 — Upload/assign/remove digital files.** Add `upload_listing_file` and `delete_listing_file` using M4.6. **Verify:** digital-listing constraints, supported type/size/rank, existing-file association, and last-file availability consequences before confirmation.

**Milestone acceptance:** A seller can manage draft/publication lifecycle, whole inventory, structured/localized content, personalization, media, and digital assets through narrowly authorized, verified actions.

## M7 — Shop, shipping, processing, and policy writes

**Read:** [Shop-management plan](docs/planned-shop-management.md). **Requires:** M5 plus the matching reads below. Shared-resource previews must show whether affected-listing enumeration is complete. Account write scopes must be checked per operation, including deletions.

- [ ] **M7.1 — Edit shop settings.** Add `update_shop` using M2.1. **Verify:** only supported requested fields change, language/ownership constraints hold, and unrelated messages/settings remain intact.
- [ ] **M7.2 — Manage shop sections.** Add `create_shop_section`, `update_shop_section`, and `delete_shop_section` using M2.2. **Verify:** title/rank rules, shop-specific references, conflicts, and catalog-organization effects of removal.
- [ ] **M7.3 — Manage shipping profiles.** Add `create_shop_shipping_profile`, `update_shop_shipping_profile`, and `delete_shop_shipping_profile` using M4.7. **Verify:** origin/postal-code and linkage constraints, shared-listing impact, and explicit rejection of unsupported calculated-template creation.
- [ ] **M7.4 — Manage shipping destinations.** Add `create_shipping_profile_destination`, `update_shipping_profile_destination`, and `delete_shipping_profile_destination` using M4.7/M2.8. **Verify:** country/region alternatives, primary/secondary costs, carrier/mail-class or delivery-range requirements, and loss of coverage across linked listings.
- [ ] **M7.5 — Manage shipping upgrades.** Add `create_shipping_profile_upgrade`, `update_shipping_profile_upgrade`, and `delete_shipping_profile_upgrade` using M4.7/M2.8. **Verify:** domestic/international type, prices, ranks, language/delivery rules, and linked-listing upgrade impact.
- [ ] **M7.6 — Manage processing profiles.** Add `create_processing_profile`, `update_processing_profile`, and `delete_processing_profile` using M4.8/M4.4. **Verify:** readiness/time/unit constraints, physical-only linkage, current rollout flags, and reassignment/deletion effects on offerings.
- [ ] **M7.7 — Set holiday processing preferences.** Add `update_shop_holiday_preference` using M4.8. **Verify:** supported region/holiday IDs, authorized preference changes, and clear unsupported-region outcomes.
- [ ] **M7.8 — Manage return policies.** Add `create_shop_return_policy`, `update_shop_return_policy`, and `delete_shop_return_policy` using M2.7. **Verify:** return/exchange/deadline combinations, linked-listing impact, and rejection of deletion when Etsy requires an unattached policy.
- [ ] **M7.9 — Consolidate return policies.** Add `consolidate_shop_return_policies` using M2.7 and M7.8 contracts. **Verify:** source/destination ownership and differences, affected-listing evidence, explicit reassignment confirmation, conflicts, and outcome verification without automatic replay.

**Milestone acceptance:** All supported configuration writes work with dependency-aware previews, verified outcomes, and no implied legal-compliance or unsupported shipping-label guarantees.

## M8 — Orders, transactions, and financial reads

**Read:** [Orders/payments plan](docs/planned-orders-and-payments.md). **Requires:** M3. M8.1/M8.2 establish receipt contracts used by transaction/payment relationship tests; unrelated read-tool implementation may proceed independently.

- [ ] **M8.1 — Filter and synchronize receipts.** Add `get_shop_receipts`. **Verify:** supported created/modified ranges, paid/shipped/delivered/canceled filters, receipt-specific sorting, paging, and overlap/deduplication guidance without snapshot-consistency claims.
- [ ] **M8.2 — Inspect receipts and purchased listings.** Add `get_shop_receipt` and `get_receipt_listings`. **Verify:** IDs and receipt/listing relationships, selected totals/shipments, unauthorized ownership rejection, and usable summaries when regional address/email approval is absent.
- [ ] **M8.3 — Read purchased transactions.** Add `get_shop_transactions`, `get_receipt_transactions`, `get_listing_transactions`, and `get_shop_transaction`. **Verify:** shop/receipt/listing/transaction scoping, supported paging, selected variation/SKU/quantity data, and no competitor private-sales access or confusion between orders and line items.
- [ ] **M8.4 — Read payment relationships.** Add `get_shop_payments`, `get_receipt_payment`, and `get_ledger_entry_payments`. **Verify:** required payment-ID selection, null/no-payment ledger relationships, original/posted/adjusted amounts, currencies, and minimized buyer fields; no invented unfiltered payment crawl.
- [ ] **M8.5 — Inspect dated ledger movements.** Add `get_shop_ledger_entries` and `get_shop_ledger_entry`. **Verify:** required minimum/maximum dates, paging and sequence IDs, reference relationships to M8.4, field-specific integer units, and reconciliation without equating net payment to profit.

**Milestone acceptance:** Authorized users can inspect fulfillment queues and reconcile receipt/transaction/payment/ledger relationships with field permissions, timestamps, money units, and sample completeness preserved.

## M9 — Fulfillment and account deletion actions

**Read:** [Orders/payments](docs/planned-orders-and-payments.md) and [account plan](docs/planned-oauth-and-accounts.md). **Requires:** M5, M8.1/M8.2 for fulfillment, M2.8 for carrier references, and M4.2 for addresses. Tasks are independent once their matching reads are ready.

- [ ] **M9.1 — Update supported receipt flags.** Add `update_shop_receipt`. **Verify:** explicit paid/shipped changes and `transactions_w`, already-shipped/conflicting states, confirmation, and read-back; do not imply arbitrary cancellation/refund/status editing.
- [ ] **M9.2 — Submit shipment tracking.** Add `create_receipt_shipment`. **Verify:** receipt/carrier/tracking validation, current shipment checks, buyer-notification preview, and no duplicate shipment or notification after an uncertain timeout; this is not label purchase.
- [ ] **M9.3 — Delete an authorized address.** Add `delete_user_address`. **Verify:** actual delete-scope requirements, address ownership, explicit target confirmation, conflicts/not-found outcomes, and no accidental disclosure of other saved addresses.

**Milestone acceptance:** Each consequential action has its own authorization, confirmation, side-effect explanation, and safe failure/unknown-outcome behavior.

## M10 — Verified event delivery and MCP access

**Read:** [Event plan](docs/planned-orders-and-payments.md#events-and-change-notifications). **Requires:** M3 and relevant listing/product/receipt reads from M2/M4/M8. **Task order:** M10.1 → M10.2 → M10.3 → M10.4. Portal access and receiver deployment are external gates, not extra REST operations to invent.

- [ ] **M10.1 — Define and provision the receiver boundary.** Select a reviewed HTTPS deployment, protected signing-secret storage, portal subscription setup, allowed event types, and account binding. **Verify:** operator approval/eligibility and actual event availability are recorded; MCP stays local stdio and pending external access remains an explicit blocker.
- [ ] **M10.2 — Verify incoming deliveries.** Implement raw-body signature verification, timestamp/replay checks, deduplication, and bounded request handling before processing. **Verify:** bad/missing signatures, stale/future timestamps, malformed/oversized bodies, cross-shop events, and duplicate deliveries cannot trigger resource reads or writes improperly.
- [ ] **M10.3 — Retain events and refresh safely.** Add account-isolated bounded storage, opaque cursor semantics, retention/acknowledgment/overflow rules, and resource refresh through reconstructed approved routes. **Verify:** delayed/out-of-order/duplicate/deletion events work, arbitrary `resource_url` values are never fetched, and events never authorize mutations.
- [ ] **M10.4 — Expose event queue and health.** Add `get_etsy_events` and `get_etsy_event_status`. **Verify:** connection/cursor isolation, bounded pages, expired cursors, receiver outages, empty queues, and overflow/data-loss notices; cover documented order/listing/inventory event families.

**Milestone acceptance:** Approved order, listing, and inventory events become authenticated, deduplicated, bounded notifications accessible through MCP, with honest delivery/completeness status.

## M11 — Complete coverage and release readiness

**Requires:** M1–M10. This is a cross-feature integration gate, not a substitute for verifying individual tasks as they ship.

- [ ] **M11.1 — Audit end-to-end coverage.** Match tool registrations and passing contract tests to every matrix operation, each TODO feature, existing-tool extension, and OAuth/event support capability. **Verify:** all 99 previously missing operations and direct shop access are implemented or explicitly still blocked; no unchecked task is hidden by a completed milestone or an invented unsupported tool.
- [ ] **M11.2 — Exercise cross-feature workflows and adversarial paths.** Test category-to-draft-to-publication, complete inventory updates with processing links, shared shipping/policy edits, order-to-payment/ledger drill-down, approved tracking, disconnect/reconnect, and event-driven refresh. **Verify:** public regression compatibility, cross-account denial, secret redaction, untrusted text, size limits, and unknown mutation outcomes across the combined system.
- [ ] **M11.3 — Prepare documentation and release evidence.** Reconcile current/planned docs, matrix statuses, TODO and task evidence; document connection/storage/callback/upload/event setup, permissions, migration/breaking changes, and operator recovery. **Verify:** `npm ci --ignore-scripts`, `npm run build`, `npm test`, and `npm audit --omit=dev --audit-level=high` pass under supported CI Node.js versions; docs links resolve and CI still does not publish. Separately authorized live checks, where needed, have recorded results or explicit blockers.

**Milestone acceptance:** No required scope remains unimplemented, blocked, or falsely marked done. Any Etsy-imposed restriction remains visible rather than being treated as delivered functionality. Release/version decisions follow the project's compatibility policy; completing this document does not itself publish a release.

## Required workflow for every task

1. Confirm prerequisites and read the exact endpoint/capability contract. Resolve security/deployment decisions before code that depends on them.
2. Write the task's positive, validation, authorization, bounds/redaction, and listed edge-case tests first; run them and observe the expected failures.
3. Implement the smallest feature slice and register only usable capabilities. Do not broaden credentials, network origins, filesystem access, or retry behavior incidentally.
4. Run the focused tests and `npm test`; run relevant security/dependency checks when those surfaces change. A pass requires zero unexpected failures, not merely a completed command.
5. Review the change, document evidence, and update the affected current feature slice, matrix, TODO, this task, README, and changelog. Commit the coherent work package only when authorized by the execution workflow.

Milestones have no promised calendar dates or estimates: account approvals, callback deployment, protected storage, and Etsy rollout restrictions must be resolved before a reliable schedule can be assigned. Start with M0; do not start the entire backlog as one undifferentiated implementation task.
