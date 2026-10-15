# Source setup

## Requirements

- Node.js 22 or later (CI also validates Node.js 24).
- An Etsy API key from the Etsy Developer Portal. Use the full value `<keystring>:<shared_secret>`.
- An MCP client that supports local stdio servers.

## Build

From the repository root:

```bash
npm ci --ignore-scripts
npm run build
```

The server runs from `build/index.js`; `build/` is generated output and is not committed.

## MCP client configuration

Configure the client to run Node.js with the absolute path to `build/index.js`. Pass the credential as the `ETSY_API_KEY` environment variable. See the complete [Claude Desktop example in README.md](README.md#configure-an-mcp-client).

The server validates the credential at startup and never logs its value. A `.env` file is Git-ignored for local safety, but is not automatically loaded by the server.

## Security behavior

The server makes read-only API-key requests to `https://openapi.etsy.com` over HTTPS. It rejects redirects, ignores proxy environment variables, uses a ten-second timeout, limits upstream responses to 1 MiB, and caps tool output at 128 KiB. It does not use OAuth or fetch URLs returned by Etsy.

Run `npm test` to execute local behavioral tests. Tests use synthetic credentials and do not call Etsy.
