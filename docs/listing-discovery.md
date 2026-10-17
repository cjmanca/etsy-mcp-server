# Listing discovery and details

**Status: implemented.** Use this slice for product searches and individual listing inspection. Pair it with [response handling](response-handling-and-safety.md) when consuming results.

## Search active products

`search_listings` searches Etsy's active listings. It requires `keywords`: nonempty text of at most 200 characters. It accepts:

| Option | Meaning |
| --- | --- |
| `min_price`, `max_price` | Finite, nonnegative price bounds; maximum must not be below minimum. No currency-selection option is exposed. |
| `limit`, `offset` | Page size 1–100 (default 25), offset 0–12000 (default 0). |
| `sort_on` | `created`, `price`, `updated`, or `score`. |
| `sort_order` | `asc`, `ascending`, `desc`, `descending`, `up`, or `down`. |

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

Each result can include listing ID, title, description excerpt, formatted price and currency, URL, shop ID, quantity, state, creation/update timestamps, and tags. Missing upstream fields may be omitted; price is `N/A` when a usable money value is unavailable. Do not compare prices across different currencies as if they were equivalent.

The MCP tool does not currently expose category, location, currency, or other advanced search filters. It requires keywords even if an upstream API allows broader searches. `score` is a search ordering, not a documented measure of trending demand or sales.

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
