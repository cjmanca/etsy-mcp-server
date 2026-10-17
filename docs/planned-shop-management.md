# Planned shop, shipping, and policy management

**Status: mostly unimplemented proposals.** Shop settings, private configuration, and policy mutations remain planned; M2.7a public return-policy list/detail reads are implemented in [public discovery](planned-public-discovery.md). Use the [OAuth plan](planned-oauth-and-accounts.md), [access policy](access-policy.md), and [operation matrix](api-coverage.md). Public profile and section reads are also described in [shop discovery](shops.md).

## M0.1 verified contract findings (2026-10-17)

All shop, section, shipping/destination/upgrade, processing/holiday, partner and
return-policy operations have [exact contracts](contracts/operations.md).
Read the [configuration/migration audit](contracts/README.md#processing-profiles-and-shop-configuration):
updateShop requires both shops_r and shops_w; policy-linked listing lookup needs
listings_r despite public policy reads; consolidation deletes the source policy.
Final shipping destination and linked-active-offering readiness deletion have
explicit restrictions. legacy is operation-specific, not a blanket flag.
General Release banners conflict with processing guide's test-only/no-real-seller
warning: block production processing enablement until Etsy clarifies rollout.
No deployment or live testing is authorized by this contract audit.

Account tools take `connection_id`, shop ID, and the IDs/options below. Read/write scope families are generally `shops_r`/`shops_w` for private shop configuration; recheck **each** exact operation, including public exceptions and delete endpoints, before implementation.

## Shop profile and organization

| Tools | Main inputs | Capability |
| --- | --- | --- |
| `update_shop` | Explicit changed shop fields and confirmation. | Update supported titles/messages/settings without overwriting unrelated profile data or changing default language implicitly. |
| `create_shop_section`, `update_shop_section`, `delete_shop_section` | Section title/rank where supported; section ID for update/delete; confirmation. | Organize a shop and explain what section removal does to catalog organization. |
| `get_shop_production_partners` | Shop ID. | Retrieve available partner IDs, names, and locations for authorized listing-management workflows. |

There is no shop-create/delete or production-partner-write operation in the researched catalog. Do not invent a tool to fill out a symmetric CRUD set.

## Shipping profiles and destinations

| Tools | Main inputs | Capability |
| --- | --- | --- |
| `get_shop_shipping_profiles`, `get_shop_shipping_profile` | Shop ID; profile ID for detail. | Read profile titles, origin, type, destinations, upgrades, and applicable charges. |
| `get_listings_shipping_batch` | 1–100 listing IDs and connection ID. | Read listing-to-profile associations using the dedicated OAuth endpoint. |
| `create_shop_shipping_profile`, `update_shop_shipping_profile`, `delete_shop_shipping_profile` | Origin/profile configuration; profile ID for update/delete; confirmation. | Create/update/delete a supported profile, previewing linked-listing impact. |
| `get_shipping_profile_destinations` | Profile ID. | Inspect destination countries/regions, carrier/mail-class choices, prices, and delivery ranges. |
| `create_shipping_profile_destination`, `update_shipping_profile_destination`, `delete_shipping_profile_destination` | Profile ID; destination ID where needed; destination/pricing/delivery configuration; confirmation. | Manage a profile's shipping coverage and prices. |
| `get_shipping_profile_upgrades` | Profile ID. | Inspect upgrade options, rank, carriers, prices, and delivery ranges. |
| `create_shipping_profile_upgrade`, `update_shipping_profile_upgrade`, `delete_shipping_profile_upgrade` | Profile/upgrade IDs; upgrade configuration; confirmation. | Manage premium delivery choices and show which shared configuration changes. |

The inspected profile-list and batch-shipping endpoints require `shops_r`. Batch shipping requires all requested listing IDs to exist, otherwise the whole request returns 404. Profiles and their IDs are nulled for listings not owned by the connected user; digital listings may have no shipping profile. Null is not an empty profile or proof of free shipping.

Do not restore `includes=Shipping` in listing lookup. Use `getListingsShippingByListingIds` and the required scope. The public carrier lookup supplies supported carrier/mail-class IDs; it does not buy postage or generate a label.

Etsy documents that calculated shipping templates cannot be created through this API; existing calculated profiles created in Shop Manager may be associated with listings. Respect origin/postal-code, country/region, money, carrier/mail-class, and delivery-range requirements rather than substituting arbitrary defaults. A shared-profile destination/upgrade change can affect every linked listing; preview the scope and confirm before applying it.

## Processing profiles and holiday preferences

| Tools | Main inputs | Capability |
| --- | --- | --- |
| `get_processing_profiles`, `get_processing_profile` | Shop ID; readiness-state-definition ID for detail; supported paging. | Read physical-product readiness (`ready_to_ship`/`made_to_order`) and processing-time ranges. |
| `create_processing_profile`, `update_processing_profile`, `delete_processing_profile` | Readiness/time configuration; definition ID for update/delete; confirmation. | Manage processing profiles without conflating processing time with shipping transit time. |
| `get_shop_holiday_preferences`, `update_shop_holiday_preference` | Shop ID; holiday ID and preference for update; confirmation. | Read/update whether the seller processes orders on supported holidays. |

Inspected processing-profile and holiday reads require `shops_r`; the migration guide specifies `shops_w` for processing-profile writes. Holiday availability is currently documented for US/CA shops; return an explicit unsupported-region outcome elsewhere.

Processing profiles link through `readiness_state_id` on physical listings/offerings and are not for digital products. The processing-profile migration guide contains transition/early-access instructions: verify Etsy's current rollout and whether any `legacy` flag is still required before enabling live use. Do not copy old example query parameters into every endpoint; current schemas can differ. Profile updates/deletions can affect many offerings, so use a dependency-aware preview and represent reassignment/deletion constraints.

## Return policies

| Tools | Main inputs | Capability |
| --- | --- | --- |
| `get_shop_return_policies`, `get_shop_return_policy` | Shop ID; policy ID for detail. | **Current M2.7a:** selected public policy fields only; does not enumerate linked listings or establish legal compliance/refund eligibility. |
| `create_shop_return_policy`, `update_shop_return_policy`, `delete_shop_return_policy` | Acceptance/deadline settings; policy ID where needed; confirmation. | Manage a policy without asserting that it guarantees legal compliance. |
| `consolidate_shop_return_policies` | Source/destination policy IDs and explicit confirmation of the move. | Reassign listings from one policy to another through Etsy's supported consolidation operation. |
| `get_return_policy_listings` | Connection ID, shop ID, policy ID; no paging declared. | Authorized affected listings (`listings_r`) before policy changes. |

The public list/detail reads use API-key access; the separate `get_return_policy_listings` operation requires OAuth `listings_r` and is deferred until M3. Do not force OAuth onto public tools solely because related operations need authorization, or infer complete policy impact without the private listing read. Deletion is only permitted for policies not attached to listings according to the catalog description. Consolidation has multi-listing impact: show source/destination differences, linked-listing evidence, and any incomplete impact enumeration before confirmation. Recheck allowed deadlines and required combinations when returns or exchanges are enabled.

## Acceptance criteria

- [ ] Public reads and private configuration tools remain clearly separated in discovery and errors.
- [ ] Shared shop/profile/policy changes show linked-resource impact and cannot silently claim a complete impact list from truncated pages.
- [ ] Dedicated shipping batches preserve ownership/null/digital-listing distinctions and report whole-batch failures honestly.
- [ ] Shipping tools reject unsupported calculated-profile creation and invalid destination/carrier/range combinations.
- [ ] Processing and holiday tools honor physical-product, migration-state, and regional constraints.
- [ ] Return-policy removal/consolidation enforce Etsy restrictions, explicit confirmation, and safe conflict/outcome handling.
