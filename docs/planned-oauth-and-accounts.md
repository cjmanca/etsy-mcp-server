# Planned OAuth and account access

**Status: user-approved design, implementation outstanding.** This foundation enables private reads, inventory, and writes; those capabilities are permitted by [policy](access-policy.md), not yet available in the running server.

## Approved M3.1 deployment and implementation contract (2026-10-17)

Read the [approved portable OAuth design](superpowers/specs/2026-10-17-portable-oauth-design.md)
and [focused implementation plan](superpowers/plans/2026-10-17-portable-oauth.md).
The user approved proceeding; M3.1 passed independent contract/ignore-prerequisite
review. Runtime OAuth implementation remains planned. Native Windows local
NTFS and Linux local POSIX storage use Node AES-256-GCM with a separate operator-
provided protected key file, not a Windows-only vault. Future Docker targets a
local named volume and separate read-only key mount; packaging is not implemented.
Workspace data/secrets require recursive Git/build-context exclusions before use.

Current topology is home-server HTTPS proxy → dev computer port 3001; eventual
dev container is on the home server. User confirmed exact registration of
`https://www.methejuggler.com/oauth/etsy/callback`. Explicit numeric LAN bind and
bounded exact trusted proxy IPs are required for nonloopback listening. Check
normalized actual socket remoteAddress before query/state/exchange, never trust
forwarded source/host headers; firewall restricts access to the protected proxy
route. Future container allowlist must reflect actual nearest proxy/bridge peer.
No listener, proxy reachability or browser consent has been verified here.

Dependency ruling: **M3.1 → M3.3a protected store/config/permissions → M3.2 secure
connect → M3.3b refresh → M3.4 → M3.5**. M3.3's parent stays incomplete until both
children pass; a usable production connection requires verified scopes/identity
and durable encrypted commit, never an interim plaintext or memory-only store.

One supported stdio client/transport per process; trusted operator/store context
is fixed at startup, not from model labels or connection-ID possession. Reject
second attachments, deny foreign IDs, fail same-store process ownership collision;
less-trusted clients need separate OS/container/store/key isolation, not a shared
unauthenticated broker. Actual private resource handlers remain future M4+ work.

User's Etsy shop Developer Mode is on and local `ETSY_DEVELOPMENT_MODE` lock is
off; these are separate controls. Preserve M0.4 unchanged: if enabled locally,
every non-GET/HEAD/OPTIONS call including OAuth POSTs fails before credentials/
network. No auth-POST exception or extra switch. Existing own-shop isolated test
permission does not replace browser consent/scopes/ownership, and no mutation
through `mcp-etsy` is permitted. No live actions follow from this documentation.

## M0.1 verified contract findings (2026-10-17)

