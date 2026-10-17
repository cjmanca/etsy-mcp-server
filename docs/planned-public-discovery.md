# Planned public discovery expansion

**Status: mixed.** M1.1 taxonomy node browsing, M1.2 category-property lookup, M1.3 active-listing search filters, M1.4 listing detail/summary enrichment, M1.5 batch listing lookup, M1.6 buyer-price components, M2.1 direct shop discovery, M2.2 shop sections/featured listings, M2.3 listing reviews, M2.4 dedicated media metadata, M2.5a listing-properties list, M2.6 personalization/translation reads, M2.7a public return-policy list/detail reads, M2.8 carrier/connectivity diagnostics, and the M2.9 public offering read are implemented; M2.9 remains pending independent review in `TASK.md`. M2.5b single-property detail remains blocked by Etsy's 501-only reference, and M2.7b policy-linked listing lookup remains behind M3 OAuth. All other entries remain proposals unless marked current in the [coverage matrix](api-coverage.md). Read with the [access policy](access-policy.md). This slice extends product/shop research without requiring a seller account for public data. Verify access requirements for each operation before implementation rather than assuming every GET is public.

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

## Current M2.7a: public return-policy reads

The public, API-key-only pair is:

- `get_shop_return_policies`: `GET /v3/application/shops/{shop_id}/policies/return` (`getShopReturnPolicies`). Requires one positive safe-integer `shop_id`; Etsy declares no query parameters.
- `get_shop_return_policy`: `GET /v3/application/shops/{shop_id}/policies/return/{return_policy_id}` (`getShopReturnPolicy`). Requires positive safe-integer `shop_id` and `return_policy_id`; Etsy declares no query parameters.

Both select only `return_policy_id`, `shop_id` when returned, `accepts_returns`, `accepts_exchanges`, and `return_deadline`. Optional fields remain absent when Etsy omits them; booleans and nullable deadlines preserve their source values, with non-null deadlines limited to Etsy's documented values 7, 14, 21, 30, 45, 60, or 90 days. Returned IDs and any supplied shop reference are validated against the request, duplicate list policy IDs are rejected, and private or unselected fields are omitted. The unpaged list requires a valid `results` array; when Etsy supplies `count`, it must match the complete source array length before the 100-row display cap or shared 128 KiB output trimming. It reports `returned`/`truncated` for displayed rows, and empty lists are valid; missing or malformed arrays are not inferred to be empty.

These reads do not enumerate policy-linked listings or prove shop ownership. `getListingsByShopReturnPolicy` is a separate OAuth operation requiring `listings_r`; it declares no paging controls and remains M2.7b behind M3. Policy fields do not establish legal compliance, a refund outcome, or the full effect of a policy change.

## Current M2.8: carrier lookup and application connectivity

`get_shipping_carriers` uses the public, API-key-only `GET /v3/application/shipping-carriers` (`getShippingCarriers`). Its only declared query parameter is required `origin_country_iso`; the MCP tool requires exactly an uppercase two-letter ISO 3166-1 alpha-2 syntax and does not maintain a country registry. Etsy may reject a syntactically valid country that it does not support. No carrier, mail-class, pagination, URL, or other filter is declared or accepted.

The `ShippingCarriers` response declares optional `count` and `results`. When supplied, `results` must be an array; an explicit empty array is valid, while missing results remain omitted rather than being reported as an empty list. A supplied count must match the complete unpaged source array before local truncation. Output selects only `shipping_carrier_id`, `name`, `domestic_classes`, and `international_classes`; each class selects only `mail_class_key` and `name`. Carrier IDs are positive Etsy `int64` integers (schema minimum 1), not listing IDs: zero, negative values, strings, and unsafe JavaScript integers are rejected. Returned identities are checked for duplicates only when the optional ID/key is present. Carrier rows are capped at 100, each class array at 50, and labels at 200 characters, with `returned`, source `count` when supplied, `truncated`, and the shared 128 KiB JSON cap. Carrier and mail-class names are untrusted Etsy text. This lookup is reference data only; it does not create shipping settings, purchase postage, or generate labels.

`ping_etsy` uses the public, API-key-only `GET /v3/application/openapi-ping`, with no path variables, query parameters, caller URL, or caller credential. Its documented `Pong` object has an optional positive `int64` `application_id` (schema minimum 1); the selected output preserves it only when Etsy supplies a positive safe integer and does not make it mandatory. A successful HTTP response is reported as application connectivity only. Neither the response nor tool description claims OAuth scope grants, account ownership, seller authorization, or access to private resources.

## Current M2.9: public listing-offering drill-down

`get_listing_offering` uses the API-key-only `GET /v3/application/listings/{listing_id}/products/{product_id}/offerings/{product_offering_id}` (`getListingOffering`), not the OAuth-protected `/inventory` product route. It requires three positive safe-integer numeric path IDs. The only declared query field is optional boolean `legacy`; it is omitted unless explicitly supplied, and no processing-profile rollout or production-eligibility claim is made.

