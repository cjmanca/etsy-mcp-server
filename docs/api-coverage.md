# Complete Etsy API coverage matrix

**Catalog baseline: 2026-10-16 MCP, 105 operations; all 105 IDs/methods revalidated against the official OpenAPI document on 2026-10-17.** This is a routing/coverage reference, not a claim that all tools exist. The [contract audit](contracts/README.md), [per-operation index](contracts/operations.md), and checksum-pinned original schema record inputs, scopes, responses, flags, guide restrictions and explicit blockers. Revalidate affected contracts before implementation.

- **Current:** registered MCP access exists, with the limited fields/options described in current documentation; not necessarily every upstream parameter.
- **Indirect:** the API is called internally, but the proposed direct tool does not exist.
- **Planned:** no current access to this API operation. All names in planned rows are proposals.
- The twenty-nine default public tools reach twenty-nine distinct Etsy API operations; `getShop` is directly available as well as internally used by exact-name lookup. The conditional non-catalog orchestration tool `begin_etsy_connection` internally calls the cataloged `getMe` operation for identity verification when OAuth is enabled and ready, bringing reachable catalog operations to **30**, with **75 remaining Planned/unreached** (including explicitly blocked/deferred routes). The default public-only configuration reaches 29 operations and leaves 76 unreached. The direct `get_me` tool remains planned for M4; `tokenScopes` remains unreached and is not counted as implemented coverage.

Read the linked subsystem and its contract-audit findings for proposed inputs, outputs, permissions, dependencies, and acceptance criteria. M0.1 retains every operation's full original schema and separately records field/owner restrictions and unresolved guide/reference differences; schema presence does not prove live availability. In particular, `getListingProperty` is feedback-only/501; `getListingsByShopReturnPolicy` requires `listings_r`; address deletion has a scope conflict; processing and third-variation rollout require clarification. Shared proposed tools may wrap more than one operation through an explicit selector. Auth orchestration and event tools are listed after the matrix because they are not additional catalog operations.

## Taxonomy — [public discovery plan](planned-public-discovery.md)

| Method | Etsy operation ID | MCP access | Status |
| --- | --- | --- | --- |
| GET | `getBuyerTaxonomyNodes` | `get_taxonomy_nodes` with buyer selector | Current |
| GET | `getPropertiesByBuyerTaxonomyId` | `get_taxonomy_properties` with buyer selector | Current |
| GET | `getSellerTaxonomyNodes` | `get_taxonomy_nodes` with seller selector | Current |
| GET | `getPropertiesByTaxonomyId` | `get_taxonomy_properties` with seller selector | Current |

## Listings — [public discovery](planned-public-discovery.md), [catalog management](planned-listing-management.md), [orders](planned-orders-and-payments.md)

M1.4 extends the existing `getListing` surface without changing its public API-key access. M1.5 adds public batch listing lookup on `getListingsByListingIds`; M1.6 exposes its `BuyerPrice` association through a separate tool. The single-listing BuyerPrice include remains blocked.

| Method | Etsy operation ID | MCP access | Status |
| --- | --- | --- | --- |
| GET | `getListingsByShop` | `list_shop_listings` | Planned |
| POST | `createDraftListing` | `create_draft_listing` | Planned |
| GET | `getListing` | `get_listing_details`; selected detail fields and Translations/Personalization associations (M1.4) | Current |
| DELETE | `deleteListing` | `delete_listing` | Planned |
| GET | `findAllListingsActive` | `search_listings` with required keywords and bounded page/price/sort controls plus taxonomy, location, safe-content, currency, and buyer-country filters | Current |
| GET | `findAllActiveListingsByShop` | `get_shop_listings` | Current |
| GET | `getListingsByListingIds` | `get_listings_batch` (M1.5 Current); `get_listing_buyer_prices` with required `buyer_country` and `BuyerPrice` (M1.6 Current) | Current |
| GET | `getFeaturedListingsByShop` | `get_featured_shop_listings` | Current |
| PUT | `updateListingProperty` | `update_listing_property` | Planned |
| DELETE | `deleteListingProperty` | `delete_listing_property` | Planned |
| GET | `getListingProperty` | `get_listing_property` — blocked: reference says 501-only | Planned |
| GET | `getListingProperties` | `get_listing_properties` (M2.5a; selected listing values only) | Current |
| GET | `getListingsShippingByListingIds` | `get_listings_shipping_batch` | Planned |
| PATCH | `updateListing` | `update_listing` | Planned |
| GET | `getListingsByShopReceipt` | `get_receipt_listings` | Planned |
| GET | `getListingsByShopReturnPolicy` | `get_return_policy_listings` — M2.7b; OAuth `listings_r`, no paging declared; follows M3 | Planned |
| GET | `getListingsByShopSectionId` | `get_shop_section_listings` | Current |

