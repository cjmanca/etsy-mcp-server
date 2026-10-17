# Complete Etsy API coverage matrix

**Catalog baseline: 2026-10-16 MCP, 105 operations; all 105 IDs/methods revalidated against the official OpenAPI document on 2026-10-17.** This is a routing/coverage reference, not a claim that all tools exist. The [contract audit](contracts/README.md), [per-operation index](contracts/operations.md), and checksum-pinned original schema record inputs, scopes, responses, flags, guide restrictions and explicit blockers. Revalidate affected contracts before implementation.

- **Current:** registered MCP access exists, with the limited fields/options described in current documentation; not necessarily every upstream parameter.
- **Indirect:** the API is called internally, but the proposed direct tool does not exist.
- **Planned:** no current access to this API operation. All names in planned rows are proposals.
- Eight current tools reach ten distinct operations (nine directly and one Indirect row); **95 operations are Planned**. The indirect row also has a missing direct MCP tool.

Read the linked subsystem and its contract-audit findings for proposed inputs, outputs, permissions, dependencies, and acceptance criteria. M0.1 retains every operation's full original schema and separately records field/owner restrictions and unresolved guide/reference differences; schema presence does not prove live availability. In particular, `getListingProperty` is feedback-only/501; `getListingsByShopReturnPolicy` requires `listings_r`; address deletion has a scope conflict; processing and third-variation rollout require clarification. Shared proposed tools may wrap more than one operation through an explicit selector. Auth orchestration and event tools are listed after the matrix because they are not additional catalog operations.

## Taxonomy — [public discovery plan](planned-public-discovery.md)

| Method | Etsy operation ID | MCP access | Status |
| --- | --- | --- | --- |
| GET | `getBuyerTaxonomyNodes` | `get_taxonomy_nodes` with buyer selector | Current |
| GET | `getPropertiesByBuyerTaxonomyId` | `get_taxonomy_properties` with buyer selector | Current |
| GET | `getSellerTaxonomyNodes` | `get_taxonomy_nodes` with seller selector | Current |
| GET | `getPropertiesByTaxonomyId` | `get_taxonomy_properties` with seller selector | Current |

## Listings — [public discovery](planned-public-discovery.md), [catalog management](planned-listing-management.md), [orders](planned-orders-and-payments.md)

M1.4 extends the existing `getListing` surface without changing its public API-key access. Batch lookup and BuyerPrice remain planned on their separately contracted batch route; the single-listing BuyerPrice include remains blocked.

| Method | Etsy operation ID | MCP access | Status |
| --- | --- | --- | --- |
| GET | `getListingsByShop` | `list_shop_listings` | Planned |
| POST | `createDraftListing` | `create_draft_listing` | Planned |
| GET | `getListing` | `get_listing_details`; selected detail fields and Translations/Personalization associations (M1.4) | Current |
| DELETE | `deleteListing` | `delete_listing` | Planned |
| GET | `findAllListingsActive` | `search_listings` with required keywords and bounded page/price/sort controls plus taxonomy, location, safe-content, currency, and buyer-country filters | Current |
| GET | `findAllActiveListingsByShop` | `get_shop_listings` | Current |
| GET | `getListingsByListingIds` | `get_listings_batch`, `get_listing_buyer_prices` | Planned |
| GET | `getFeaturedListingsByShop` | `get_featured_shop_listings` | Planned |
| PUT | `updateListingProperty` | `update_listing_property` | Planned |
| DELETE | `deleteListingProperty` | `delete_listing_property` | Planned |
| GET | `getListingProperty` | `get_listing_property` — blocked: reference says 501-only | Planned |
| GET | `getListingProperties` | `get_listing_properties` | Planned |
| GET | `getListingsShippingByListingIds` | `get_listings_shipping_batch` | Planned |
| PATCH | `updateListing` | `update_listing` | Planned |
| GET | `getListingsByShopReceipt` | `get_receipt_listings` | Planned |
| GET | `getListingsByShopReturnPolicy` | `get_return_policy_listings` — OAuth `listings_r`, no paging declared | Planned |
| GET | `getListingsByShopSectionId` | `get_shop_section_listings` | Planned |

## Digital files, images, and videos — [listing management](planned-listing-management.md), [public metadata reads](planned-public-discovery.md)

The existing listing `Images`/`Videos` includes provide partial metadata, not access to these dedicated operations.

| Method | Etsy operation ID | MCP access | Status |
| --- | --- | --- | --- |
| GET | `getListingFile` | `get_listing_file` | Planned |
| DELETE | `deleteListingFile` | `delete_listing_file` | Planned |
| GET | `getAllListingFiles` | `get_listing_files` | Planned |
| POST | `uploadListingFile` | `upload_listing_file` | Planned |
| DELETE | `deleteListingImage` | `delete_listing_image` | Planned |
| GET | `getListingImage` | `get_listing_image` | Planned |
| GET | `getListingImages` | `get_listing_images` | Planned |
| POST | `uploadListingImage` | `upload_listing_image` | Planned |
| DELETE | `deleteListingVideo` | `delete_listing_video` | Planned |
| GET | `getListingVideo` | `get_listing_video` | Planned |
| GET | `getListingVideos` | `get_listing_videos` | Planned |
| POST | `uploadListingVideo` | `upload_listing_video` | Planned |

