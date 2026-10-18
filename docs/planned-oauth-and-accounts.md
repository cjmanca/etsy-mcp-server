# Planned OAuth and account access

**Status: partially implemented, with remaining M3/M4 work planned.** The protected store/config/permissions foundation (M3.3a), conditional browser OAuth connection flow (`begin_etsy_connection`, M3.2, commit `217325c`), and internal refresh/lifecycle service (M3.3b, commit `d8eb5c3`; parent M3.3) are complete and reviewed. M3.4's local status and disconnect controls are complete after independent security/spec/quality review and coordinator Windows/native-Linux verification (commit `5ad835c`). Details and limits are recorded in [TASK.md](../TASK.md), the [Task 5 report](../.superpowers/sdd/2026-10-17-portable-oauth/task-5-report.md), and the [Task 6 implementation/blocker report](../.superpowers/sdd/2026-10-17-portable-oauth/task-6-report.md). Refresh remains internal and is not invoked by status. The M3.5a operation-authorization core is complete after independent security/spec/quality approval and coordinator Windows/native-Linux verification; coordinator commit is pending and no private resource handler invokes it. The M3.5b token-scope diagnostic remains concretely blocked because the current official response schema has no declared properties, not because of operator permission. Parent M3.5 and overall M3 acceptance remain open; private Etsy tools (M4+) remain unimplemented.

## M3.1 deployment contract and current implementation status (2026-10-17)

Read the [approved portable OAuth design](superpowers/specs/2026-10-17-portable-oauth-design.md)
and [focused implementation plan](superpowers/plans/2026-10-17-portable-oauth.md).
The user approved proceeding; M3.1 passed independent contract/ignore-prerequisite
review. M3.3a, M3.2 conditional connect, and M3.3b internal refresh now exist, but the
overall M3 milestone is not complete. Native Windows local NTFS and Linux local
POSIX storage use Node AES-256-GCM with a separate operator-provided protected key
file, not a Windows-only vault. Native Windows and native Linux protected-store
acceptance evidence is recorded in the M3.3a reports; Docker deployment is not
tested. Workspace data/secrets require recursive Git/build-context exclusions
before workspace-local storage is used.

Current topology is home-server HTTPS proxy → dev computer port 3001; eventual
dev container is on the home server. User confirmed exact registration of
`https://www.methejuggler.com/oauth/etsy/callback`. Explicit numeric LAN bind and
bounded exact trusted proxy IPs are required for nonloopback listening. Runtime
checks normalized actual socket `remoteAddress` before query/state/exchange and
never trusts forwarded source/host headers. The operator must restrict the
firewall to the protected proxy route; the future container allowlist must reflect
the actual nearest proxy/bridge peer. Callback tests bind synthetic loopback only;
no deployed listener, proxy reachability, or live browser consent has been verified.

Dependency ruling: **M3.1 → M3.3a protected store/config/permissions → M3.2 secure
connect → M3.3b refresh → M3.4 → M3.5**. Both M3.3 children have passed, completing
the storage/refresh parent; a usable production connection requires verified scopes/identity
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

## Current capability boundary

The runtime has typed `public`, `account`, `write`, and `event` registration
groups. By default it registers and enables only the twenty-nine public tools.
When `ETSY_OAUTH_ENABLED=true` and the protected store, key, and callback listener
start successfully, it conditionally adds `begin_etsy_connection`,
`get_etsy_connection_status`, and `disconnect_etsy_connection` under `account`.
The begin entry point starts browser consent and completes a durable protected
connection after callback identity/scope checks. The two lifecycle controls inspect
or remove local connection credentials only; none of these tools exposes private
Etsy resource data. The lifecycle implementation passed independent review and
coordinator platform verification. Internal refresh remains separate from status.
The M3.5a authorization guard is not yet integrated with any private resource
handler; private reads, writes, and event handling remain unavailable.
Registry enablement is trusted startup configuration, never a model argument or
metadata hint. An unavailable begin tool is undiscoverable and direct dispatch
receives a server-generated prerequisite; status and disconnect remain available
when the local development lock blocks OAuth POSTs. The public M2.8 `ping_etsy`
tool remains only an application connectivity diagnostic; it does not establish
OAuth consent, actual scopes, or private-resource access.

