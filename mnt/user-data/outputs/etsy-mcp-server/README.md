# Etsy MCP Server

[![npm version](https://img.shields.io/npm/v/etsy-mcp-server.svg)](https://www.npmjs.com/package/etsy-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/etsy-mcp-server.svg)](https://nodejs.org/)

A Model Context Protocol (MCP) server that provides integration with the Etsy API v3. This server enables AI assistants to search for products, get shop information, retrieve listing details, and more on Etsy.

## Features

- 🔍 **Search Listings**: Search for active products on Etsy with filters
- 🏪 **Shop Information**: Get detailed shop data and reviews
- 📦 **Listing Details**: Retrieve comprehensive product information with images
- 🔥 **Trending Products**: Discover what's currently popular on Etsy
- ⭐ **Reviews**: Access shop reviews and ratings
- 📊 **Pagination Support**: Handle large result sets efficiently

## Prerequisites

- Node.js 18 or higher
- An Etsy API key (from Etsy Developer Portal)

## Getting an Etsy API Key

1. Go to [Etsy Developers](https://www.etsy.com/developers)
2. Sign in with your Etsy account
3. Create a new app in the [Developer Console](https://www.etsy.com/developers/your-apps)
4. Copy your API Key (also called "Keystring")

**Note**: For read-only operations (searching, viewing public data), you only need an API key. For operations that modify data (creating listings, managing shops), you would need OAuth 2.0 authentication, which is not currently implemented in this server.

## Installation

### From npm (when published)

```bash
npm install -g etsy-mcp-server
```

### From Source

```bash
git clone <repository-url>
cd etsy-mcp-server
npm install
npm run build
```

## Configuration

### Claude Desktop Configuration

Add the following to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "etsy": {
      "command": "npx",
      "args": ["-y", "etsy-mcp-server"],
      "env": {
        "ETSY_API_KEY": "your_etsy_api_key_here"
      }
    }
  }
}
```

Or if installed from source:

```json
{
  "mcpServers": {
    "etsy": {
      "command": "node",
      "args": ["/path/to/etsy-mcp-server/build/index.js"],
      "env": {
        "ETSY_API_KEY": "your_etsy_api_key_here"
      }
    }
  }
}
```

### Environment Variable

Alternatively, you can set the API key as an environment variable:

```bash
export ETSY_API_KEY=your_etsy_api_key_here
```

## Available Tools

### search_listings

Search for active listings on Etsy.

**Parameters:**
- `keywords` (required): Search terms
- `limit` (optional): Number of results (1-100, default: 25)
- `offset` (optional): Pagination offset (default: 0)
- `min_price` (optional): Minimum price filter
- `max_price` (optional): Maximum price filter
- `sort_on` (optional): Sort by created, price, updated, or score
- `sort_order` (optional): asc, desc, ascending, or descending

**Example:**
```
Search Etsy for handmade leather wallets under $50
```

### get_listing_details

Get detailed information about a specific listing.

**Parameters:**
- `listing_id` (required): Numeric listing ID
- `includes` (optional): Array of additional data (Shop, Images, User, Videos, Inventory)

**Example:**
```
Get details for Etsy listing ID 1234567890
```

### get_shop_by_name

Retrieve information about a shop by its name.

**Parameters:**
- `shop_name` (required): Shop name/slug

**Example:**
```
Get information about the Etsy shop "ArtisanLeatherCo"
```

### get_shop_listings

Get all active listings from a specific shop.

**Parameters:**
- `shop_id` (required): Numeric shop ID
- `limit` (optional): Number of results (1-100, default: 25)
- `offset` (optional): Pagination offset
- `sort_on` (optional): Sort field
- `sort_order` (optional): Sort direction

**Example:**
```
Show me all listings from Etsy shop ID 12345678
```

### search_shops

Search for shops by name.

**Parameters:**
- `shop_name` (required): Shop name to search
- `limit` (optional): Number of results (1-100, default: 25)
- `offset` (optional): Pagination offset

**Example:**
```
Search for Etsy shops with "pottery" in their name
```

### get_trending_listings

Get currently trending listings on Etsy.

**Parameters:**
- `limit` (optional): Number of results (1-100, default: 25)
- `offset` (optional): Pagination offset

**Example:**
```
Show me trending items on Etsy
```

### get_shop_reviews

Get reviews for a specific shop.

**Parameters:**
- `shop_id` (required): Numeric shop ID
- `limit` (optional): Number of results (1-100, default: 25)
- `offset` (optional): Pagination offset
- `min_created` (optional): Unix timestamp for minimum date
- `max_created` (optional): Unix timestamp for maximum date

**Example:**
```
Get recent reviews for Etsy shop ID 12345678
```

## Development

### Build

```bash
npm run build
```

### Watch Mode

```bash
npm run watch
```

### Development Mode

```bash
npm run dev
```

## API Rate Limits

Etsy's API has rate limits:
- **10 requests per second** per API key
- Be mindful of pagination when retrieving large datasets

## Error Handling

The server includes comprehensive error handling:
- Invalid API keys return authentication errors
- Missing required parameters return validation errors
- Rate limit errors are surfaced to the user
- Network errors are caught and reported

## Limitations

- **Read-only**: This server only supports read operations (searching, viewing)
- **Public data only**: Can only access publicly available information
- **OAuth not implemented**: Cannot perform authenticated operations like managing listings or accessing private shop data

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

MIT

## Resources

- [Etsy API Documentation](https://developers.etsy.com/documentation/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)

## Troubleshooting

### "ETSY_API_KEY environment variable is required"

Make sure you've set the `ETSY_API_KEY` in your configuration file or environment variables.

### "Authentication failed"

Verify your API key is correct and active in the Etsy Developer Portal.

### "Rate limit exceeded"

Wait a moment before making more requests. Consider implementing delays between requests if making many calls.

### Connection Issues

Ensure you have internet connectivity and that Etsy's API is accessible from your network.
