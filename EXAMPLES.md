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
  "includes": ["Shop", "Images"]
}
```

Supported includes are `Shop`, `Images`, `User`, and `Videos`. Inventory is not included.

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
