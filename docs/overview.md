# Project overview

**Status: implemented in version 2.0.0.** See the [index](index.md) for task-specific documentation.

Etsy MCP Server lets an AI assistant query public Etsy information through a local Model Context Protocol connection. It helps with product discovery, shop research, catalog comparisons, and review sampling without giving the assistant permission to change an Etsy account.

## Available capabilities

| Tool | What it enables | Details |
| --- | --- | --- |
| `search_listings` | Discover active products by keywords, price range, and sort order. | [Listings](listing-discovery.md) |
| `get_listing_details` | Inspect a product and optionally its shop, images, public user summary, or videos. | [Listings](listing-discovery.md) |
| `search_shops` | Find candidate shops by name. | [Shops](shops.md) |
| `get_shop_by_name` | Resolve an exact, case-insensitive shop name and read its public profile. | [Shops](shops.md) |
| `get_shop_listings` | Browse or keyword-filter a shop's active catalog. | [Shops](shops.md) |
| `get_shop_reviews` | Read public shop reviews, optionally within a date range. | [Reviews](reviews.md) |

## Typical workflows

- **Product research:** search active listings, select listing IDs, then inspect details and media metadata for a small shortlist.
- **Shop research:** resolve a shop name, use its numeric ID to browse active products, then sample reviews.
- **Catalog comparison:** collect bounded pages from several shops and compare the returned product fields. Do not claim a complete catalog when pagination or truncation prevents one.
- **Customer-feedback summaries:** retrieve dated reviews and summarize the observed sample, not an assumed complete history.

## Scope and boundaries

These are **current runtime limitations**, not a prohibition on future features. The [development policy](access-policy.md) permits OAuth, inventory, private reads, and writes; the [roadmap](roadmap.md) plans that expanded scope without claiming it exists today.

- Public, read-only Etsy Open API v3 access using application credentials; no seller login or OAuth.
- No creation, editing, deletion, purchasing, messaging, order management, private financial data, or inventory access.
- No supported trending tool. `get_trending_listings` was removed because there is no documented supported trending endpoint; sorting by score is not a trend metric.
- No independent keyword search-volume, sales-history, or revenue analytics feed. Analysis must be grounded in fields actually returned.
- Media tools return metadata and URLs, not downloaded image/video content. The server never fetches URLs found in Etsy content.
- Tools return selected, bounded fields rather than complete raw Etsy API responses.

## Deployment model

A local MCP client launches the server over stdio. There is no hosted HTTP service or browser dashboard supplied by this project. Node.js 22 or later and Etsy developer credentials are required; see [setup and access](setup-and-access.md).

The project is MIT-licensed. The authoritative implementation is TypeScript source; generated build files are not the feature specification.