## Digital files, images, and videos — [listing management](planned-listing-management.md), [public metadata reads](planned-public-discovery.md)

The existing listing `Images`/`Videos` includes provide partial metadata, not access to these dedicated operations.

| Method | Etsy operation ID | MCP access | Status |
| --- | --- | --- | --- |
| GET | `getListingFile` | `get_listing_file` | Planned |
| DELETE | `deleteListingFile` | `delete_listing_file` | Planned |
| GET | `getAllListingFiles` | `get_listing_files` | Planned |
| POST | `uploadListingFile` | `upload_listing_file` | Planned |
| DELETE | `deleteListingImage` | `delete_listing_image` | Planned |
| GET | `getListingImage` | `get_listing_image` | Current |
| GET | `getListingImages` | `get_listing_images` | Current |
| POST | `uploadListingImage` | `upload_listing_image` | Planned |
| DELETE | `deleteListingVideo` | `delete_listing_video` | Planned |
| GET | `getListingVideo` | `get_listing_video` | Current |
| GET | `getListingVideos` | `get_listing_videos` | Current |
| POST | `uploadListingVideo` | `upload_listing_video` | Planned |

## Inventory, products, and offerings — [inventory plan](planned-listing-management.md#inventory-and-variations)

`getListingOffering` is a current, API-key-only read; it does not inherit the `listings_r` requirement of adjacent inventory and product reads.

| Method | Etsy operation ID | MCP access | Status |
| --- | --- | --- | --- |
| GET | `getListingInventory` | `get_listing_inventory` | Planned |
| PUT | `updateListingInventory` | `update_listing_inventory` | Planned |
| GET | `getListingsInventoryByListingIds` | `get_listings_inventory_batch` | Planned |
| GET | `getListingProduct` | `get_listing_product` | Planned |
| GET | `getListingOffering` | `get_listing_offering` (M2.9; selected public offering fields) | Current |

## Personalization, translations, and variation images — [listing management](planned-listing-management.md#content-attributes-and-localization)

| Method | Etsy operation ID | MCP access | Status |
| --- | --- | --- | --- |
| POST | `updateListingPersonalization` | `update_listing_personalization` | Planned |
| DELETE | `deleteListingPersonalization` | `delete_listing_personalization` | Planned |
| GET | `getListingPersonalization` | `get_listing_personalization` (M2.6; bounded questions/options and add-on Money) | Current |
| GET | `getListingTranslation` | `get_listing_translation` (M2.6; existing localized content for one language) | Current |
| POST | `createListingTranslation` | `create_listing_translation` | Planned |
| PUT | `updateListingTranslation` | `update_listing_translation` | Planned |
| GET | `getListingVariationImages` | `get_listing_variation_images` | Planned |
| POST | `updateVariationImages` | `update_variation_images` | Planned |

## Receipts and transactions — [orders and fulfillment plan](planned-orders-and-payments.md)

| Method | Etsy operation ID | MCP access | Status |
| --- | --- | --- | --- |
| GET | `getShopReceipt` | `get_shop_receipt` | Planned |
| PUT | `updateShopReceipt` | `update_shop_receipt` | Planned |
| GET | `getShopReceipts` | `get_shop_receipts` | Planned |
| POST | `createReceiptShipment` | `create_receipt_shipment` | Planned |
| GET | `getShopReceiptTransactionsByListing` | `get_listing_transactions` | Planned |
| GET | `getShopReceiptTransactionsByReceipt` | `get_receipt_transactions` | Planned |
| GET | `getShopReceiptTransaction` | `get_shop_transaction` | Planned |
| GET | `getShopReceiptTransactionsByShop` | `get_shop_transactions` | Planned |

## Payments and ledger — [reconciliation plan](planned-orders-and-payments.md#payments-and-ledger-reconciliation)

