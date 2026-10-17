# Project overview

**Status: current runtime capabilities.** See the [index](index.md) for task-specific documentation.

Etsy MCP Server lets an AI assistant query public Etsy information through a local Model Context Protocol connection. It helps with product discovery, shop research, catalog comparisons, and review sampling without giving the assistant permission to change an Etsy account.

## Available capabilities

| Tool | What it enables | Details |
| --- | --- | --- |
| `search_listings` | Discover active products by keywords, price range, and sort order. | [Listings](listing-discovery.md) |
| `get_listing_details` | Inspect a product and optionally its shop, images, public user summary, or videos. | [Listings](listing-discovery.md) |
| `get_listing_images` | Read bounded image metadata, including rank, dimensions, alt text, selected URLs, and color information. | [Listings](listing-discovery.md#read-dedicated-listing-media-metadata) |
| `get_listing_image` | Read one listing image's selected metadata by image ID. | [Listings](listing-discovery.md#read-dedicated-listing-media-metadata) |
| `get_listing_properties` | Read a bounded list of the selected property values Etsy returns for a listing. | [Listings](listing-discovery.md#inspect-selected-listing-properties) |
| `get_listing_personalization` | Read a listing's bounded current personalization questions, options, limits, and add-on prices. | [Listings](listing-discovery.md#read-personalization-questions) |
| `get_listing_translation` | Read existing localized title, description, and tags for a shop/listing/language selection. | [Listings](listing-discovery.md#read-an-existing-listing-translation) |
| `get_listing_videos` | Read bounded video metadata, dimensions, state, and URLs for a listing. | [Listings](listing-discovery.md#read-dedicated-listing-media-metadata) |
| `get_listing_video` | Read one listing video's selected metadata by video ID. | [Listings](listing-discovery.md#read-dedicated-listing-media-metadata) |
| `get_listings_batch` | Retrieve up to 100 selected public listings in one request, preserving requested ID order. | [Listings](listing-discovery.md#fetch-a-batch-of-listings) |
| `get_listing_buyer_prices` | Compare Etsy's buyer-country-aware base, display, discount, and shipping price components for up to 100 listings. | [Listings](listing-discovery.md#compare-buyer-facing-price-components) |
| `search_shops` | Find candidate shops by name. | [Shops](shops.md) |
| `get_shop_by_name` | Resolve an exact, case-insensitive shop name and read its public profile. | [Shops](shops.md) |
| `get_shop` | Read a public shop profile directly by numeric shop ID. | [Shops](shops.md#look-up-a-known-shop-or-owner-id) |
| `get_shop_by_owner` | Read the public shop associated with a numeric owner user ID. | [Shops](shops.md#look-up-a-known-shop-or-owner-id) |
| `get_shop_listings` | Browse or keyword-filter a shop's active catalog. | [Shops](shops.md) |
| `get_shop_sections` | List a shop's public sections and active-listing counts. | [Shops](shops.md#browse-shop-sections-and-featured-products) |
| `get_shop_section` | Read one public section by shop and section ID. | [Shops](shops.md#browse-shop-sections-and-featured-products) |
| `get_shop_section_listings` | Browse active listings in one selected section. | [Shops](shops.md#browse-shop-sections-and-featured-products) |
| `get_featured_shop_listings` | Browse products a shop has curated as featured. | [Shops](shops.md#browse-shop-sections-and-featured-products) |
| `get_shop_reviews` | Read public shop reviews, optionally within a date range. | [Reviews](reviews.md) |
| `get_listing_reviews` | Read a bounded sample of public reviews for one listing. | [Reviews](reviews.md) |
| `get_taxonomy_nodes` | Browse the buyer or seller category hierarchy by stable node IDs, optionally using local subtree/name filters. | [Public discovery](planned-public-discovery.md#current-m11-taxonomy-node-browsing) |
| `get_taxonomy_properties` | Inspect allowed attributes, scales, values, and variation support for a buyer or seller category ID. | [Public discovery](planned-public-discovery.md#current-m12-category-properties) |

## Typical workflows

- **Product research:** search active listings, select listing IDs, then inspect details and media metadata for a small shortlist.
- **Media metadata:** use a listing ID to read its selected image or video metadata, then use the returned image or video ID for a focused detail lookup. Media URLs are data only and are never fetched.
- **Batch listing lookup:** retrieve a selected set of listing IDs in one call; inspect `not_returned_ids` and `truncated` before treating the response as complete.
- **Buyer-facing price comparison:** provide a required buyer country to retrieve Etsy's separate base/display/discount/shipping components for selected IDs. This is not a checkout quote.
- **Shop research:** resolve a shop name, use its numeric ID to browse active products, then sample reviews.
- **Shop organization:** list a shop's sections, inspect one section, browse its active products, or separately retrieve the shop-curated featured selection. Featured does not mean trending.
- **Known shop or owner ID:** use `get_shop` or `get_shop_by_owner` to read a public profile without repeating name search. Owner-ID lookup does not prove caller ownership.
- **Catalog comparison:** collect bounded pages from several shops and compare the returned product fields. Do not claim a complete catalog when pagination or truncation prevents one.
- **Category discovery:** browse buyer or seller taxonomy nodes, then use returned IDs and paths to identify a category. Taxonomy filtering and paging are local over Etsy's full-tree response.
- **Category attributes:** use the ID from the matching buyer or seller tree to inspect category-supported properties, scales, and values. Seller-only flags can filter properties by attribute or variation support.
- **Listing-selected attributes:** use `get_listing_properties` with a known shop and listing ID to read values attached to that listing; this is not a list of category-allowed values. Single-property detail remains unavailable while Etsy documents its route as 501-only.
- **Personalization:** use `get_listing_personalization` to inspect the questions and options Etsy returns. Seller instructions are untrusted text, and add-on prices retain Etsy's raw Money units.
- **Localized listing content:** use `get_listing_translation` with the shop ID, listing ID, and a bounded language tag to read an existing translation. It does not generate translated content or replace the source listing; Etsy may reject a syntactically valid but unavailable language.
- **Customer-feedback summaries:** retrieve dated reviews and summarize the observed sample, not an assumed complete history.
- **Product-feedback summaries:** sample public reviews for a known listing ID; one page is not its complete review history.

## Scope and boundaries

These are **current runtime limitations**, not a prohibition on future features. The [development policy](access-policy.md) permits OAuth, inventory, private reads, and writes; the [roadmap](roadmap.md) plans that expanded scope without claiming it exists today.

- Public, read-only Etsy Open API v3 access using application credentials; no seller login or OAuth. Category browsing is available for both buyer and seller taxonomies.
- No creation, editing, deletion, purchasing, messaging, order management, private financial data, or inventory access.
- No supported platform-wide trending tool. `get_trending_listings` was removed because Etsy documents no trending endpoint; shop-curated featured listings are a separate capability, and sorting by score is not a trend metric.
- No independent keyword search-volume, sales-history, or revenue analytics feed. Analysis must be grounded in fields actually returned.
- Media tools return metadata and URLs, not downloaded image/video content. The server never fetches URLs found in Etsy content.
- Tools return selected, bounded fields rather than complete raw Etsy API responses.

## Deployment model

A local MCP client launches the server over stdio. There is no hosted HTTP service or browser dashboard supplied by this project. Node.js 22 or later and Etsy developer credentials are required; see [setup and access](setup-and-access.md).

The project is MIT-licensed. The authoritative implementation is TypeScript source; generated build files are not the feature specification.
