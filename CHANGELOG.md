# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added an optional read-only testing lock for Etsy mutation requests.
- Added buyer and seller category browsing with optional local subtree and name filters.
- Added buyer and seller category-property lookup with supported scales, values, and variation constraints.
- Added category, location, safe-content, currency, and ship-to-country filters to listing search.

### Documentation

- Added task-oriented documentation in `docs/`, an Etsy API coverage matrix, subsystem access plans, and an unimplemented-feature checklist.
- Added `TASK.md` with dependency-ordered implementation milestones, task-level verification requirements, and completion gates for the outstanding backlog.

### Project policy

- Replaced the blanket read-only development restriction with scoped authorization and safety requirements for future OAuth, inventory, private reads, and write tools. Runtime functionality remains unchanged.

## [2.0.0] - 2026-10-15

### Security

- Blocked redirects, disabled environment proxy discovery, fixed the Etsy API origin, and added request timeouts and response-size limits.
- Validated the `ETSY_API_KEY` keystring/shared-secret format and sanitized upstream errors.
- Updated the MCP SDK, Axios, and vulnerable transitive dependencies.
- Added request throttling, bounded retries, input validation, and response-size caps.
- Returned selected Etsy fields as bounded JSON and marked third-party text as untrusted data.

### Changed

- `get_shop_by_name` now searches shops and returns only a unique exact case-insensitive name match.
- Shop-name lookup scans up to five pages (500 candidates) and reports incomplete searches explicitly.
- `get_shop_listings` now uses the public active-listings endpoint.
- `get_shop_listings` accepts optional `keywords`; Etsy's sort options are effective with search options such as keywords.
- `get_listing_details` no longer accepts or returns `Inventory`.
- **Breaking:** Removed `get_trending_listings` because Etsy does not document a supported trending endpoint.
- Raised the minimum supported Node.js version to 22 and made TypeScript source the sole implementation.

### Build and CI

- Added Node.js 22 and 24 CI for locked installs, builds, targeted tests, and production dependency audits.
- Removed the npm publishing job and stopped committing generated build output.

## [1.0.0] - 2025-12-12

### Added

- Initial Etsy MCP server with search, listing, shop, trending, and review tools.
