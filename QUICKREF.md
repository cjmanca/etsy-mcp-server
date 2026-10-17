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

OAuth remains disabled by default. After completing the operator-only protected-storage and callback setup in [setup and access](docs/setup-and-access.md#optional-browser-based-account-connection), exact `ETSY_OAUTH_ENABLED=true` conditionally adds `begin_etsy_connection`. The existing twenty-nine public tools remain available; no private data or seller-write tools are exposed by this connect flow.

## Tools

- `search_listings` (category/location/safe-content/currency/shipping-country filters; score is always descending)
- `get_listing_details` (`Shop`, `Images`, `User`, `Videos`, `Translations`, `Personalization`; optional IETF `language`)
- `get_listing_offering` (one selected offering by listing/product/offering IDs; public API-key route, separate from private inventory/product reads)
- `get_listing_properties` (bounded selected values for a listing; requires shop and listing IDs, not category-allowed options)
- `get_listing_personalization` (bounded current questions/options and raw add-on Money; seller instructions are untrusted)
- `get_listing_translation` (existing localized title/description/tags; syntax-bounded language tag, no registry/availability lookup)
- `get_listing_images`, `get_listing_image` (selected image metadata by listing/image ID; rank, dimensions, alt text, bounded URLs)
- `get_listing_videos`, `get_listing_video` (selected video metadata by listing/video ID; dimensions, state, bounded URLs)
- `get_listings_batch` (1–100 IDs in one request; requested-order results, missing IDs, and output truncation reported)
- `get_listing_buyer_prices` (1–100 IDs plus required buyer country; separate base/display/discount/shipping components)
- `get_shop_by_name` (exact case-insensitive match; bounded searches report when incomplete)
- `get_shop` (direct public profile lookup by shop ID)
- `get_shop_by_owner` (public profile lookup by owner user ID; does not prove caller ownership)
- `get_shop_listings` (active listings; pass `keywords` for effective sorting)
- `get_shop_return_policies`, `get_shop_return_policy` (selected public policy fields; no linked-listing or legal/refund conclusions)
- `get_shipping_carriers` (bounded carrier and domestic/international mail-class reference data by origin country)
- `ping_etsy` (configured-application connectivity only; does not verify OAuth scopes or private-resource access)
- `get_shop_sections`, `get_shop_section` (public section details and active-listing counts)
- `get_shop_section_listings` (active listings from one section; sorting may be ineffective without search options)
- `get_featured_shop_listings` (products curated by the shop, not a platform trend ranking)
- `search_shops`
- `get_shop_reviews`
- `get_listing_reviews` (one public listing review page; optional date filters)
- `get_taxonomy_nodes` (`buyer` or `seller`; optional local subtree/name filters)
- `get_taxonomy_properties` (matching buyer/seller category ID; seller-only variation/attribute filters)
- `begin_etsy_connection` (conditional; operator-enabled browser consent entry point only, not private Etsy data access)

The twenty-nine default tools are read-only and use public Etsy API-key endpoints. `begin_etsy_connection` appears only when OAuth is explicitly enabled and protected startup prerequisites succeed; it starts browser consent but does not expose private Etsy reads, refresh, status/disconnect, scope introspection, or writes. Media URLs are bounded data only and are never fetched; media list tools have no paging parameters. Taxonomy node results are bounded local pages over a cached full tree; category-property lookup uses the selected category route directly. Listing-property lookup returns only the values selected on a listing. The public offering read is separate from private inventory/product access. Return-policy reads do not enumerate affected listings; that separate read requires OAuth `listings_r`. `ping_etsy` confirms application connectivity only, not OAuth scopes or private access. Platform-wide trending listings and private inventory remain unsupported; shop-curated featured products are available separately. See the [setup guide](docs/setup-and-access.md) for configuration; `README.md` is unchanged.

Listing summaries may include returned category, return-policy/readiness references, listing type, variation/personalization flags, and default language. Detail associations and dedicated personalization/translation reads are selected and bounded; seller instructions and localized content are untrusted. Language validation checks bounded BCP 47 syntax only, not registry membership or Etsy availability. Readiness IDs are references, not guarantees. Batch `currency` conversion preserves original `price` separately from `converted_price`. Buyer-price output keeps original, converted, display, discount, and shipping components separate, with raw money units preserved; it is not a checkout quote. `Inventory`/`Shipping` are not detail includes.

## Local checks

```bash
npm run build
npm test
npm audit --omit=dev --audit-level=high
```
