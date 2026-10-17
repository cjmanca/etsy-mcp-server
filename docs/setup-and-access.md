# Setup and access

**Status: implemented.** Read this slice for installation, credentials, and connection troubleshooting; read the [overview](overview.md) for feature scope.

## Requirements

- Node.js 22 or later; CI covers Node.js 22 and 24.
- A local MCP client capable of launching a stdio server.
- Etsy developer application credentials, supplied as `<keystring>:<shared_secret>`.

No OAuth authorization flow or seller account connection is implemented. Public read-only access still requires both parts of the application credential.

## Build and connect

From the source checkout:

```bash
npm ci --ignore-scripts
npm run build
```

Configure your MCP client to launch the generated file:

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

Use your client's equivalent configuration if its format differs. On Windows, JSON paths require escaped backslashes, for example `C:\\projects\\etsy-mcp-server\\build\\index.js`. Rebuild after source updates. This repository does not verify or recommend installing a published npm package.

## Credential handling

Pass `ETSY_API_KEY` through the client or process environment. The server does **not** automatically load `.env` files. Keep real credentials out of prompts, tool arguments, screenshots, and committed configuration. Startup validation requires exactly one colon, two nonempty parts, no whitespace/control characters, and a total length no greater than 1,024 characters.

## Connection expectations

- The client communicates locally over stdio; the server contacts only the fixed Etsy API origin over HTTPS.
- Proxy environment settings such as `HTTPS_PROXY` are ignored. A direct connection to Etsy must be allowed.
- Redirects are blocked and normal TLS certificate verification stays enabled.
- The startup message is written to stderr so stdout remains available for MCP messages.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Server does not start | Node.js version, absolute build path, whether the project was built, and whether the client passes the credential environment variable. |
| Credential format rejected | Supply the full keystring/shared-secret pair without spaces or line breaks. Never paste the actual value into an issue. |
| Etsy rejects credentials | Verify the application credentials and access with Etsy; correct formatting does not prove authorization. |
| Secure connection fails | Direct network access and TLS trust; proxy-only environments are not supported by current behavior. |
| Some requested feature is unavailable | Only the eight tools in the [overview](overview.md) exist. API availability does not imply MCP availability. |

`npm test` builds and runs local mocked behavioral tests using synthetic credentials, not live Etsy requests. Passing tests does not establish that a particular Etsy application has live access.
