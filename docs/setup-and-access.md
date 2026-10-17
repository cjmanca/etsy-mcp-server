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

## Optional read-only testing lock

To block all Etsy mutations locally, set `ETSY_DEVELOPMENT_MODE=true` in the MCP
server process environment. Unset, empty, or exact lowercase `false` leaves the
existing behavior unchanged. Values are case-sensitive; any other nonempty
value stops startup with a sanitized configuration error. The setting is
snapshotted when the server starts, so restart the MCP server after changing it.

This is a local safety lock, not authorization to mutate an account. It does
not add write tools, grant scopes, or change/query Etsy's separately configured
manual shop Developer Mode setting; it does not make requests to a sandbox.
When enabled, only `GET`, `HEAD`, and `OPTIONS` HTTP methods are allowed. This
conservative rule also blocks non-mutating `POST` operations.

For safety, locked mode rejects injected Axios clients that already have
request interceptors, and rejects later request-interceptor `use`, `eject`, or
`clear` calls with a sanitized configuration error. Default and per-call Axios
request transforms and custom mock/request adapters remain usable; response
interceptors are unaffected.

For an MCP client configuration, add the switch alongside the API key:

```json
"env": {
  "ETSY_API_KEY": "<keystring>:<shared_secret>",
  "ETSY_DEVELOPMENT_MODE": "true"
}
```

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
| Some requested feature is unavailable | Only the ten tools in the [overview](overview.md) exist. API availability does not imply MCP availability. |

`npm test` builds and runs local mocked behavioral tests using synthetic credentials, not live Etsy requests. Passing tests does not establish that a particular Etsy application has live access.
