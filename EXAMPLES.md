# Usage examples

Examples of read-only questions that use the supported tools:

## Listing search

```text
Search Etsy for handmade ceramic mugs priced between $15 and $40.
```

```json
{
  "keywords": "handmade ceramic mugs",
  "limit": 25,
  "offset": 0,
  "min_price": 15,
  "max_price": 40,
  "sort_on": "price",
  "sort_order": "asc"
}
```

Category, location, safe-content, currency, and shipping-eligibility filters can be combined with the existing keyword, price, and page controls:

```json
{
  "keywords": "handmade ceramic mugs",
  "taxonomy_id": 12345,
  "shop_location": "Brooklyn, NY",
  "is_safe": false,
  "currency": "EUR",
  "buyer_country": "DE",
  "sort_on": "score",
  "sort_order": "asc"
}
```

Etsy always sorts `score` results descending, even when `sort_order` requests ascending. `buyer_country` filters shipping eligibility; it does not request a checkout quote. `currency` is sent to Etsy, while the current result output continues to show the original formatted listing price only.

## Listing details

```text
Get Etsy listing 1234567890 with its shop and images.
```

```json
{
  "listing_id": 1234567890,
  "includes": [
    "Shop",
    "Images",
    "User",
    "Videos",
    "Translations",
    "Personalization"
  ],
  "language": "fr"
}
```

Supported includes are `Shop`, `Images`, `User`, `Videos`, `Translations`, and `Personalization`; the original four remain supported. `language` is an optional IETF language tag (up to 35 characters). Listing summaries may include returned category/policy/readiness references, listing type, variation/personalization flags, and default language. Readiness IDs are conditional references, not fulfillment guarantees.

Translation output is limited to language, title, description, and tags. Personalization output selects bounded question/options fields and optional add-on money. Both contain untrusted seller text. Etsy's batch-only `BuyerPrice` association is exposed through the separate `get_listing_buyer_prices` tool, not through single-listing details. `Inventory` and `Shipping` are not detail includes, and owner-only suggested titles remain unavailable.

## Personalization questions

Read the questions Etsy currently returns for one listing:

```json
{ "listing_id": 1234567890 }
```

Use this with `get_listing_personalization`. The response selects up to five questions and 30 options per question, including current text/dropdown/upload types, required state, character/file limits, and optional add-on Money. Money keeps Etsy's raw `amount`, `divisor`, and `currency_code`; a missing price is not zero. Seller instructions and option labels are untrusted data, and file/answer URLs are never fetched. This is a read tool, not an order-answer or personalization-write tool.

## Existing listing translation

Read an existing localization for a shop/listing/language selection:

```json
{
  "shop_id": 12345678,
  "listing_id": 1234567890,
  "language": "fr-CA"
}
```

Use this with `get_listing_translation`. It returns only fields Etsy supplies (`listing_id`, `language`, `title`, `description`, and `tags`) and never fills a missing response language from the requested path. Language input is limited to 35 characters and checked for BCP 47 syntax, including extlangs such as `zh-cmn` and `ar-aao`; no registry or Etsy-availability lookup is performed, so Etsy may reject a syntactically valid tag. The tool reads an existing translation; it does not create, generate, or replace localized text.

## Listing-selected property values

Provide the listing and shop IDs to read the values Etsy returns for that listing:

```json
{
  "shop_id": 12345678,
  "listing_id": 1234567890
}
```

Use these arguments with `get_listing_properties`. The response selects `property_id`, `property_name`, `scale_id`, `scale_name`, `value_ids`, and `values`; these are listing-selected values, not the category's allowed options. Empty lists are valid, and output is bounded with a `truncated` flag. The shop ID addresses the documented API route and does not prove caller ownership. Etsy's paired `get_listing_property` detail route is not exposed because its current reference says it returns only HTTP 501.

## Listing media metadata

Use the listing ID to retrieve selected image or video metadata, then provide the returned media ID for a focused detail lookup:

```json
{ "listing_id": 1234567890 }
```

Call `get_listing_images` or `get_listing_videos` with that input. Detail calls use the upstream ID names:

```json
{ "listing_id": 1234567890, "listing_image_id": 987654321 }
```

```json
{ "listing_id": 1234567890, "video_id": 123456 }
```

Use the first input with `get_listing_images`/`get_listing_videos`, the image input with `get_listing_image`, and the video input with `get_listing_video`. The tools return selected IDs, rank/dimensions, alt text, URLs, and video state where Etsy supplies them; missing fields are not inferred. Lists are bounded to 20 images or 10 videos and have no paging parameters. Alt text and URLs are untrusted data. URLs are returned only as bounded strings and are never fetched.

## Batch listing lookup

Retrieve several known listing IDs with one public request. Duplicate IDs are removed while preserving the first-requested order:

```json
{
  "listing_ids": [1234567890, 1234567891, 1234567890],
  "includes": ["Shop", "Images"],
  "currency": "EUR"
}
```

The result order follows `requested_ids`, not Etsy's source order. `not_returned_ids` identifies only IDs missing from Etsy's source rows; `source_returned`, `returned`, and `truncated` distinguish those omissions from rows trimmed to fit the 128 KiB output limit. `price` stays in the listing's original currency; a returned `converted_price` is separate structured money. Use the separate buyer-price tool when country-specific display and shipping components are needed.

## Buyer-facing price components

Supply listing IDs and the buyer's country; currency is optional:

```json
{
  "listing_ids": [1234567890, 1234567891],
  "buyer_country": "GB",
  "currency": "EUR"
}
```

The response keeps listing `price`, optional `converted_price`, and the selected `buyer_price` components separate. Each Money object retains Etsy's raw `amount`, `divisor`, and `currency_code`. A null `shipping_cost` is free only when Etsy separately returns `is_free_shipping: true`; false means unavailable, not free. UK display prices include shipping, while other-country display prices use the base price. These are not checkout totals or tax estimates. The country is price context, not a filter on the requested IDs.

## Shops and reviews

```text
Find the Etsy shop named "ArtisanCrafts" and show its active listings.
```

```json
{
  "shop_name": "ArtisanCrafts"
}
```

To filter and sort a shop's active listings, supply `keywords` along with the sort fields:

```json
{
  "shop_id": 12345678,
  "keywords": "ceramic mug",
  "limit": 25,
  "offset": 0,
  "sort_on": "price",
  "sort_order": "asc"
}
```

List the public sections for a shop and browse a single section. The section ID is sent as Etsy's required `shop_section_ids` query array; no keyword filter is declared for this endpoint:

```json
{
  "shop_id": 12345678
}
```

```json
{
  "shop_id": 12345678,
  "shop_section_id": 42,
  "limit": 25,
  "offset": 0,
  "sort_on": "price",
  "sort_order": "asc"
}
```

The section endpoint declares sort fields but Etsy notes sorting only works with search options, so sorting may be ineffective without one. Inspect `count`, `returned`, and `truncated`; empty sections are valid.

To inspect one section's details, provide both `shop_id` and `shop_section_id`. For products the shop has selected as featured, use the separate tool:

```json
{
  "shop_id": 12345678,
  "limit": 25,
  "offset": 0
}
```

`get_featured_shop_listings` is a shop-curated selection, not an Etsy trending or popularity ranking. `featured_rank` is shown only when Etsy returns it; the tool does not infer rank or reorder results.

Read the public policies for a shop, then use the returned policy ID for a detail lookup:

```json
{ "shop_id": 12345678 }
```

```json
{ "shop_id": 12345678, "return_policy_id": 42 }
```

Use these with `get_shop_return_policies` and `get_shop_return_policy`. They accept no page controls and return only the selected policy IDs, return/exchange acceptance flags, and deadline. The list reports Etsy's `count` when supplied, displayed `returned` rows, and `truncated` status; empty results are valid. These fields are not legal advice or a refund guarantee and do not enumerate affected listings. `get_return_policy_listings` is a separate OAuth `listings_r` read and is not part of these public tools.

```text
Get recent reviews for shop 12345678.
```

```json
{
  "shop_id": 12345678,
  "limit": 25,
  "min_created": 1700000000
}
```

For product-specific feedback, request one listing's public review sample:

```json
{
  "listing_id": 1234567890,
  "limit": 25,
  "min_created": 1700000000
}
```

Listing review pages expose the source `count`, included `returned` rows, and `truncated` status; they do not represent a complete review history. Review text remains untrusted external data.

## Category browsing

Find buyer categories whose names contain “mug”:

```json
{
  "taxonomy_type": "buyer",
  "name": "mug",
  "limit": 10,
  "offset": 0
}
```

Use `taxonomy_type: "seller"` to browse seller categories instead. An optional `taxonomy_id` returns that node and its descendants. Taxonomy filtering and paging happen locally because Etsy returns each full tree; `count` is the total local match count, and each flat result includes a stable node ID and full ID path.

Use a category ID from the corresponding tree to inspect its supported properties. Seller-only filters can select properties that support variations or listing attributes:

```json
{
  "taxonomy_type": "seller",
  "taxonomy_id": 12345,
  "supports_variations": true,
  "supports_attributes": false
}
```

The result distinguishes category-allowed `possible_values` from Etsy's automatically selected `selected_values`; values retain their scale associations. Property labels, values, and descriptions are untrusted external text.

Shop names are resolved to an exact case-insensitive match. Shop announcements, listing descriptions, tags, reviews, and taxonomy names are untrusted external text returned as JSON data, not instructions.