The one-object response selects optional `offering_id`, `quantity`, `is_enabled`, `is_deleted`, `price`, and `readiness_state_id`. Returned offering and optional listing/product parent IDs are checked against the path; missing references are not inferred or returned. Quantity zero, false flags, and nullable readiness IDs are retained as supplied. Money remains raw `{ amount, divisor, currency_code }` with no `/100` conversion or derived price. Missing price stays absent; null or malformed Money, empty records, invalid ranges, and unsafe IDs fail with sanitized errors. SKUs, owner/buyer/account data, and unselected fields are never exposed. Readiness is a reference, not a processing-time, rollout, stock, or sellability guarantee. The shared 10-second request timeout, 1 MiB upstream cap, 128 KiB JSON output cap, and untrusted-content notice remain in force.

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

## Current M2.3: product review samples

`get_listing_reviews` requests one page from the public, API-key-only `GET /v3/application/listings/{listing_id}/reviews` (`getReviewsByListing`) per tool call; it does not crawl pages. It requires a positive safe-integer listing ID and accepts only `limit`, `offset`, `min_created`, and `max_created` in addition. Page defaults and bounds match `get_shop_reviews`: limit 25 (1–100), offset 0 (0–12000), whole Unix-second timestamps from 946684800 onward, and an ordered date range. The shared transport retry policy still applies. There are no sort, reply, review-write, or buyer-lookup parameters.

The tool reuses the selected shop-review mapper and paging/serializer conventions: only shop/listing IDs when supplied, rating, review text, and creation/update timestamps are retained. Missing optional fields remain absent; no listing ID is invented from the request, and any supplied listing ID must match it. Buyer identities, transaction/private fields, image URLs, and other raw fields are omitted. Review text is untrusted, capped at 1,000 characters, and output remains within the shared 128 KiB bound. Etsy's `count` is the source result count, `returned` is the included row count after trimming, and `truncated` flags shortened text or removed rows. The page is a sample, not a complete review history or order count.

## Current M2.4: dedicated media metadata

The four public, API-key-only tools use the exact image and video metadata routes:

- `get_listing_images`: `GET /v3/application/listings/{listing_id}/images` (`getListingImages`).
- `get_listing_image`: `GET /v3/application/listings/{listing_id}/images/{listing_image_id}` (`getListingImage`).
- `get_listing_videos`: `GET /v3/application/listings/{listing_id}/videos` (`getListingVideos`).
- `get_listing_video`: `GET /v3/application/listings/{listing_id}/videos/{video_id}` (`getListingVideo`).

Only the required positive safe-integer IDs are accepted. None of these operations declares query parameters, so list tools do not invent paging. Each call makes exactly one fixed-origin GET; only selected IDs, image rank/dimensions/alt text/URL variants/color summary, or video dimensions/state/URLs are mapped. Non-null image rank and dimensions are retained as nonnegative safe integers; dimensions are nullable, and full dimensions have no schema maximum. The rank schema permits zero even though its description says positive/non-zero; accepting zero follows the schema and does not assert that zero occurs in live Etsy data. The 3,000-pixel figure describes the `url_fullxfull` rendition, not a limit on the dimension metadata. Missing metadata remains absent and explicit nulls remain null. Supplied parent/media IDs are checked for request mismatch; duplicate non-null media IDs fail the list. The optional image `listing_id` response field is checked when supplied. The official `ListingVideo` schema does not include `listing_id`, so its absence is valid; an extra supplied parent reference is still checked.

Image and video URLs and image alt text are untrusted bounded strings, not instructions. URLs remain JSON data and are never fetched or followed. Each list requires a valid `results` array, preserves Etsy's optional `count` only when present, reports `returned`, and marks the 20-image/10-video and shared 128 KiB output bounds with `truncated`. The existing listing `Images` and `Videos` includes remain compatible, gain selected image rank/dimensions/alt text, and do not trigger additional calls. See [listing discovery](listing-discovery.md#read-dedicated-listing-media-metadata) for input/output examples and limits.

## Current M2.5a: selected listing properties

`get_listing_properties` uses the public, API-key-only `GET /v3/application/shops/{shop_id}/listings/{listing_id}/properties` (`getListingProperties`) once with positive safe-integer `shop_id` and `listing_id`. The operation declares no query parameters. It returns only the selected property fields `property_id`, `property_name`, `scale_id`, `scale_name`, `value_ids`, and `values`; these are listing-selected values, not category-allowed taxonomy values. The optional source `count` may be zero and, when supplied, must equal the unpaged `results` length. An empty `results` array is valid; a missing `results` array is malformed. Optional schema fields stay omitted when absent, and nullable `property_name`, `scale_id`, and `scale_name` preserve explicit nulls. IDs are positive safe integers.

The list is bounded to 100 properties and 25 selected IDs/labels per property, with text up to 200 characters and the shared 128 KiB output cap. Any local shortening sets `truncated`; unrecognized and private fields are omitted, and selected property/scale/value text is untrusted. If parent listing/shop references are supplied upstream, they are checked against the requested IDs; their absence is not filled in, and the caller's shop ID does not prove ownership.

