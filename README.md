# Etsy MCP Server

A lightweight, read-only [Model Context Protocol](https://modelcontextprotocol.io/) server for public Etsy Open API v3 data. It uses Node.js, TypeScript, Axios, and stdio transport.

## Requirements

- Node.js 22 or later. CI validates Node.js 22 and 24.
- An Etsy developer API key in the format `<keystring>:<shared_secret>`.
- An MCP client that can launch a local stdio server.

Etsy documents the required `x-api-key` format in its [request standards](https://developers.etsy.com/documentation/essentials/requests/). The API key and shared secret are both required, including for public read-only endpoints.

## Install from the source checkout

```bash
git clone https://github.com/administrativetrick/etsy-mcp-server.git
cd etsy-mcp-server
npm ci --ignore-scripts
npm run build
```

The TypeScript source is authoritative. `build/` is generated locally and is not committed. Rebuild after updating the checkout. The repository does not verify or recommend an npm package installation.

## Configure an MCP client

Point the client at the generated `build/index.js` and supply `ETSY_API_KEY` through the client’s environment configuration. For example, in Claude Desktop configuration:

```json
{
  "mcpServers": {
    "etsy": {
      "command": "node",
      "args": ["/absolute/path/to/etsy-mcp-server/build/index.js"],
      "env": {
        "ETSY_API_KEY": "<keystring>:<shared_secret>"
      }
    }
  }
}
```

On Windows, use an absolute path with escaped backslashes, such as `C:\\Users\\you\\projects\\etsy-mcp-server\\build\\index.js`. Keep client configuration containing credentials out of version control. `.env` files are Git-ignored, but the server does not load `.env` automatically; pass the variable through the MCP client or process environment.

## Supported read-only tools

- `search_listings` — search active listings with price, pagination, and sorting filters.
- `get_listing_details` — read a listing and optionally include `Shop`, `Images`, `User`, or `Videos`.
- `get_shop_by_name` — resolve a case-insensitive exact shop-name match. It returns a not-found result or an ambiguity result when appropriate.
- `get_shop_listings` — list public active listings for a numeric shop ID.
- `search_shops` — search shops by name.
- `get_shop_reviews` — retrieve public reviews for a shop, with optional date filters.

The tools use Etsy’s API-key-accessible public endpoints, including [active listings](https://developers.etsy.com/documentation/reference/), [shop search](https://developers.etsy.com/documentation/reference/), and [shop reviews](https://developers.etsy.com/documentation/reference/). `get_trending_listings` was removed in version 2.0.0 because no supported trending endpoint is documented. Inventory is not returned: Etsy documents inventory access separately with an OAuth `listings_r` scope in its [migration guide](https://developers.etsy.com/documentation/tutorials/inventory-shipping-migration/).

This server does not implement OAuth, private shop data, inventory access, write operations, arbitrary URL fetching, or non-Etsy API requests. All Etsy requests are HTTPS requests to the fixed `https://openapi.etsy.com` origin. Redirects are rejected, proxy environment variables are ignored (`proxy: false`), and Node.js TLS certificate verification remains enabled. The direct connection requirement means `HTTP_PROXY`, `HTTPS_PROXY`, and related environment settings are not used by this server.

## Input and response limits

- Listing and shop IDs must be positive safe integers.
- `limit` is 1–100 and `offset` is 0–12000.
- Search text is limited to 200 characters.
- Prices must be finite and nonnegative; maximum price cannot be lower than minimum price.
- Review timestamps must be whole Unix seconds from 2000 onward, with minimum not greater than maximum.
- Listing titles, descriptions, shop announcements, and review text are capped. Total JSON tool output is limited to 128 KiB. Responses include `count` for Etsy’s total result count, `returned` for the rows actually included, and `truncated` when content or rows were shortened.
- Every successful response includes a notice that Etsy listing, shop, and review text is untrusted third-party data. These strings remain structured JSON data and must not be treated as instructions.

The server starts requests at no more than five per second in this process, limits each HTTP request to ten seconds and 1 MiB, and makes at most one short retry for selected transient failures. Etsy assigns application-specific QPS and QPD limits; check the [official rate-limit documentation](https://developers.etsy.com/documentation/essentials/rate-limits/) for your app’s assigned limits.

## Development and checks

```bash
npm ci --ignore-scripts
npm run build
npm test
npm audit --omit=dev --audit-level=high
```

`npm test` uses Node.js’s built-in test runner and local mocks. It does not use Etsy credentials or make live Etsy requests. To start the stdio server manually, set `ETSY_API_KEY` and run `node build/index.js`.

## References

- [Etsy Open API v3 reference](https://developers.etsy.com/documentation/reference/)
- [Etsy request standards and authentication](https://developers.etsy.com/documentation/essentials/requests/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
