# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-12-12

### Added
- Initial release of Etsy MCP Server
- `search_listings` tool for searching active Etsy listings
- `get_listing_details` tool for retrieving detailed product information
- `get_shop_by_name` tool for fetching shop information by name
- `get_shop_listings` tool for getting all listings from a specific shop
- `search_shops` tool for searching shops by name
- `get_trending_listings` tool for discovering trending products
- `get_shop_reviews` tool for retrieving shop reviews
- Support for price filtering in searches
- Pagination support for large result sets
- Comprehensive error handling
- TypeScript implementation with full type safety
- GitHub Actions CI/CD workflow
- Detailed documentation and usage examples

### Technical
- Built with MCP TypeScript SDK v1.0.4
- Etsy API v3 integration
- Axios for HTTP requests
- Node.js 18+ support
