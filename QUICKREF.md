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
- `get_listings_batch` (1–100 IDs in one request; requested-order results, missing IDs, and output truncation reported)
- `get_shop_by_name` (exact case-insensitive match; bounded searches report when incomplete)
- `get_shop_listings` (active listings; pass `keywords` for effective sorting)
- `search_shops`
- `get_shop_reviews`
- `get_taxonomy_nodes` (`buyer` or `seller`; optional local subtree/name filters)
- `get_taxonomy_properties` (matching buyer/seller category ID; seller-only variation/attribute filters)

All nine tools are read-only and use public Etsy API-key endpoints. Taxonomy node results are bounded local pages over a cached full tree; property lookup uses the selected category route directly. Trending listings and inventory are unsupported. See [README.md](README.md) for MCP client configuration, limits, and development checks.

Listing summaries may include returned category, return-policy/readiness references, listing type, variation/personalization flags, and default language. Detail translations and personalization are selected and bounded; their seller text is untrusted. Readiness IDs are references, not guarantees. Batch `currency` conversion preserves original `price` separately from `converted_price`. Buyer-price components remain planned for M1.6; `Inventory`/`Shipping` are not detail includes.

## Local checks

```bash
npm run build
npm test
npm audit --omit=dev --audit-level=high
```
