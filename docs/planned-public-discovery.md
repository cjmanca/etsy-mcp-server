# Planned public discovery expansion

**Status: mixed.** M1.1 taxonomy node browsing, M1.2 category-property lookup, M1.3 active-listing search filters, M1.4 listing detail/summary enrichment, M1.5 batch listing lookup, M1.6 buyer-price components, and M2.1 direct shop discovery are implemented; all other entries remain proposals unless marked current in the [coverage matrix](api-coverage.md). Read with the [access policy](access-policy.md). This slice extends product/shop research without requiring a seller account for public data. Verify access requirements for each operation before implementation rather than assuming every GET is public.

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

## Current M1.4: listing details and selected summaries

`get_listing_details` uses the public, API-key-only `GET /v3/application/listings/{listing_id}` (`getListing`). It preserves the existing four associations and adds the verified `Translations` and `Personalization` includes. The optional `language` query is a bounded IETF language tag. Selected detail and listing-summary fields include taxonomy, return-policy and readiness IDs; listing type, customization/personalization flags, variation presence, and default listing language. Search and shop summaries use only fields returned by their respective active-listing operation; readiness references are omitted from global search and may be present on a shop-scoped or single-listing response.

Translations are mapped to a bounded language-keyed object containing only language/title/description/tags; personalization selects at most five questions and 30 options per question, including documented question/option IDs, type, required state, character/file limits, instructions and add-on `Money`. Explicit nulls remain null and absent fields stay absent. Shortened arrays/text and compacted over-limit detail responses set `truncated`; these selected responses are display summaries, not complete writable snapshots. All seller-provided instructions and localized text remain untrusted data.

`BuyerPrice` remains blocked on single-listing detail despite its enum entry; Etsy documents its field as batch-only. `Inventory` and `Shipping` are not accepted includes. `allow_suggested_title` remains disabled until Etsy clarifies the exact owner OAuth scope. No currency, buyer-country, or legacy query is sent, and no extra request is made to fill missing fields. See [listing discovery](listing-discovery.md) for caller examples and output bounds.

## Current M1.5: batch listing lookup

`get_listings_batch` uses the public, API-key-only `GET /v3/application/listings/batch` route once with 1–100 positive safe-integer IDs. Duplicate input IDs are removed in first-seen order, and rows are matched and ordered by ID rather than Etsy's response position. Etsy's `count`, source-row count, locally returned-row count, `requested_ids`, `not_returned_ids`, and `truncated` distinguish source omissions from rows dropped only to fit the 128 KiB JSON output cap. A whole-request error is one sanitized error; it is never converted into per-ID success claims.

The accepted association allowlist reuses M1.4's bounded `Shop`, `Images`, `User`, `Videos`, `Translations`, and `Personalization` mapping. Private/unselected fields, `BuyerPrice`, `Inventory`, and `Shipping` are not exposed by `get_listings_batch`. Optional uppercase `currency` requests the documented conversion; original `price` remains unchanged and a returned `converted_price` is separate structured money. Buyer country and BuyerPrice components are exposed by the separate M1.6 tool, and no `legacy` migration flag is sent because M1.5 does not require processing-profile fields or establish rollout readiness. The upstream response remains capped at 1 MiB and MCP JSON output at 128 KiB.

## Current M1.6: buyer-facing price components

`get_listing_buyer_prices` calls public, API-key-only `GET /v3/application/listings/batch` once with required `buyer_country` and `includes=BuyerPrice`; optional `currency` is also passed when supplied. Buyer country is an uppercase two-letter ISO-format price context, not a filter on listing IDs. Currency accepts the existing uppercase three-letter syntax. No local supported-country/currency list is maintained; Etsy may reject values it does not support. The separate tool does not enable `BuyerPrice` in `get_listings_batch` or `get_listing_details`; the latter remains unavailable for BuyerPrice because Etsy documents the association as batch-only.

Output selects the actual `ListingBuyerPrice` fields: `base_price`, `shipping_cost`, `is_free_shipping`, `original_price`, `discounted_price`, `discount_amount`, `discount_percentage`, `has_discount`, `discount_start_epoch`, and `discount_end_epoch`. Money is normalized using the shared structured-money helper and preserves raw `amount`, `divisor`, and `currency_code`; no `/100` scaling or derived values are added. The listing's original formatted `price` and optional separate `converted_price` are retained alongside `buyer_price`. Absent fields stay absent and explicit null/zero/false values stay distinct. Invalid/unsafe money fails the whole request with a sanitized upstream error.