## Inventory, products, and offerings — [inventory plan](planned-listing-management.md#inventory-and-variations)

| Method | Etsy operation ID | MCP access | Status |
| --- | --- | --- | --- |
| GET | `getListingInventory` | `get_listing_inventory` | Planned |
| PUT | `updateListingInventory` | `update_listing_inventory` | Planned |
| GET | `getListingsInventoryByListingIds` | `get_listings_inventory_batch` | Planned |
| GET | `getListingProduct` | `get_listing_product` | Planned |
| GET | `getListingOffering` | `get_listing_offering` | Planned |

## Personalization, translations, and variation images — [listing management](planned-listing-management.md#content-attributes-and-localization)

| Method | Etsy operation ID | MCP access | Status |
| --- | --- | --- | --- |
| POST | `updateListingPersonalization` | `update_listing_personalization` | Planned |
| DELETE | `deleteListingPersonalization` | `delete_listing_personalization` | Planned |
| GET | `getListingPersonalization` | `get_listing_personalization` | Planned |
| GET | `getListingTranslation` | `get_listing_translation` | Planned |
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
| GET | `getReviewsByListing` | `get_listing_reviews` | Planned |
| GET | `getReviewsByShop` | `get_shop_reviews` | Current |

## Shipping profiles, destinations, and upgrades — [shipping plan](planned-shop-management.md#shipping-profiles-and-destinations)

| Method | Etsy operation ID | MCP access | Status |
| --- | --- | --- | --- |
| GET | `getShippingCarriers` | `get_shipping_carriers` | Planned |
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
| GET | `getShop` | Currently internal to `get_shop_by_name`; direct `get_shop` planned | Indirect |
| PUT | `updateShop` | `update_shop` | Planned |
| GET | `getShopByOwnerUserId` | `get_shop_by_owner` | Planned |
| GET | `findShops` | `search_shops`, `get_shop_by_name` | Current |
| GET | `getShopProductionPartners` | `get_shop_production_partners` | Planned |
| GET | `getShopSections` | `get_shop_sections` | Planned |
| POST | `createShopSection` | `create_shop_section` | Planned |
| GET | `getShopSection` | `get_shop_section` | Planned |
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
| GET | `getShopReturnPolicies` | `get_shop_return_policies` | Planned |
| POST | `createShopReturnPolicy` | `create_shop_return_policy` | Planned |
| GET | `getShopReturnPolicy` | `get_shop_return_policy` | Planned |
| PUT | `updateShopReturnPolicy` | `update_shop_return_policy` | Planned |
| DELETE | `deleteShopReturnPolicy` | `delete_shop_return_policy` | Planned |

## Users and addresses — [account access plan](planned-oauth-and-accounts.md#user-and-address-tools)

| Method | Etsy operation ID | MCP access | Status |
| --- | --- | --- | --- |
| GET | `getUser` | `get_user` | Planned |
| GET | `getMe` | `get_me` | Planned |
| GET | `getUserAddress` | `get_user_address` | Planned |
| DELETE | `deleteUserAddress` | `delete_user_address` — blocked pending `address_r`/`address_w` conflict clarification | Planned |
| GET | `getUserAddresses` | `get_user_addresses` | Planned |

## Diagnostics — [connection plan](planned-oauth-and-accounts.md), [public discovery](planned-public-discovery.md)

| Method | Etsy operation ID | MCP access | Status |
| --- | --- | --- | --- |
| GET | `ping` | `ping_etsy` | Planned |
| POST | `tokenScopes` | `get_etsy_token_scopes` with internally resolved token | Planned |

## Non-catalog supporting capabilities

| Capability | Proposed MCP access | Plan |
| --- | --- | --- |
| OAuth consent, callback completion, refresh, secure storage, local disconnection | `begin_etsy_connection`, `get_etsy_connection_status`, `disconnect_etsy_connection`; internal callback/refresh handling | [OAuth](planned-oauth-and-accounts.md) |
| Signed event receipt, queueing, delivery health | `get_etsy_event_status`, `get_etsy_events`; separate receiver configured through Etsy's portal | [Events](planned-orders-and-payments.md#events-and-change-notifications) |
| Richer fields/options on currently used listing operations | Extend existing listing tools; preserve compatibility | [Public discovery](planned-public-discovery.md) |
| User confirmation, ownership checks, safe uploads, uncertain-outcome handling | Shared enforcement behind relevant tools; not a raw credential or generic HTTP tool | [Policy](access-policy.md) |

These are also unimplemented and tracked in [TODO](../TODO.md). No endpoint-backed feature has been omitted merely because it requires OAuth, inventory access, or a write method.