| Method | Etsy operation ID | MCP access | Status |
| --- | --- | --- | --- |
| GET | `getShopPaymentAccountLedgerEntry` | `get_shop_ledger_entry` | Planned |
| GET | `getShopPaymentAccountLedgerEntries` | `get_shop_ledger_entries` | Planned |
| GET | `getPaymentAccountLedgerEntryPayments` | `get_ledger_entry_payments` | Planned |
| GET | `getShopPaymentByReceiptId` | `get_receipt_payment` | Planned |
| GET | `getPayments` | `get_shop_payments` | Planned |

## Reviews — [current reviews](reviews.md), [planned listing reviews](planned-public-discovery.md)

| Method | Etsy operation ID | MCP access | Status |
| --- | --- | --- | --- |
| GET | `getReviewsByListing` | `get_listing_reviews` | Current |
| GET | `getReviewsByShop` | `get_shop_reviews` | Current |

## Shipping profiles, destinations, and upgrades — [shipping plan](planned-shop-management.md#shipping-profiles-and-destinations)

| Method | Etsy operation ID | MCP access | Status |
| --- | --- | --- | --- |
| GET | `getShippingCarriers` | `get_shipping_carriers` (M2.8; bounded carrier/mail-class reference data) | Current |
| GET | `getShopShippingProfiles` | `get_shop_shipping_profiles` | Planned |
| POST | `createShopShippingProfile` | `create_shop_shipping_profile` | Planned |
| GET | `getShopShippingProfile` | `get_shop_shipping_profile` | Planned |
| PUT | `updateShopShippingProfile` | `update_shop_shipping_profile` | Planned |
| DELETE | `deleteShopShippingProfile` | `delete_shop_shipping_profile` | Planned |
| GET | `getShopShippingProfileDestinationsByShippingProfile` | `get_shipping_profile_destinations` | Planned |
| POST | `createShopShippingProfileDestination` | `create_shipping_profile_destination` | Planned |
| PUT | `updateShopShippingProfileDestination` | `update_shipping_profile_destination` | Planned |
| DELETE | `deleteShopShippingProfileDestination` | `delete_shipping_profile_destination` | Planned |
| GET | `getShopShippingProfileUpgrades` | `get_shipping_profile_upgrades` | Planned |
| POST | `createShopShippingProfileUpgrade` | `create_shipping_profile_upgrade` | Planned |
| PUT | `updateShopShippingProfileUpgrade` | `update_shipping_profile_upgrade` | Planned |
| DELETE | `deleteShopShippingProfileUpgrade` | `delete_shipping_profile_upgrade` | Planned |

## Shops, sections, and production partners — [shop management plan](planned-shop-management.md#shop-profile-and-organization)

| Method | Etsy operation ID | MCP access | Status |
| --- | --- | --- | --- |
| GET | `getShop` | `get_shop`; also used internally by `get_shop_by_name` | Current |
| PUT | `updateShop` | `update_shop` | Planned |
| GET | `getShopByOwnerUserId` | `get_shop_by_owner` | Current |
| GET | `findShops` | `search_shops`, `get_shop_by_name` | Current |
| GET | `getShopProductionPartners` | `get_shop_production_partners` | Planned |
| GET | `getShopSections` | `get_shop_sections` | Current |
| POST | `createShopSection` | `create_shop_section` | Planned |
| GET | `getShopSection` | `get_shop_section` | Current |
| PUT | `updateShopSection` | `update_shop_section` | Planned |
| DELETE | `deleteShopSection` | `delete_shop_section` | Planned |

## Processing profiles and holidays — [processing and holidays plan](planned-shop-management.md#processing-profiles-and-holiday-preferences)

| Method | Etsy operation ID | MCP access | Status |
| --- | --- | --- | --- |
| GET | `getShopReadinessStateDefinitions` | `get_processing_profiles` | Planned |
| POST | `createShopReadinessStateDefinition` | `create_processing_profile` | Planned |
| GET | `getShopReadinessStateDefinition` | `get_processing_profile` | Planned |
| PUT | `updateShopReadinessStateDefinition` | `update_processing_profile` | Planned |
| DELETE | `deleteShopReadinessStateDefinition` | `delete_processing_profile` | Planned |
| GET | `getHolidayPreferences` | `get_shop_holiday_preferences` | Planned |
| PUT | `updateHolidayPreferences` | `update_shop_holiday_preference` | Planned |