## Current conditional connection entry point

After an operator completes the [OAuth setup prerequisites](setup-and-access.md#optional-browser-based-account-connection), a client may call `begin_etsy_connection` with a read-capability bundle and optional nonsecret label. The tool returns a generated Etsy authorization URL and required human action; the operator completes consent in a browser. A fixed callback path validates the actual trusted socket peer and state, exchanges the code internally, validates the granted scope and Etsy identity, and commits the credentials to the encrypted store. The callback returns a static completion page. The MCP conversation never receives the raw authorization code, access/refresh token, or PKCE verifier. The flow adds no private account data tools; the separately listed lifecycle controls below do not call Etsy.

The tool is present only when OAuth is explicitly enabled and runtime prerequisites succeed. `ETSY_DEVELOPMENT_MODE=true` hides/disables it because the conservative method lock blocks the OAuth POST requests. The default remains the same twenty-nine public tools and does not open a callback listener or read OAuth key/store files.

| Tool | Inputs | Result |
| --- | --- | --- |
| `begin_etsy_connection` | Read-capability bundle and optional nonsecret label. | **Conditional current implementation:** authorization URL, human action, pending request ID/status; no token or verifier. M3.2 independent source/docs review and coordinator final platform verification passed. |
| `get_etsy_connection_status` | `connection_id`. | **Conditional current (M3.4; reviewed):** bounded local state, requested/verified granted scopes, consented capability names, verified account/shop IDs, expiry, and fixed reconnect guidance. Does not refresh credentials or expose credentials/URLs. `shops_r` is labeled `account_identity`, not as an implemented private shop-read tool. Recent terminal flow statuses are in-memory, capped at 100 entries and five minutes. |
| `disconnect_etsy_connection` | `connection_id` and `confirm_local_disconnect: true`. | **Conditional current (M3.4; reviewed):** immediately disables local dispatch, consumes a matching pending attempt, serializes removal behind in-flight lifecycle work, and reports either completed local removal or `recovery_required`. The result always says `upstream_revoked: false`; no Etsy-side token revocation is performed. |
| `get_etsy_token_scopes` | Connection ID. | **Registered but unavailable (M3.5b blocked):** omitted from discovery and direct calls receive a prerequisite. The current `Scopes` schema has `properties: {}`; no parser, transport call, or token read is enabled. Never accept a raw token as a model-facing argument. |

These are local orchestration features, not extra REST operations in the 105-operation matrix. `tokenScopes` is a POST diagnostic with a token body; HTTP POST alone does not make it a shop mutation. Secure it as credential-bearing account access. Keep the public-tool count at twenty-nine by default; a ready OAuth runtime adds all three conditional connection tools (32 total). With the local development lock enabled, `begin_etsy_connection` is hidden/denied while status and disconnect remain available (31 total).

The supported deployment remains one trusted operator and one stdio transport attachment per server instance. A second attachment is rejected before dispatch; separate operators or less-trusted clients require separate OS/container instances, protected stores, and keys. Connection IDs and MCP client/model labels do not authenticate tenants. Disconnect removes local credentials only, and a recovery-required result keeps access disabled; it is not proof of durable removal or Etsy-side revocation.

M3.3b's verified `ensureFresh` and `withConnection` methods are current internal service interfaces only. No current MCP tool or private Etsy handler invokes them; status performs no refresh. Overlapping callers share a freshness flight, including short-lived responses; rotated credentials and actual grants are committed before release. Ambiguous POST outcomes are not replayed, persistence failures block stale reuse, and expiry is rechecked after commit and before serialized work. Expired rotations remain durably saved but are not released; no same-call refresh loop occurs. M3.4's model-facing local status/disconnect integration is complete and reviewed. Disconnect invalidation is rechecked after awaited reads/flights/work; accepted status calls retain invalidation protection even if a terminal entry expires or is evicted. Already-started work is not cancelled, but its result is withheld after disconnect. The M3.5a guard is complete and reviewed but is not called by any private handler; M3.5b's diagnostic remains unavailable and parent M3.5 remains open.

## Protocol and lifecycle requirements

- Authorization Code flow with PKCE S256 and a single-use state bound to the initiating operator/session; validate callback correlation before exchanging a code.
- Exact registered HTTPS redirect handling per the approved deployment above; do not assume a localhost HTTP callback is accepted. Preserve configured redirect rather than forwarded Host/proto.
- Explicit destinations: `https://www.etsy.com/oauth/connect` for user consent and `https://api.etsy.com/v3/public/oauth/token` for token exchange/refresh. Do not send API credentials to arbitrary callback or supplied URLs.
- Use app keystring as body OAuth `client_id`; full keystring/shared-secret `x-api-key` header applies to fixed token exchange/refresh and API data requests, never consent/callback. Preserve complete bearer format/user-ID prefix and verify against getMe identity.
- Store expiration and actual granted scopes; refresh internally, protect rotated refresh tokens, and require reconnection when consent expires or is removed. Guide lifetimes are one hour for access tokens and 90 days for refresh tokens; honor actual responses and current rules.
- Requesting more scopes requires fresh authorization; refreshing does not expand consent. Do not request every scope preemptively just because the roadmap covers the whole API.
- Keep connection/account data isolated across clients and operators; account switching must never reuse another account's confirmation or cached private data.
- Credential storage uses the approved portable AES-256-GCM design, separate protected binary key, NTFS ACL/POSIX checks, single owner lock, and atomic authenticated updates; there is no plaintext fallback or automatic corrupt-store reset. M3.3a is implemented before the M3.2 flow can commit a connection. Native Windows and native Linux storage evidence exists; future Docker deployment is untested.

### Uncertain rollback and offline recovery

If shutdown cannot compensate a possibly committed OAuth write, the protected
store persists the fixed owner-bound `oauth-recovery-required.json` marker and
checks it before reading key bytes or credential snapshots on reopen. It contains
only owner context and a fixed reason, never connection IDs or credential data.
If the marker cannot be durably written and verified, the current process retains
its ownership lock; ordinary reopen remains blocked. Neither a stale lock nor an
uncertain callback/commit is permission to simply unlock and resume potentially
cancelled credentials. Stop all possible owners and require verified offline
recovery or fresh Etsy consent before reusing affected credentials. Normal runtime
has no marker clear/reset or filesystem API. This is not a guarantee against every
power-loss window or a malicious local operator.

### Actual scopes versus diagnostic response gate

The coordinator retrieved the current official
[authentication guide](https://developers.etsy.com/markdown/essentials/authentication.md)
on 2026-10-17: code-exchange and refresh examples/prose document `scope` as the
space-delimited actually granted set, potentially reduced. Validated token-response
scope is primary evidence for usable connections; missing/invalid evidence fails
closed, never substitutes requested scopes. The guide's formal every-request API-
key rule applies despite omitted header in token curl examples. This was public
documentation research, not a live account request.

The current official [generated OpenAPI document](https://www.etsy.com/openapi/generated/oas/3.0.0.json)
was re-fetched on 2026-10-17. Its `tokenScopes` operation is API-key-only
`POST /v3/application/scopes` with a required form-urlencoded `token`; the 200
response references `Scopes`. The schema description says “A list of scopes allowed
for the token” but declares `properties: {}` and no response example or bounds.
The authentication guide documents token-response `scope`, not the diagnostic
response body. Therefore M3.5b cannot safely define a parser or enable the
`get_etsy_token_scopes` transport call. Its registration is known but unavailable:
it is hidden from discovery and direct calls fail with a server-generated
prerequisite before stored credentials are read. This diagnostic blocker does not
invalidate valid, documented token-response scopes.

The M3.5a guard checks the connection owner and generation, usable lifecycle state,
the intersection of validated token-response grants and consent-requested scopes,
the configured account/write capability, exact operation requirements, and
trusted account/shop/relationship proof. Independent security/spec/quality review
approved after one dispatch-coverage fix round; coordinator Windows/native-Linux
verification passed (370 tests each, including real SIGTERM on Linux). No M4+ handler invokes the guard; it does not expose private access or
authorize a mutation. Writes still require M5's separate operation-specific
approval and confirmation boundary. Unknown/unavailable diagnostic data is not
evidence against validated token-response scopes; actual contradictory trusted
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
