# Unimplemented features

This is the feature backlog, not a list of tools currently available. Entries below are **unimplemented** unless checked off; `get_taxonomy_nodes` is now implemented as recorded under M1.1 in [TASK.md](TASK.md). The revised [policy](docs/access-policy.md) permits OAuth, inventory, private reads, and writes. Changing that policy did not implement them.

Use the [documentation index](docs/index.md) to load only the relevant slice, the [roadmap](docs/roadmap.md) for sequencing/acceptance criteria, and the [105-operation matrix](docs/api-coverage.md) for exact upstream mappings. The checklist groups related tools; the matrix is the exhaustive operation-level inventory. Check off a group only when all named capabilities in it are implemented, tested, and documented as current.

For dependency-ordered implementation tasks and milestone exit gates, use [TASK.md](TASK.md). This file tracks feature coverage; TASK.md tracks the work packages and their verification evidence.

## Foundation and authorization — [plan](docs/planned-oauth-and-accounts.md)

- [x] Optional startup-only read-only testing lock (`ETSY_DEVELOPMENT_MODE=true`) for write-capability dispatch and mutating HTTP methods (M0.4; does not authorize or add mutations).
- [ ] OAuth Authorization Code + PKCE S256, single-use state validation, and a registered HTTPS callback.
- [ ] Protected per-connection credential storage, expiry/refresh lifecycle, granted-scope tracking, and reconnect handling.
- [ ] Account/connection isolation, least-privilege scope bundles, resource authorization, and capability-aware tool discovery.
- [ ] Connection controls: `begin_etsy_connection`, `get_etsy_connection_status`, `disconnect_etsy_connection`.
- [ ] Application connectivity: `ping_etsy`.
- [ ] Internal-token scope inspection: `get_etsy_token_scopes`.
- [ ] Shared mutation authorization, payload-bound confirmations, read-back verification, and uncertain-outcome handling.
- [ ] Accurate new-tool safety annotations, sensitive-field minimization, and validated attachment handles for uploads.

## Public discovery — [plan](docs/planned-public-discovery.md)

