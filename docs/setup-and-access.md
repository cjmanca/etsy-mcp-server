# Setup and access

**Status: implemented, with optional operator-enabled OAuth connection.** Read this slice for installation, credentials, and connection troubleshooting; read the [overview](overview.md) for feature scope.

## Requirements

- Node.js 22 or later; CI covers Node.js 22 and 24.
- A local MCP client capable of launching a stdio server.
- Etsy developer application credentials, supplied as `<keystring>:<shared_secret>`.

Public read-only access requires both parts of the Etsy application credential. An optional browser-based OAuth connection is available only after the operator enables and configures it below; private Etsy data tools are not yet implemented.

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

## Optional browser-based account connection

OAuth is disabled by default. Leave `ETSY_OAUTH_ENABLED` unset or set it to the exact string `false` to retain the default API-key-only server: it advertises the same twenty-nine public tools, opens no callback listener, and does not read the OAuth key or data store. Set it to the exact string `true` only after an operator has completed the protected-storage and callback prerequisites below; any other supplied value is a startup configuration error. A ready OAuth-enabled server conditionally adds `begin_etsy_connection`, `get_etsy_connection_status`, and `disconnect_etsy_connection` (32 tools total). The begin tool starts browser consent and durably completes the callback; the other two expose only local lifecycle status/removal. No private Etsy reads, model-facing refresh management, or writes are available.

The internal refresh/lifecycle service is verified (M3.3b), but no current MCP tool or private handler invokes refresh; in particular, status never refreshes. The local status/disconnect tools are implemented and independently reviewed (M3.4). The M3.5a operation-authorization core is complete after independent security/spec/quality review and coordinator Windows/native-Linux verification, but no private resource handler invokes it. The M3.5b token-scope diagnostic is unavailable because the official response contract has no declared properties; parent M3.5 and overall M3 remain open. Refresh, lifecycle controls, and the unintegrated guard do not make private Etsy resource access available.

**Mandatory operator prerequisite before live consent:** disable or redact callback query strings in every proxy/CDN/backend access log, trace, APM capture, and error report so authorization codes and state cannot leak. Keep raw HTTP/Axios debug logging off. Do not retain full consent or callback URLs in logs, issues, or telemetry. The dedicated `begin_etsy_connection` response may still present the approved consent URL containing opaque state and the public PKCE challenge; it must never expose the verifier, authorization code, or tokens. Use an MCP client that can present that URL without inappropriate retention; callback `no-store`/`no-referrer` headers do not erase browser history or upstream logs.

The operator supplies these startup settings through the MCP server process configuration (not a tool call). `ETSY_OAUTH_KEY_FILE` is a path only: never put the 32-byte encryption-key value inline in MCP configuration, an environment variable, a command line, a prompt, or a log. The separate Etsy application credential remains `ETSY_API_KEY` as described above; never copy its actual value into documentation or prompts.

```text
ETSY_OAUTH_ENABLED=true
ETSY_OAUTH_OPERATOR_ID=<stable-nonsecret-operator-id>
ETSY_OAUTH_KEY_FILE=<absolute-path-to-protected-32-byte-binary-key-file>
ETSY_OAUTH_REDIRECT_URI=https://www.methejuggler.com/oauth/etsy/callback
ETSY_OAUTH_CALLBACK_HOST=<numeric-LAN-address-of-development-computer>
ETSY_OAUTH_CALLBACK_PORT=3001
ETSY_OAUTH_TRUSTED_PROXY_IPS=<comma-separated-actual-proxy-IP-addresses-seen-by-callback-socket>
```

`ETSY_OAUTH_DATA_DIR` is optional. Without it, the data directory defaults to `%LOCALAPPDATA%\\etsy-mcp-server\\<operator-id>` on Windows or `$XDG_DATA_HOME/etsy-mcp-server/<operator-id>` on Linux (`~/.local/share/etsy-mcp-server/<operator-id>` when `XDG_DATA_HOME` is unset). Use only a supported local filesystem, not a network/shared volume. The key file must contain exactly 32 random binary bytes, be a regular protected file, and be physically outside the data directory. On Linux, use owner-only data directories (`0700`), data files (`0600`), and a key file owned by the runtime user with mode `0400` or `0600`; on Windows, use local NTFS and restrictive ACLs limited to the runtime identity, SYSTEM, and Administrators. These checks are enforced at OAuth startup. Never copy the key into prompts, logs, or the encrypted data directory.

On Windows, OAuth startup also requires Windows PowerShell (`powershell.exe`) and the local NTFS ACL/SID identity facilities used by the fixed, noninteractive path inspector. If those facilities are unavailable or cannot verify the required ACLs and object identities, startup fails closed. The server does not create or provision the separate binary key and does not repair broad ACLs; provision the key separately and restrict permissions to the documented principals rather than weakening them to bypass inspection.

For the current home-server HTTPS proxy → development-computer topology, the registered redirect above is fixed. Bind the callback to the development computer's numeric LAN address and configure `ETSY_OAUTH_TRUSTED_PROXY_IPS` with the exact numeric address of the nearest proxy as observed by the callback socket. This setting accepts exact IPs, not hostnames, ports, wildcards, or CIDRs. The callback authorizes using the actual socket peer address; `Host`, `Forwarded`, and `X-Forwarded-*` headers are not trusted. The proxy must preserve `/oauth/etsy/callback` and its query; protect the backend path so only the proxy can reach port 3001, and do not expose that port directly to the Internet. Plain HTTP behind TLS termination is suitable only on a trusted isolated LAN/protected tunnel; protect the backend transport on any untrusted segment. No listener, firewall, proxy, or key provisioning is performed by documenting these operator requirements. Docker deployment is not verified.