Per Etsy's current schema, `base_price` includes VAT and excludes shipping; `shipping_cost` includes VAT where applicable and may be null for free or unavailable shipping, distinguished only by the returned `is_free_shipping` flag. `original_price` is the display price (UK: base plus shipping under DMCC; elsewhere: base only), and `discounted_price` follows the same country-dependent display treatment. These fields are not a final checkout quote or a basis for invented taxes/totals. IDs, source-response validation, omissions, output trimming, the 10-second timeout, 1 MiB upstream limit, 128 KiB output cap, and untrusted-content notice retain the M1.5 shared batch behavior.

## Current M2.1: direct shop discovery

`get_shop` calls public API-key-only `GET /v3/application/shops/{shop_id}` (`getShop`) directly. `get_shop_by_owner` calls public API-key-only `GET /v3/application/users/{user_id}/shops` (`getShopByOwnerUserId`). Both require positive safe-integer numeric IDs and send no query parameters; neither calls `findShops`. Etsy documents each 200 response as one `Shop` object, not a result page. Both tools reuse the selected bounded shop-profile mapping from `get_shop_by_name`; only shop ID/name/title, announcement, currency, vacation state/messages, sale messages, creation timestamps, active-listing count, and URL can be returned. Missing shop resources retain Etsy's sanitized 404 error. A public owner-ID lookup does not prove caller ownership or authorize account access. Text remains untrusted and bounded, with shortening reported through `truncated`.

## Current M2.2: shop sections and featured catalog

The four public, API-key-only reads are:

- `get_shop_sections`: `GET /v3/application/shops/{shop_id}/sections` (`getShopSections`), returning a `ShopSections` page with selected `shop_section_id`, `title`, `rank`, `user_id`, and `active_listing_count` fields.
- `get_shop_section`: `GET /v3/application/shops/{shop_id}/sections/{shop_section_id}` (`getShopSection`), returning the same selected section fields. Etsy marks every `ShopSection` property optional. When returned, the section ID (and any supplied shop parent reference) must match the request; no shop-profile lookup is made to infer section ownership.
- `get_shop_section_listings`: `GET /v3/application/shops/{shop_id}/shop-sections/listings` (`getListingsByShopSectionId`). One positive `shop_section_id` is passed as the required query array `shop_section_ids=<id>`; this is **not** a `/sections/{id}/listings` route. The MCP tool accepts the endpoint-declared `limit`, `offset`, `sort_on`, `sort_order`, and optional boolean `legacy` fields. `score` is forced to descending; Etsy notes sorting only works with search options, but this endpoint declares no keyword filter. The `legacy` value is omitted by default and merely forwarded when explicitly supplied; processing-profile rollout semantics are not inferred.
- `get_featured_shop_listings`: `GET /v3/application/shops/{shop_id}/listings/featured` (`getFeaturedListingsByShop`), accepting only `limit`, `offset`, and its declared optional boolean `legacy`; no sort/search/date/trend filter is invented. It represents products selected as featured by the shop, not an Etsy-wide trending or popularity ranking. A returned `featured_rank` is mapped only from Etsy's field; neither rank nor order is inferred.

All four validate positive safe-integer IDs before requests and apply the existing 25-row default, 1–100 page bound, offset bound, 10-second request timeout, 1 MiB upstream cap, 128 KiB output cap, selected listing mapper, sanitized error handling, and untrusted-content notice. List responses report Etsy's `count`, displayed `returned`, and `truncated`; no tool claims a complete snapshot after a bound. An empty section/list and a zero active-listing count are valid. Supplied shop/section parent IDs in returned section/listing objects are checked against the request; absent references are not invented and public owner IDs do not establish caller authorization. Only selected section and M1.4 listing-summary fields are exposed.

## Remaining proposed MCP capabilities

| Tool or extension | Main inputs | User-facing result |
| --- | --- | --- |
| Further listing detail and summary extensions | Listing ID; additional associations or fields verified against each operation. | Only operation-supported, selected public fields. |
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

- [x] Category discovery can produce an ID that a filtered listing search accepts; buyer and seller taxonomy results cannot be confused (mocked end-to-end M1.6 sequence plus buyer/seller route coverage; no live availability claim).
- [x] Batch lookup and buyer pricing preserve currency, IDs, null/unavailable fields, and bounded output (M1.5/M1.6 mocked verification; no live availability claim).
- [x] Direct shop-ID and public owner-ID lookup use their documented routes and selected profile output without changing exact-name search (M2.1 mocked verification; no caller-ownership claim).
- [x] Shop organization and featured-product tools reach their documented public routes and distinguish a shop's curated featured selection from trending (M2.2; mocked verification only).
- [ ] Listing-review tools reach their documented routes and describe sample/completeness limits.
- [ ] Dedicated media/attribute/translation/personalization/policy tools expose selected useful fields, not unrestricted upstream objects.
- [ ] Existing tools and API-key-only setup keep working without an OAuth connection.

Dependencies: existing request protections and output conventions. Account-only fields, dedicated inventory/shipping endpoints, and all mutations belong in the other plans, not in a public-read shortcut.