The [operation index](contracts/operations.md) records exact security and
request/response shapes for users, addresses, getMe and tokenScopes. Read the
[callback/token audit](contracts/README.md#account-callback-and-token-contracts)
for PKCE, actual granted scopes, callback errors and current guide differences.
`getUser` is self/linked-buyer-only; primary_email needs app approval. **Address
deletion is blocked pending clarification:** the current endpoint declares
`address_r`, whereas the authentication guide associates deletion with
`address_w`. Do not silently invent a scope correction or test live deletion.
`updateShop` needs both shops_r and shops_w, and policy-linked listing reads
need listings_r. Scope bundles must reflect per-operation security, not verbs.

## M0.3 capability boundary

The runtime has typed `public`, `account`, `write`, and `event` registration
groups, but currently registers and enables only the twenty-nine public tools. The other
groups are disabled and undiscoverable; no OAuth flow, stored connection, scope
inspection, ownership check, write authorization, or event receiver is thereby
implemented. Registry enablement is trusted server configuration, never a model
argument or metadata hint. Any later tool handler must still enforce actual
granted scopes and account/resource boundaries. Test-owned registrations verify
that disabled tools stay hidden and that direct calls fail with server-generated
prerequisites before handler or request execution. The public M2.8 `ping_etsy`
tool is only an application connectivity diagnostic; it does not establish
OAuth consent, actual scopes, or account access.

## Account-connection experience

An operator selects the capability bundle they need, reviews the requested scopes, and authorizes the application at Etsy. A registered HTTPS callback completes authorization outside the model conversation. The server stores credentials securely and gives the MCP client an opaque connection identifier. The assistant never handles raw authorization codes, access tokens, refresh tokens, or PKCE verifiers.

Planned local MCP controls:

| Tool | Inputs | Result |
| --- | --- | --- |
| `begin_etsy_connection` | Requested capability bundle and nonsecret connection label. | Connection request identifier, approved authorization destination, required human action, and pending status; no token or verifier. |
| `get_etsy_connection_status` | `connection_id`. | Connected/pending/expired state, authorized account/shop IDs, granted capability names, and reauthorization guidance. |
| `disconnect_etsy_connection` | Connection ID and explicit user intent. | Local credential removal and disabled account tools. Do not claim Etsy-side token revocation unless an actual supported revocation mechanism is used. |
| `get_etsy_token_scopes` | Connection ID. | Scope names returned by `tokenScopes`, with the stored token injected internally. Never accept a raw token as a model-facing argument. |

The first three are local orchestration features, not extra REST operations in the 105-operation matrix. `tokenScopes` is a POST diagnostic with a token body; HTTP POST alone does not make it a shop mutation. Secure it as credential-bearing account access.

## Protocol and lifecycle requirements

- Authorization Code flow with PKCE S256 and a single-use state bound to the initiating operator/session; validate callback correlation before exchanging a code.
- Exact registered HTTPS redirect handling per the approved deployment above; do not assume a localhost HTTP callback is accepted. Preserve configured redirect rather than forwarded Host/proto.
- Explicit destinations: `https://www.etsy.com/oauth/connect` for user consent and `https://api.etsy.com/v3/public/oauth/token` for token exchange/refresh. Do not send API credentials to arbitrary callback or supplied URLs.
- Use app keystring as body OAuth `client_id`; full keystring/shared-secret `x-api-key` header applies to fixed token exchange/refresh and API data requests, never consent/callback. Preserve complete bearer format/user-ID prefix and verify against getMe identity.
- Store expiration and actual granted scopes; refresh internally, protect rotated refresh tokens, and require reconnection when consent expires or is removed. Guide lifetimes are one hour for access tokens and 90 days for refresh tokens; honor actual responses and current rules.
- Requesting more scopes requires fresh authorization; refreshing does not expand consent. Do not request every scope preemptively just because the roadmap covers the whole API.
- Keep connection/account data isolated across clients and operators; account switching must never reuse another account's confirmation or cached private data.
- Credential storage is resolved by the approved portable AES-256-GCM design, separate read-only key provisioning, NTFS ACL/POSIX checks, single owner lock and atomic authenticated updates; no plaintext fallback or automatic corrupt-store reset. M3.3a implements it before M3.2 can establish a connection.

### Actual scopes versus diagnostic response gate

The coordinator retrieved the current official
[authentication guide](https://developers.etsy.com/markdown/essentials/authentication.md)
on 2026-10-17: code-exchange and refresh examples/prose document `scope` as the
space-delimited actually granted set, potentially reduced. Validated token-response
scope is primary evidence for usable connections; missing/invalid evidence fails
closed, never substitutes requested scopes. The guide's formal every-request API-
key rule applies despite omitted header in token curl examples. This was public
documentation research, not a live account request.

The captured `Scopes` diagnostic schema declares no properties. M3.5a can implement
authorization using documented token scopes; M3.5b must establish a current exact
documented diagnostic shape and bounded fixtures before enabling its parser/tool.
If still unknown, keep that diagnostic and M3.5 parent incomplete, not unrelated
valid connections unusable. Unknown/unavailable diagnostic data is not evidence
against an already validated token-response scope; actual contradictory trusted
evidence, if obtained through a supported parser, fails affected access closed.

## Scope planning

| Capability | Scope baseline confirmed by inspected reference/guide |
| --- | --- |
| Own non-public catalog, inventory, product records, digital-file metadata | `listings_r`. |
| Create/edit listings and replace inventory | `listings_w`. |
| Delete a listing | `listings_d`, distinct from edit permission. |
| Shipping/processing profiles, holiday preferences, batch shipping, connected identity | `shops_r` for the inspected read operations. |
| Shop/configuration writes | Plan for `shops_w`; check each exact operation before registration. |
| Receipt/payment/ledger reads | `transactions_r`. |
| Receipt status and fulfillment updates | `transactions_w`. |
| User profile lookup | `email_r` on `getUser`; not an unrestricted user-directory permission. |
| Address lookup/deletion | Reads: `address_r`. Deletion endpoint also declares `address_r`, conflicting with guide `address_w` description; production deletion blocked until clarified. |

Scope descriptions do not prove endpoint availability. In particular, do not invent profile-edit, address-create, messaging, or checkout tools from scope names. Bind scopes per actual operation, not merely by HTTP verb or domain.

## User and address tools

| Tool | Required selection | Result and boundary |
| --- | --- | --- |
| `get_me` | Connection ID. | Connected user/shop IDs from `getMe` (`shops_r`). |
| `get_user` | Connection ID and user ID. | Permitted user summary from `getUser` (`email_r`); limited to authenticated user or linked buyers. Email availability needs additional application approval. |
| `get_user_addresses` | Connection ID and supported paging. | Authorized account's address summaries; minimize fields by default. |
| `get_user_address` | Connection ID and address ID. | Specifically requested authorized address; sensitive fields only when necessary for the task. |
| `delete_user_address` | Connection ID, address ID, confirmation. | Confirmed deletion with explicit outcome; never infer deletion approval from an address note. |

No address-create/update or user-profile-write operation appears in the researched catalog. Include the supported reads/deletion rather than implying a full CRUD surface.

## Acceptance criteria

- [ ] Denied consent, state mismatch, expired code, refresh failure, reduced scopes, and disconnect are safe, explicit outcomes.
- [ ] Tool discovery/status identifies unavailable capabilities without leaking credentials or silently escalating scopes.
- [ ] Private requests use the intended account; cross-account resource IDs and stale confirmations fail safely.
- [ ] Logs, errors, tool output, and callback failure messages contain no tokens, codes, verifiers, or shared secrets.
- [ ] User/address access respects field-level Etsy restrictions; deletion uses the shared confirmation boundary.

Next: use the resulting connection ID in the [listing/inventory](planned-listing-management.md), [shop configuration](planned-shop-management.md), and [orders/payments](planned-orders-and-payments.md) plans.
