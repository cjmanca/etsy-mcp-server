# Planned public discovery expansion

**Status: mixed.** M1.1 taxonomy node browsing, M1.2 category-property lookup, and M1.3 active-listing search filters are implemented; all other entries remain proposals unless marked current in the [coverage matrix](api-coverage.md). Read with the [access policy](access-policy.md). This slice extends product/shop research without requiring a seller account for public data. Verify access requirements for each operation before implementation rather than assuming every GET is public.

## M0.1 verified contract findings (2026-10-17)

Read the [complete operation contracts](contracts/operations.md) and
[six-tool extension/public-discovery findings](contracts/README.md#six-existing-tool-extension-checks).
All taxonomy, public listing/shop/review, section, metadata and diagnostic rows
retain exact input/response schemas in the original snapshot. **Exceptions to
the proposed grouping:** `getListingProperty` is feedback-only and returns 501;
keep that detail capability blocked. `getListingsByShopReturnPolicy` requires
`listings_r` and declares no paging parameters, so that portion follows OAuth M3.
`getListingVariationImages` and `getListingOffering` are API-key-only; do not
infer inventory scopes for them. BuyerPrice appears in detail includes but its
field contract supports batch only. Owner-only suggested titles need an OAuth
token with an unspecified exact scope and remain disabled pending clarification.
These are analysis findings, not implemented tools.

## Current M1.1: taxonomy node browsing

`get_taxonomy_nodes` reads the public buyer or seller hierarchy through exactly one of:

- `GET /v3/application/buyer-taxonomy/nodes` (`getBuyerTaxonomyNodes`)
- `GET /v3/application/seller-taxonomy/nodes` (`getSellerTaxonomyNodes`)

The operation is API-key-only and declares no query parameters. `taxonomy_type` is required. Optional `taxonomy_id` selects that node and its descendants; optional `name` is a case-insensitive substring. Both filters and page slicing are **local**, because Etsy returns the full recursive tree. Responses identify the selected tree and local filters, report `count` as the locally matched node total, and return flat node summaries with stable numeric IDs, parent IDs, full ID paths, and bounded child-ID previews. Names are treated as untrusted text and output is truncated when needed.

Acquisition uses the existing fixed Etsy origin, TLS verification, redirect/proxy isolation, request limiter, retry policy, 10-second timeout, and 1 MiB response limit; no taxonomy-specific exception raises the global cap. The full response is validated and flattened before it can enter an in-memory cache. Buyer and seller have separate single-flight cache entries with a 15-minute TTL; each tree is capped at 20,000 nodes, depth 32, and 512 characters per source name, and output child previews at 25 IDs. Invalid, incomplete, too-deep, duplicate, oversized, or malformed trees are rejected without caching partial data. If Etsy's full tree exceeds 1 MiB, the tool returns an actionable error explaining that local filters cannot reduce the upstream response. Tree sizes have not been measured with a live Etsy request.

Taxonomy IDs returned here are stable Etsy IDs. Use the same explicit buyer or seller selector for property lookup; equal numeric IDs in different trees are not interchangeable. Taxonomy filtering in `search_listings` remains planned separately.

## Current M1.2: category properties

`get_taxonomy_properties` selects one of two public, API-key-only operations:

- `GET /v3/application/buyer-taxonomy/nodes/{taxonomy_id}/properties` (`getPropertiesByBuyerTaxonomyId`); no query parameters.
- `GET /v3/application/seller-taxonomy/nodes/{taxonomy_id}/properties` (`getPropertiesByTaxonomyId`); optional `supports_variations` and `supports_attributes` booleans.

The required `taxonomy_type` and positive safe-integer `taxonomy_id` must refer to the matching tree. The ID is sent directly to that route; the server does not fetch the full tree just to validate it. Invalid selectors, IDs, non-boolean seller flags, or seller-only flags used with `buyer` fail before a request. The endpoints have no pagination or other filters.

Output selects stable property/value/scale IDs, names and display names, `is_required`, `supports_attributes`, `supports_variations`, `is_multivalued`, `max_values_allowed`, `scales`, `possible_values`, and `selected_values`. A possible value's `scale_id` and `equal_to` associations remain intact. `possible_values` describes values permitted by the category; `selected_values` describes values Etsy says are automatically and always selected for that property, not values chosen on a particular listing. Missing fields remain omitted and explicit nulls remain null.

Property lists are capped at 100; per-property scales at 10, possible values at 50, selected values at 25, and each value's `equal_to` IDs at 10. Property/value/scale labels are capped at 200 characters and scale descriptions at 500. Array, text, or output-row shortening sets `truncated`; `count` retains Etsy's source count when supplied and `returned` describes rows included after output-size trimming. JSON remains within the shared 128 KiB output limit and upstream bodies retain the shared 1 MiB cap. Etsy text in property names, values, and descriptions is untrusted.

## Current M1.3: active-listing search filters

`search_listings` calls the public, API-key-only `GET /v3/application/listings/active` (`findAllListingsActive`). It still requires trimmed, nonempty `keywords` up to 200 characters and retains the current price, page, and sort validation. Optional endpoint-supported filters are `taxonomy_id` (positive safe integer, including IDs from the seller taxonomy), `shop_location` (trimmed nonempty text up to 200 characters), `is_safe` (boolean, including false), `currency` (exact uppercase three-letter ISO 4217 form), and `buyer_country` (exact uppercase two-letter ISO 3166-1 alpha-2 form). No local list of available currencies or countries is maintained; Etsy may reject a syntactically valid but unsupported value or an unparseable location.

For `sort_on: "score"`, the request always sends `sort_order: "desc"`; caller aliases remain accepted, while non-score ordering aliases pass through unchanged. With no sort options, Etsy's documented default is newest-first. `is_safe: true` filters out mature/adult content; false is passed through but does not activate that filter. `buyer_country` filters shipping eligibility only and does not produce a buyer price or checkout quote. `currency` requests Etsy conversion, but current selected output retains the existing formatted original `price` only and does not expose `converted_price`; absent/null original money remains `N/A`. Do not equate prices across currencies. All selected Etsy text remains untrusted.

## Remaining proposed MCP capabilities

| Tool or extension | Main inputs | User-facing result |
| --- | --- | --- |
| Extend `get_listing_details` and selected listing summaries | Listing ID; explicitly supported associations/field selections. | Category, return-policy/readiness references, listing type, variation/personalization flags, and other useful documented public fields; additional supported associations such as translations/personalization. |
| `get_listings_batch` | 1–100 `listing_ids`; bounded allowed includes; optional `currency` and `buyer_country`. | Several listing summaries in one upstream call, keyed by listing ID. |
| `get_listing_buyer_prices` | 1–100 listing IDs and required `buyer_country`; optional currency. | Buyer-facing base/display/discount/shipping price components using the batch endpoint's `BuyerPrice` association. |
| `get_shop` | `shop_id`. | Direct public profile lookup without repeating name search. |
| `get_shop_by_owner` | `user_id`. | Public shop discovery using a known owner ID. |
| `get_featured_shop_listings` | `shop_id`; only endpoint-supported result controls. | Products curated as featured by the shop, not a platform-wide trend ranking. |
| `get_shop_sections`, `get_shop_section` | Shop ID; section ID for detail. | Public section titles, order, and active-listing counts. |
| `get_shop_section_listings` | Shop ID and section ID selection, with endpoint-supported paging/sort controls. | Catalog browsing by actual shop section instead of keyword inference. |
| `get_listing_reviews` | Listing ID; supported page/date controls. | Product-specific review samples using the existing bounded review output conventions. |
| `get_listing_images`, `get_listing_image` | Listing ID; image ID for detail. | Image references with rank, dimensions, alt text, and selected metadata. |
| `get_listing_videos`, `get_listing_video` | Listing ID; video ID for detail. | Dedicated video metadata without requiring a full listing response. |
| `get_listing_properties`, `get_listing_property` | Listing ID; shop ID for the all-properties route; property ID for detail. | Actual structured product attributes and their selected values. |
| `get_listing_personalization` | Listing ID. | Questions, required flags, character/file limits, options, and add-on prices when present. |
| `get_listing_translation` | Shop ID, listing ID, IETF language tag. | Etsy's existing localized title, description, and tags, not an AI-generated translation. |
| `get_shop_return_policies`, `get_shop_return_policy` | Shop ID; return-policy ID for detail. | Return/exchange acceptance and deadlines. |
| `get_return_policy_listings` | Connection ID, shop ID, return-policy ID; no paging query declared. | Authorized products associated with a policy (`listings_r`); follows M3, not a public-only tool. |
| `get_shipping_carriers` | Country/filter fields supported by the endpoint. | Carrier IDs and mail classes for discovery and later fulfillment/shipping configuration. |
| `ping_etsy` | No caller-supplied URL or credentials. | Bounded connectivity/application-access diagnostic; not proof that private scopes are granted. |

The public `get_listing_offering` route is planned in the [inventory slice](planned-listing-management.md), alongside its related inventory operations. Its inspected endpoint requires an API key, unlike the OAuth-protected inventory/product routes. Confirm this distinction again when implementing it.

## Important behaviors to preserve

**Currency and buyer prices:** `search_listings` currently retains only its original formatted price and does not surface `converted_price`, even when the currency filter is used. Future batch buyer-price output must retain original money separately from strict structured `converted_price`; a missing conversion is not zero. `buyer_country` filters shipping eligibility on active search but supplies buyer-price context on batch lookup; the latter does not filter the requested IDs. Buyer pricing is currently documented specifically for the batch endpoint. Null shipping cost does not necessarily mean free shipping; use `is_free_shipping`. Do not promise a final checkout quote.

**Search:** `search_listings` now sends its supported taxonomy, location, safe-content, currency, and buyer-country parameters directly. The existing keyword requirement remains even though the endpoint allows broader queries. Etsy documents `score` ordering as descending regardless of `sort_order`; never promise ascending score. Etsy may reject an invalid/unparseable location. Do not invent category or safe-content filtering through keyword rewriting.

**Taxonomy:** M1.1 implements local name/subtree filtering over validated, cached complete trees and returns bounded flat slices with stable IDs and paths. Etsy's node routes have no server-side filters, so an upstream tree above the 1 MiB cap fails safely; no live taxonomy size has been measured. M1.3 sends a selected buyer or seller taxonomy ID directly to global active-listing search without acquiring either tree or attempting local ID validation.

**Batching:** deduplicate IDs, reject invalid/oversize lists before requests, and preserve ID-to-result mapping rather than assuming response order. Explain omitted/inaccessible IDs and all-or-nothing upstream errors without fabricating per-ID success. A 100-ID API maximum is not a guarantee the mapped output fits 128 KiB; support smaller batches and explicit truncation.

**Metadata versus content:** media reads remain metadata/URL tools, not general downloaders. Personalization fields named `instructions`, translated descriptions, alt text, and policy text remain untrusted third-party data.

## Acceptance criteria

- [ ] Category discovery can produce an ID that a filtered listing search accepts; buyer and seller taxonomy results cannot be confused.
- [ ] Batch lookup and buyer pricing preserve currency, IDs, null/unavailable fields, and bounded output.
- [ ] Direct shop, section, featured-product, and listing-review tools reach their documented routes and describe sample/completeness limits.
- [ ] Dedicated media/attribute/translation/personalization/policy tools expose selected useful fields, not unrestricted upstream objects.
- [ ] Existing tools and API-key-only setup keep working without an OAuth connection.

Dependencies: existing request protections and output conventions. Account-only fields, dedicated inventory/shipping endpoints, and all mutations belong in the other plans, not in a public-read shortcut.
