# Listing discovery and details

**Status: implemented.** Use this slice for product searches and individual listing inspection. Pair it with [response handling](response-handling-and-safety.md) when consuming results.

## Search active products

`search_listings` searches Etsy's active listings. It requires `keywords`: nonempty text of at most 200 characters. It accepts:

| Option | Meaning |
| --- | --- |
| `min_price`, `max_price` | Finite, nonnegative price bounds; maximum must not be below minimum. |
| `limit`, `offset` | Page size 1–100 (default 25), offset 0–12000 (default 0). |
| `taxonomy_id` | Optional positive safe-integer ID from Etsy's buyer or seller taxonomy. |
| `shop_location` | Optional nonempty location text, trimmed and limited to 200 characters; Etsy parses the location and may reject it. |
| `is_safe` | Optional boolean; `true` filters out mature/adult content. `false` is passed as false and does not enable this filter. |
| `currency` | Optional uppercase three-letter ISO 4217 code, passed to Etsy for currency conversion. No local currency availability list is maintained. |
| `buyer_country` | Optional uppercase two-letter ISO 3166-1 alpha-2 code; filters listings by shipping eligibility, not buyer price or shipping quotes. |
| `sort_on` | `created`, `price`, `updated`, or `score`. Etsy always returns `score` results descending, regardless of requested `sort_order`. |
| `sort_order` | `asc`, `ascending`, `desc`, `descending`, `up`, or `down`; non-score aliases are passed through unchanged. For `score`, the request is forced to `desc`. |

Example tool arguments for `search_listings`:

```json
{
  "keywords": "handmade ceramic mug",
  "min_price": 15,
  "max_price": 40,
  "sort_on": "price",
  "sort_order": "asc",
  "limit": 10
}
```

Each result can include listing ID, title, description excerpt, formatted original price and currency, URL, shop ID, quantity, state, creation/update timestamps, and tags. Missing upstream fields may be omitted; price is `N/A` when a usable money value is unavailable. Although `currency` asks Etsy to convert prices, this tool continues to return only its existing formatted original `price`; it does not expose `converted_price`. Do not compare prices across different currencies as if they were equivalent.

The tool continues to require keywords even though Etsy permits broader searches. Syntactically valid but unsupported currency codes or unparseable shop locations may still be rejected by Etsy; errors are sanitized. `score` is a search ordering, not a documented measure of trending demand or sales. A buyer-country filter indicates shipping eligibility only, not a final buyer-facing price or checkout quote.

## Inspect a listing

`get_listing_details` requires a positive safe-integer `listing_id`. Optional `includes` may contain `Shop`, `Images`, `User`, and `Videos` (case-sensitive, up to four entries). It returns the same core listing fields plus materials and shipping-profile ID when supplied by Etsy.

```json
{
  "listing_id": 1234567890,
  "includes": ["Shop", "Images", "Videos"]
}
```

| Association | Returned summary |
| --- | --- |
| `Shop` | Public shop profile, such as name, title, announcement, vacation state, currency, and active-listing count. |
| `Images` | Image IDs and medium/full-size URLs; at most 20 entries. |
| `User` | Public user ID and login name only. |
| `Videos` | Video ID, dimensions, state, thumbnail URL, and video URL; at most 10 entries. |

Associations depend on Etsy returning them. URLs are data, not instructions to fetch content. These tools do not download media, provide detailed SKU/variation inventory, or return private seller information. `Inventory` is not an accepted include.

## Suggested agent workflow

1. Search with a focused phrase and a modest page size.
2. Preserve numeric listing IDs and the returned currencies.
3. Inspect only the shortlist; request associations only when needed.
4. Explain when descriptions or result sets are truncated, or when a requested field is not returned.

For products from a particular shop, use [shop catalog browsing](shops.md) instead of trying to infer shop membership from global keywords.