- [ ] Extend `search_listings` with taxonomy, shop location, safe-content, currency, and buyer-country controls.
- [ ] Extend listing detail/summary output with selected documented category, policy/readiness, variation, personalization, and localization information.
- [x] Buyer/seller taxonomy browsing and bounded local filtering: `get_taxonomy_nodes` (M1.1; verification in [TASK.md](TASK.md)).
- [x] Buyer/seller property/scale/value discovery: `get_taxonomy_properties` (M1.2; verification in [TASK.md](TASK.md)).
- [ ] Batch listing lookup: `get_listings_batch`.
- [ ] Buyer-country-aware price components: `get_listing_buyer_prices`.
- [ ] Direct shop/owner lookup: `get_shop`, `get_shop_by_owner`.
- [ ] Featured products: `get_featured_shop_listings`.
- [ ] Section browsing: `get_shop_sections`, `get_shop_section`, `get_shop_section_listings`.
- [ ] Listing-specific feedback: `get_listing_reviews`.
- [ ] Dedicated image metadata, including rank/dimensions/alt text: `get_listing_images`, `get_listing_image`.
- [ ] Dedicated video metadata: `get_listing_videos`, `get_listing_video`.
- [ ] Structured attribute reads: `get_listing_properties`, `get_listing_property`.
- [ ] Personalization question/option/add-on reads: `get_listing_personalization`.
- [ ] Existing localized listing content: `get_listing_translation`.
- [ ] Public return-policy reads: `get_shop_return_policies`, `get_shop_return_policy`; OAuth `listings_r` linked listings: `get_return_policy_listings` (no paging query declared). See [M0.1 contract corrections](docs/contracts/README.md#public-discovery-blockers-and-routing-corrections).
- [ ] Shipping carrier/mail-class discovery: `get_shipping_carriers`.

## Listings and inventory — [plan](docs/planned-listing-management.md)

- [ ] Authorized catalog browsing by state: `list_shop_listings`.
- [ ] Draft creation: `create_draft_listing`.
- [ ] Listing edits, publication/deactivation, supported renewal and profile/policy associations: `update_listing`.
- [ ] Listing deletion with distinct delete scope: `delete_listing`.
- [ ] Single/batch inventory reads with owner-only SKU rules: `get_listing_inventory`, `get_listings_inventory_batch`.
- [ ] Product/offering drill-down: `get_listing_product`, `get_listing_offering`.
- [ ] Complete inventory replacement: `update_listing_inventory`, including third variations, dependency arrays, scale checks, processing links, and truncated/stale-snapshot safeguards.
- [ ] Attribute mutation/removal: `update_listing_property`, `delete_listing_property`.
- [ ] Current personalization question/add-on configuration: `update_listing_personalization`, `delete_listing_personalization`.
- [ ] Translation creation/update: `create_listing_translation`, `update_listing_translation`.
- [ ] Variation-image associations: `get_listing_variation_images`, `update_variation_images`.
- [ ] Image upload/assignment/removal: `upload_listing_image`, `delete_listing_image`.
- [ ] Video upload/assignment/removal: `upload_listing_video`, `delete_listing_video`.
- [ ] Digital-file metadata: `get_listing_files`, `get_listing_file`.
- [ ] Digital-file upload/assignment/removal: `upload_listing_file`, `delete_listing_file`.

## Shop, shipping, processing, and policies — [plan](docs/planned-shop-management.md)

- [ ] Shop settings/messages: `update_shop`.
- [ ] Section creation/editing/removal: `create_shop_section`, `update_shop_section`, `delete_shop_section`.
- [ ] Production-partner discovery: `get_shop_production_partners`.
- [ ] Shipping-profile reads: `get_shop_shipping_profiles`, `get_shop_shipping_profile`.
- [ ] Dedicated OAuth batch shipping lookup: `get_listings_shipping_batch`.
- [ ] Shipping-profile management: `create_shop_shipping_profile`, `update_shop_shipping_profile`, `delete_shop_shipping_profile`.
- [ ] Shipping destination reads/management: `get_shipping_profile_destinations`, `create_shipping_profile_destination`, `update_shipping_profile_destination`, `delete_shipping_profile_destination`.
- [ ] Shipping upgrade reads/management: `get_shipping_profile_upgrades`, `create_shipping_profile_upgrade`, `update_shipping_profile_upgrade`, `delete_shipping_profile_upgrade`.
- [ ] Processing-profile reads: `get_processing_profiles`, `get_processing_profile`.
- [ ] Processing-profile management: `create_processing_profile`, `update_processing_profile`, `delete_processing_profile`, subject to current Etsy rollout/constraints.
- [ ] Regional holiday preferences: `get_shop_holiday_preferences`, `update_shop_holiday_preference`.
- [ ] Return-policy management: `create_shop_return_policy`, `update_shop_return_policy`, `delete_shop_return_policy`.
- [ ] Multi-listing return-policy reassignment: `consolidate_shop_return_policies`.
- [ ] Shared-profile/policy impact previews and dependency-aware conflict handling.

## Orders, finance, and events — [plan](docs/planned-orders-and-payments.md)

- [ ] Filtered receipt lists and details: `get_shop_receipts`, `get_shop_receipt`.
- [ ] Receipt-linked product lookup: `get_receipt_listings`.
- [ ] Shop/receipt/listing transaction reads: `get_shop_transactions`, `get_receipt_transactions`, `get_listing_transactions`, `get_shop_transaction`.
- [ ] Supported paid/shipped flag changes: `update_shop_receipt`.
- [ ] Tracking submission and buyer-notification safeguards: `create_receipt_shipment`.
- [ ] Payment reads by explicit IDs, receipt, and ledger relationship: `get_shop_payments`, `get_receipt_payment`, `get_ledger_entry_payments`.
- [ ] Dated ledger reads/details: `get_shop_ledger_entries`, `get_shop_ledger_entry`.
- [ ] Protected buyer-field handling and currency/unit-aware reconciliation output.
- [ ] Reviewed HTTPS webhook receiver, operator portal setup, signature/replay checks, deduplication, safe resource refresh, and bounded account-isolated retention.
- [ ] Event queue/health access: `get_etsy_events`, `get_etsy_event_status`.

## User/account records — [plan](docs/planned-oauth-and-accounts.md#user-and-address-tools)

- [ ] Connected identity and permitted profile lookup: `get_me`, `get_user`.
- [ ] Authorized address lists/details: `get_user_addresses`, `get_user_address`.
- [ ] Confirmed address deletion: `delete_user_address` (blocked pending reference `address_r` versus guide `address_w` conflict clarification; see [contract audit](docs/contracts/README.md#account-callback-and-token-contracts)).

Unsupported website-only or undocumented actions are not silently promised backlog items. In particular, no supported trending, cart/checkout, messaging, review-write, refund-initiation, or shipping-label-purchase operation was found in the researched catalog. Revisit only if Etsy documents an appropriate API.