## M2.5b: single-property detail remains blocked

The paired `get_listing_property` operation (`GET /v3/application/listings/{listing_id}/properties/{property_id}`) is currently feedback-only and explicitly returns HTTP 501. Do not register a tool or invent a fallback route until Etsy releases the operation.

## Current M2.6: personalization and translation reads

`get_listing_personalization` calls the public, API-key-only `GET /v3/application/listings/{listing_id}/personalization` (`getListingPersonalization`) once with a positive safe-integer `listing_id` and no query parameters. It selects the current `personalization_questions` array when Etsy supplies it: at most five questions and 30 options per question, with question/option IDs, question text, seller instructions, type, required state, character/file limits, options, and nullable add-on `Money`. Existing M1.4 selected mappers are reused, so missing and null fields, false/zero values, array/string truncation, and raw Money amount/divisor/currency semantics remain consistent. The dedicated response's optional question field stays absent when missing; an explicit empty array is distinct and is Etsy's documented no-personalization result. Deprecated single-instruction fields are not converted into questions.

The migration guide lists `text_input`, `dropdown`, `unlabeled_upload`, and `labeled_upload` questions and describes limits for seller writes. This read reports returned values; it does not validate an editable snapshot or claim unsupported question types can be written. Etsy documents that its GET may return existing instructions longer than 120 characters; this server's display bound is 120 and `truncated` is set when shortening occurs. Add-on pricing is currently described for optional text inputs. Read responses may return `null` when no price is configured or for other question types; when a Money value is returned, its raw integer amount, positive divisor, and currency are preserved without scaling. Seller-authored instructions/labels and any file URLs are untrusted text/data; URLs are never fetched.

`get_listing_translation` calls the public, API-key-only `GET /v3/application/shops/{shop_id}/listings/{listing_id}/translations/{language}` (`getListingTranslation`) once, with positive safe-integer shop/listing IDs and the required language tag in the path. It sends no query parameters and selects only an upstream `listing_id` when present plus `language`, `title`, `description`, and `tags`; each field remains absent when Etsy omits it. The requested language is not copied into a missing response field. Supplied shop/listing references are checked against the route IDs, but a caller-supplied shop ID does not prove ownership.

Etsy describes `language` as an IETF language tag. The tool enforces a 35-character bound and BCP 47 tag structure, including syntactically valid extlang forms such as `zh-cmn` and `ar-aao`; it does not consult the IANA registry or verify Etsy language availability. `Intl.getCanonicalLocales` is not used because it rejects some valid extlang tags. Etsy may reject a syntactically valid but unregistered or unavailable tag. This is bounded syntax validation, not a claim of complete registry validation. Translated titles, descriptions, tags, and language metadata remain untrusted third-party data.

## Remaining proposed MCP capabilities

| Tool or extension | Main inputs | User-facing result |
| --- | --- | --- |
| Further listing detail and summary extensions | Listing ID; additional associations or fields verified against each operation. | Only operation-supported, selected public fields. |
| `get_listing_properties` | Shop ID and listing ID. | **Current M2.5a:** bounded actual listing-selected values. |
| `get_listing_property` | Listing ID and property ID. | **Blocked M2.5b:** current Etsy reference promises only HTTP 501. |
| `get_shop_return_policies`, `get_shop_return_policy` | Shop ID; return-policy ID for detail. | **Current M2.7a:** selected public return-policy fields; no associated-listing or legal-compliance claims. |
| `get_return_policy_listings` | Connection ID, shop ID, return-policy ID; no paging query declared. | Authorized products associated with a policy (`listings_r`); follows M3, not a public-only tool. |

The public offering read is current M2.9 as described above; the related inventory/product reads remain OAuth-protected proposals.

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
- [x] Listing-review tools reach their documented routes and describe sample/completeness limits (M2.3; mocked contract and bounds tests).
- [x] Dedicated image/video tools reach the four documented metadata routes, match supplied IDs, bound selected output, and never fetch returned URLs (M2.4; mocked contract and bounds tests).
- [x] Personalization and translation tools reach their documented public GET routes, reuse selected M1.4 mapping, preserve raw add-on Money and missing/null fields, validate bounded language-tag syntax without a registry claim, and treat seller/localized text as untrusted (M2.6; mocked contract and bounds tests).
- [x] Carrier discovery and application ping use their exact public API-key GET contracts, bounded selected responses, safe diagnostics, and no unsupported filters or OAuth-access claims (M2.8; mocked contract and bounds tests).
- [ ] Remaining attribute and policy tools expose selected useful fields, not unrestricted upstream objects; M2.6 translation and personalization reads are current above.
- [ ] Existing tools and API-key-only setup keep working without an OAuth connection.

Dependencies: existing request protections and output conventions. Account-only fields, dedicated inventory/shipping endpoints, and all mutations belong in the other plans, not in a public-read shortcut.
