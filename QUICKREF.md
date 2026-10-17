# Quick reference

## Install and build

```bash
npm ci --ignore-scripts
npm run build
```

Requires Node.js 22 or later. Configure your MCP client to run `node /absolute/path/to/etsy-mcp-server/build/index.js` and provide:

```text
ETSY_API_KEY=<keystring>:<shared_secret>
```

## Tools

- `search_listings` (category/location/safe-content/currency/shipping-country filters; score is always descending)
- `get_listing_details` (`Shop`, `Images`, `User`, `Videos`, `Translations`, `Personalization`; optional IETF `language`)
- `get_listing_images`, `get_listing_image` (selected image metadata by listing/image ID; rank, dimensions, alt text, bounded URLs)
- `get_listing_videos`, `get_listing_video` (selected video metadata by listing/video ID; dimensions, state, bounded URLs)
- `get_listings_batch` (1–100 IDs in one request; requested-order results, missing IDs, and output truncation reported)
- `get_listing_buyer_prices` (1–100 IDs plus required buyer country; separate base/display/discount/shipping components)
- `get_shop_by_name` (exact case-insensitive match; bounded searches report when incomplete)
- `get_shop` (direct public profile lookup by shop ID)
- `get_shop_by_owner` (public profile lookup by owner user ID; does not prove caller ownership)
- `get_shop_listings` (active listings; pass `keywords` for effective sorting)
- `get_shop_sections`, `get_shop_section` (public section details and active-listing counts)
- `get_shop_section_listings` (active listings from one section; sorting may be ineffective without search options)
- `get_featured_shop_listings` (products curated by the shop, not a platform trend ranking)
- `search_shops`
- `get_shop_reviews`
- `get_listing_reviews` (one public listing review page; optional date filters)
- `get_taxonomy_nodes` (`buyer` or `seller`; optional local subtree/name filters)
- `get_taxonomy_properties` (matching buyer/seller category ID; seller-only variation/attribute filters)

All twenty-one tools are read-only and use public Etsy API-key endpoints. Media URLs are bounded data only and are never fetched; media list tools have no paging parameters. Taxonomy node results are bounded local pages over a cached full tree; property lookup uses the selected category route directly. Platform-wide trending listings and inventory are unsupported; shop-curated featured products are available separately. See [README.md](README.md) for MCP client configuration, limits, and development checks.

Listing summaries may include returned category, return-policy/readiness references, listing type, variation/personalization flags, and default language. Detail translations and personalization are selected and bounded; their seller text is untrusted. Readiness IDs are references, not guarantees. Batch `currency` conversion preserves original `price` separately from `converted_price`. Buyer-price output keeps original, converted, display, discount, and shipping components separate, with raw money units preserved; it is not a checkout quote. `Inventory`/`Shipping` are not detail includes.

## Local checks

```bash
npm run build
npm test
npm audit --omit=dev --audit-level=high
```