## Return policies — [policy management plan](planned-shop-management.md#return-policies)

| Method | Etsy operation ID | MCP access | Status |
| --- | --- | --- | --- |
| POST | `consolidateShopReturnPolicies` | `consolidate_shop_return_policies` | Planned |
| GET | `getShopReturnPolicies` | `get_shop_return_policies` (M2.7a; selected public fields) | Current |
| POST | `createShopReturnPolicy` | `create_shop_return_policy` | Planned |
| GET | `getShopReturnPolicy` | `get_shop_return_policy` (M2.7a; selected public fields) | Current |
| PUT | `updateShopReturnPolicy` | `update_shop_return_policy` | Planned |
| DELETE | `deleteShopReturnPolicy` | `delete_shop_return_policy` | Planned |

## Users and addresses — [account access plan](planned-oauth-and-accounts.md#user-and-address-tools)

| Method | Etsy operation ID | MCP access | Status |
| --- | --- | --- | --- |
| GET | `getUser` | `get_user` | Planned |
| GET | `getMe` | Internal identity verification in the conditional OAuth connection flow; direct `get_me` tool remains planned (M4) | Indirect (OAuth-enabled only) |
| GET | `getUserAddress` | `get_user_address` | Planned |
| DELETE | `deleteUserAddress` | `delete_user_address` — blocked pending `address_r`/`address_w` conflict clarification | Planned |
| GET | `getUserAddresses` | `get_user_addresses` | Planned |

## Diagnostics — [connection plan](planned-oauth-and-accounts.md), [public discovery](planned-public-discovery.md)

| Method | Etsy operation ID | MCP access | Status |
| --- | --- | --- | --- |
| GET | `ping` | `ping_etsy` (M2.8; application connectivity only, not OAuth/private access) | Current |
| POST | `tokenScopes` | `get_etsy_token_scopes` with internally resolved token | Planned |

## Non-catalog supporting capabilities

| Capability | MCP access | Status | Plan |
| --- | --- | --- | --- |
| Browser OAuth consent initiation, fixed callback completion, durable protected connection | `begin_etsy_connection` (only with explicit OAuth startup enablement and successful prerequisites) | Conditional current implementation; M3.2 independent review, coordinator Windows/native-Linux verification and commit complete | [OAuth](planned-oauth-and-accounts.md) |
| Protected encrypted connection store/configuration/permissions | Internal runtime support; not a model-facing filesystem tool | Current M3.3a foundation; native Windows and native Linux evidence recorded, Docker untested | [OAuth](planned-oauth-and-accounts.md) |
| Token refresh/rotation and serialized lifecycle support | Internal service interfaces only; no current MCP/private handler invokes them | Current M3.3b; independent security/spec/quality approval and coordinator Windows/native-Linux verification complete; parent M3.3 complete | [OAuth](planned-oauth-and-accounts.md) |
| Local connection status and disconnect | `get_etsy_connection_status`, `disconnect_etsy_connection` (only with a ready OAuth runtime) | Conditional current M3.4; independent review and coordinator Windows/native-Linux verification complete; local only, no Etsy-side revocation; no private Etsy resource tool is enabled | [OAuth](planned-oauth-and-accounts.md) |
| Per-operation scope authorization and scope diagnostic | Reviewed internal authorization core; private handlers planned; `get_etsy_token_scopes` unavailable | M3.5a complete; M3.5b blocked by empty official response contract; parent M3.5 open; no private Etsy tool enabled or diagnostic reachability gained | [OAuth](planned-oauth-and-accounts.md) |
| Signed event receipt, queueing, delivery health | `get_etsy_event_status`, `get_etsy_events`; separate receiver configured through Etsy's portal | Planned | [Events](planned-orders-and-payments.md#events-and-change-notifications) |
| Richer fields/options on currently used listing operations | Extend existing listing tools; preserve compatibility | Planned | [Public discovery](planned-public-discovery.md) |
| User confirmation, ownership checks, safe uploads, uncertain-outcome handling | Shared enforcement behind relevant tools; not a raw credential or generic HTTP tool | Planned with owning tools | [Policy](access-policy.md) |

Planned non-catalog capabilities are tracked in [TODO](../TODO.md); rows marked conditional/current describe the limited implemented connection and storage support. No endpoint-backed feature has been omitted merely because it requires OAuth, inventory access, or a write method.