When OAuth is enabled, startup validates storage ownership/permissions and the key, acquires the single-process store lock, and binds the configured callback port before registering the connect tool. Missing/unsafe storage, an existing lock, or a port conflict fails closed; the server does not choose another port. The current operator configuration keeps `ETSY_DEVELOPMENT_MODE` off. If set to `true`, it blocks OAuth's required POST requests as well as other non-GET methods, so the connect flow is unavailable while that conservative local lock is enabled. Do not confuse this local lock with Etsy's separate shop Developer Mode setting.

### Local connection status and disconnect

With a ready OAuth runtime, call `get_etsy_connection_status` with an opaque
`connection_id` to read the local state, requested and verified granted scopes,
consented capability names, verified account/shop IDs, token expiry, and fixed
reconnect guidance. This is a local read: it does not contact Etsy or refresh a
token. `shops_r` is reported as `account_identity`; it does not mean a private
shop-reading tool is available. Recent pending and terminal-flow status is kept
in memory only; terminal entries are bounded to 100 and retained for at most five
minutes. Unknown and foreign connection IDs return the same generic unavailable
outcome; there is no cross-instance status lookup.

```json
{ "connection_id": "<22-character-connection-id>" }
```

To remove local access, call `disconnect_etsy_connection` with the same ID and
`confirm_local_disconnect: true`. The server disables dispatch immediately,
consumes a matching pending flow, waits for serialized callback/refresh work, and
then attempts durable local credential removal. A successful result reports
`local_credentials_removed: true` and always `upstream_revoked: false`: it does not
revoke a token at Etsy or erase external backups. If durable removal is uncertain,
the result is `recovery_required`, local access stays disabled, and the store's
recovery fence must be handled through verified offline recovery or fresh consent.
The current runtime has no private-resource cache or confirmation store to expose
or clear; private Etsy resource handlers remain unimplemented.

```json
{
  "connection_id": "<22-character-connection-id>",
  "confirm_local_disconnect": true
}
```

When `ETSY_DEVELOPMENT_MODE=true`, these local lifecycle controls remain
available if OAuth startup succeeded, while `begin_etsy_connection` is hidden
and direct calls are denied. The supported deployment allows one stdio transport
attachment per server instance; do not share a process/store between less-trusted
clients. Use separate OS/container isolation, stores, and keys instead. M3.4
passed independent review and coordinator Windows/native-Linux verification;
this is not a multi-tenant authentication service.

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

- The MCP client communicates locally over stdio. Public requests use Etsy's fixed Open API origin over HTTPS; the optional OAuth transport uses only its fixed Etsy consent/token destinations. The callback listener is separate, configured ingress and is not an MCP HTTP transport.
- Proxy environment settings such as `HTTPS_PROXY` are ignored. A direct connection to Etsy must be allowed.
- Redirects are blocked and normal TLS certificate verification stays enabled.
- The startup message is written to stderr so stdout remains available for MCP messages.

## Application diagnostics

Use `ping_etsy` with an empty object to check connectivity for the configured Etsy application. A successful ping confirms application access to the Open API only; it does not verify OAuth consent, scopes, account ownership, or private-resource permissions. It accepts no URL, key, or token from the caller.

Use `get_shipping_carriers` with the required `origin_country_iso` when you need carrier reference data. The tool checks uppercase two-letter syntax without maintaining a country registry; Etsy may reject a syntactically valid country it does not support. It returns bounded selected carrier/mail-class data and does not set up shipping or buy postage.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Server does not start | Node.js version, absolute build path, whether the project was built, and whether the client passes the credential environment variable. |
| Credential format rejected | Supply the full keystring/shared-secret pair without spaces or line breaks. Never paste the actual value into an issue. |
| Etsy rejects credentials | Verify the application credentials and access with Etsy; correct formatting does not prove authorization. |
| Outbound Etsy connection fails | Check direct outbound network access and TLS trust; proxy environment settings are ignored. The OAuth callback reverse proxy is separate inbound routing and does not proxy Etsy API requests. |
| A public/API feature is unavailable | The twenty-nine public tools are always the default; a ready OAuth runtime adds the conditional consent, status, and local-disconnect tools. API availability does not imply MCP availability. |
| `begin_etsy_connection` is absent | Confirm exact `ETSY_OAUTH_ENABLED=true`, all protected storage/callback prerequisites, successful OAuth runtime startup, and that `ETSY_DEVELOPMENT_MODE` is not `true`. |
| Windows OAuth startup reports ACL inspection unavailable | Confirm local NTFS and that `powershell.exe` plus the required ACL/SID identity facilities are available to the server's runtime identity. Provision the key and restrict paths separately; do not broaden ACLs to bypass inspection. |
| OAuth startup reports a storage conflict or recovery requirement | Stop all possible owners. Do not delete a lock or recovery marker to resume credentials. Require verified offline recovery or fresh Etsy consent before reusing affected credentials. |

`npm test` builds and runs local mocked behavioral tests using synthetic credentials, not live Etsy requests. Passing tests does not establish that a particular Etsy application has live access.
