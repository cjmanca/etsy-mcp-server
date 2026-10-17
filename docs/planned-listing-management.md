# Planned listing, inventory, and media management

**Status: unimplemented proposals.** This slice covers seller catalog management, variants/SKUs, digital files, and content writes. Public-read extensions are in [public discovery](planned-public-discovery.md). Account operations require the [OAuth foundation](planned-oauth-and-accounts.md) and [write policy](access-policy.md).

All account tools take `connection_id` plus the resource selection shown below. Proposed names map to exact operations in the [coverage matrix](api-coverage.md). Check each operation's current scope and constraints before implementation; scope families below are planning guidance, not a substitute for endpoint validation.

## Catalog lifecycle

| Tool | Main selection/change | User-facing behavior |
| --- | --- | --- |
| `list_shop_listings` | Shop ID, state and supported filters/paging. | Authorized catalog views, including non-public states permitted by `getListingsByShop`; keep existing public `get_shop_listings` unchanged. |
| `create_draft_listing` | Shop ID and validated required listing fields. | Create a draft and return its ID/state; do not publish as a side effect of “create a draft.” |
| `update_listing` | Shop/listing IDs and explicit changed fields. | Preview and apply selected content, price, category, policy/profile links, and allowed state changes supported by `updateListing`. |
| `delete_listing` | Listing ID and confirmation. | Delete only a permitted owned listing, represent conflict/unsupported-state errors, and verify the outcome. |

Read access uses `listings_r`; creation/update use `listings_w`; listing deletion specifically uses `listings_d`. Recheck required physical/digital fields, taxonomy attributes, shipping/processing links, title/tag constraints, and image prerequisites against the current endpoint. Publication/renewal can have financial or visibility consequences. Etsy documents activation of a draft as publication and activation of a sold-out listing as renewal with quantity changed to one: these effects must be explicit in the confirmation.

## Inventory and variations

| Tool | Main inputs | Returned or changed information |
| --- | --- | --- |
| `get_listing_inventory` | Listing ID; optional supported deleted-product controls. | Products, offering prices/quantities/enabled state, variation values, SKU visibility, and property-dependency arrays. |
| `get_listings_inventory_batch` | 1–100 listing IDs. | Inventory summaries associated with each listing. |
| `get_listing_product` | Listing ID and product ID. | One product and its offerings/properties. |
| `get_listing_offering` | Listing ID, product ID, `product_offering_id`. | One offering's price, quantity, enabled/deleted state, and readiness reference. |
| `update_listing_inventory` | Listing ID, complete validated product set and dependency arrays; confirmation bound to the preview. | Whole-record replacement with verified resulting quantities, prices, variations, SKUs, and processing links. |

Inspected inventory/product reads require `listings_r`, inventory writes require `listings_w`. The inspected offering GET requires an API key without an OAuth scope: do not infer its authorization from the related product route. Account/resource restrictions still apply wherever Etsy enforces them.

Use dedicated inventory endpoints. Do **not** reintroduce `includes=Inventory` on listing detail/batch lookup; that association was removed. Inventory may be null/missing for listings not created/edited through Etsy inventory tooling, which is not proof of zero stock. SKUs are owner-only; batch inventory strips other sellers' SKUs. One missing ID causes the entire batch inventory request to return 404.

Inventory updates replace the product set, not a single isolated SKU field. Read a complete source record, preserve unaffected variants, then preview/apply the complete intended replacement. Refuse writes based on truncated/stale source data; use an internal complete snapshot rather than copying a display excerpt. Preserve consistent `price_on_property`, `quantity_on_property`, `sku_on_property`, and `readiness_state_on_property`. Convert money using amount/divisor where the write schema expects decimal prices. A stale-read check reduces accidental overwrites but is not atomic concurrency control unless Etsy supplies such a mechanism.

Plan for current third-variation support (`max_variations_supported=3` where documented) and scale validation. Do not hard-code the former two-variation limit or copy old migration flags without checking the latest schema. Processing links apply to physical offerings; see [shop processing profiles](planned-shop-management.md).

## Content, attributes, and localization

| Tools | Main inputs | Result/change |
| --- | --- | --- |
| `update_listing_property`, `delete_listing_property` | Shop/listing/property IDs; allowed scale/value selection for update; confirmation. | Apply/remove a structured attribute while respecting taxonomy constraints. |
| `update_listing_personalization`, `delete_listing_personalization` | Shop/listing IDs; question configuration for update; confirmation. | Set/remove current personalization questions, requirements, options, and supported add-on prices. |
| `create_listing_translation`, `update_listing_translation` | Shop/listing IDs, language, localized fields, confirmation. | Create/update an Etsy listing translation without changing the source language implicitly. |
| `get_listing_variation_images`, `update_variation_images` | Shop/listing IDs; variation-value/image mappings for update; confirmation. | Inspect or replace mappings between variation choices and existing images. |

Use endpoint-specific write scopes (generally `listings_w`) and do not assume removal uses the same scope as deleting an entire listing. Personalization must follow the current multi-question schema rather than only deprecated single-instruction fields. Distinguish seller-configured instructions from executable instructions to the agent. For mapped images, reject references not belonging to the listing and do not silently drop unrelated mappings.

## Images, videos, and digital files

| Tools | Main inputs | Result/change |
| --- | --- | --- |
| `upload_listing_image`, `delete_listing_image` | Shop/listing IDs; selected attachment or supported existing image ID, rank/alt-text options; image ID for deletion; confirmation. | Add/assign/order image metadata or remove an image association. |
| `upload_listing_video`, `delete_listing_video` | Shop/listing IDs; selected attachment or supported existing video ID; video ID for deletion; confirmation. | Add/associate video content or remove its listing association. |
| `get_listing_files`, `get_listing_file` | Shop/listing IDs; file ID for detail. | Authorized digital-file metadata such as name, order, type, and size (`listings_r` for inspected list endpoint). |
| `upload_listing_file`, `delete_listing_file` | Shop/listing IDs; selected attachment or supported existing file ID; file ID for deletion; confirmation. | Add/associate a digital file or remove it, explaining last-file consequences. |

Public image/video metadata reads are planned separately; uploads are not generic downloads. Prefer operator-selected attachment handles with explicit MIME/size validation, not arbitrary URLs or unconstrained disk paths. Recheck format, upload-size, rank, and existing-resource constraints per operation. Deleting an image/video association need not erase Etsy's underlying file. Last-image/last-digital-file changes can affect listing availability and must be shown before confirmation.

## Acceptance criteria

- [ ] Non-public catalog reads reject missing scopes and unauthorized ownership without affecting public catalog tools.
- [ ] Draft creation, editing, activation/renewal, and deletion are distinct, explicitly authorized outcomes.
- [ ] Inventory tests cover owner-only SKUs, null inventory, all-or-nothing batch failure, preserved variants, third variations, scale rules, and processing links.
- [ ] Truncated/stale snapshots cannot silently become a destructive full replacement; uncertain mutation outcomes are not blindly retried.
- [ ] Attribute, personalization, translation, and variation-image tools preserve unrelated content and reject invalid references.
- [ ] Media/digital-file flows enforce attachment limits, distinguish metadata from binary content, and explain destructive consequences.

No product-create/delete or offering-update endpoint exists as a separate operation in this catalog; those changes must go through the supported inventory replacement semantics, not invented CRUD tools.
