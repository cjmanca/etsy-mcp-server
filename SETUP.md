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

Configure the client to run Node.js with the absolute path to `build/index.js`. Pass the credential as the `ETSY_API_KEY` environment variable. See the [configuration section in README.md](README.md#configuration).

The server validates the credential at startup and never logs its value. A `.env` file is Git-ignored for local safety, but is not automatically loaded by the server.

## Security behavior

The default server makes read-only API-key requests to `https://openapi.etsy.com` over HTTPS. It rejects redirects, ignores proxy environment variables, uses a ten-second timeout, limits upstream responses to 1 MiB, and caps tool output at 128 KiB. OAuth is an optional, operator-configured browser connection; it is disabled by default and does not add private-data or write tools. See [OAuth setup and access](docs/setup-and-access.md#optional-browser-based-account-connection) for the required protected key/data paths, exact registered redirect, numeric callback bind, and actual trusted proxy peer configuration.

For local testing, set `ETSY_DEVELOPMENT_MODE=true` in the server process
environment to block all methods except `GET`, `HEAD`, and `OPTIONS`. Unset,
empty, or exact lowercase `false` leaves the existing behavior unchanged; any
other nonempty value is rejected at startup. Restart the server to change the
setting. This local lock does not authorize writes, enable a sandbox, or set or
check Etsy's separately configured manual shop Developer Mode setting. The
method guard is intentionally conservative and also blocks non-mutating `POST`
requests.

Locked mode rejects injected Axios clients with preinstalled request
interceptors and blocks later request-interceptor `use`, `eject`, and `clear`
calls. Default and per-call Axios request transforms and custom adapters remain
supported; response interceptors are unaffected.

Run `npm test` to execute local behavioral tests. Tests use synthetic credentials and do not call Etsy.
