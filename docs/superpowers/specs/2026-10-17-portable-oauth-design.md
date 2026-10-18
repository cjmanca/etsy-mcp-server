# Portable OAuth and account connections — M3 design

**2026-10-17 — USER-APPROVED design; implementation refinements incorporated.**
This document defines the M3.1–M3.5 design contract, not evidence of a deployed
callback or live account connection. M3.1, M3.3a, and the conditional M3.2 connect
flow are complete after independent source/docs review and final coordinator
Windows/native-Linux verification (including real child SIGTERM); concrete
evidence is recorded in `TASK.md`. M3.3b internal refresh and parent M3.3 are also
complete after independent security/spec/quality approval and final coordinator
Windows/native-Linux verification; no current MCP/private handler invokes refresh.
M3.4 local status/disconnect is also complete after independent security/spec/quality
approval and coordinator Windows/native-Linux verification (commit `5ad835c`).
M3.5a's authorization core is complete after independent review and coordinator
Windows/native-Linux verification; M3.5b is blocked by the empty official `Scopes`
response contract. Parent M3.5 and private M4+ tools remain incomplete; overall M3 acceptance remains
open. The user confirmed exact Etsy redirect
registration; listener/reverse-proxy reachability, key provisioning, and live
consent have not been verified.

## 1. Authority, scope, and decisions

The user chose native Windows support **and future Docker compatibility**, a
portable encrypted credential store with a separately supplied key, and ignored
workspace-local secret/storage locations. An OS-specific credential vault must
not be required. The user owns an HTTPS proxy for
`https://www.methejuggler.com/oauth/etsy/*` on the **home server**, forwarding to
the current **development computer**. Eventually this project will run in a dev
container on that home server. The exact registered redirect is
`https://www.methejuggler.com/oauth/etsy/callback`, backend port **3001**.

The user explicitly approved proceeding with the reviewed design. The following
are its accepted design defaults, with topology-specific builder refinements:

- Node's built-in AES-256-GCM; one operator/configured MCP instance owns a store
  and callback; no broker or multi-tenant service.
- Safe default callback `127.0.0.1:3001`, fixed path `/oauth/etsy/callback`;
  the current remote proxy requires an explicitly configured LAN bind and actual
  socket-peer allowlist as specified in section 3, not the loopback default.
  Deployment example's exact redirect:
  `https://www.methejuggler.com/oauth/etsy/callback`. Port 3001 and this exact
  callback were supplied/confirmed by the user, including registration. No new
  hostname, permission, callback-registration or approval question is needed.
- Native application-data storage outside the repository, Docker `/data`, and a
  separate read-only mounted key file. In-memory, restart-expiring pending flows.
- `shops_r` as the minimal connection identity baseline, with additional scopes
  selected explicitly by bundle.
- Preserve M0.4's conservative local method lock unchanged, including for the
  isolated OAuth transport. No auth-POST exception or extra switch is proposed.

Proxy topology and overall design approval are now resolved. Actual LAN/proxy IP
values are operator-supplied trusted configuration, not values to request in chat.
Platform, firewall/routing and query-log checks remain implementation/manual setup
evidence, not further design-permission questions. Approval is not automatic
network deployment, browser consent or a claim that the callback already works.

Approval of this document approves a development contract only. The confirmed
redirect registration does not implement proxy/firewall settings, provision
secrets or perform live consent; setup and release retain the gates below. No Docker
image, Compose stack, public MCP transport, generic HTTP/file tool, seller write,
or OS credential-vault integration is part of M3.

**User clarification:** Etsy **shop Developer Mode is ON**; the local tool's
`ETSY_DEVELOPMENT_MODE` lock is **not enabled**. These are different controls;
neither is an Etsy sandbox. The user has already temporarily permitted isolated
mutating tests on their own shop, subject to Etsy testing restrictions and no
effects on other people/shops. Do not ask for that permission again. It does not
replace human browser OAuth consent, required setup, scopes, ownership checks or
operation-specific safety controls. The developer prohibition on mutating calls
through `mcp-etsy` still applies. This documentation task performs no actions.

## 2. Existing contracts and proposed boundaries

Sources: [access policy](../../access-policy.md),
[safety](../../response-handling-and-safety.md),
[planned OAuth](../../planned-oauth-and-accounts.md),
[setup](../../setup-and-access.md), [M0.1 audit](../../contracts/README.md#account-callback-and-token-contracts),
[operation contracts](../../contracts/operations.md), and the original official
OpenAPI snapshot dated 2026-10-17. Additionally, the coordinator retrieved the
current official [authentication guide](https://developers.etsy.com/markdown/essentials/authentication.md)
on **2026-10-17**, after the builder check. Both authorization-code and refresh
JSON examples include `scope: "transactions_r transactions_w"`; the prose defines
this as space-delimited **actually granted** scopes, possibly a subset of those
requested, including in refresh responses. The same guide's formal API-key rule
requires the full `x-api-key` pair on every API request, despite omission from its
token curl examples. Sections 6–7 incorporate those source-backed clarifications.
This was public documentation retrieval, **not a live account request**. No live
account requests were made. Revalidate affected contracts before coding without
using real account credentials or probing account access.

MCP remains local stdio. The HTTP component accepts only the fixed OAuth callback
GET; it cannot dispatch MCP, begin consent, accept credentials, or fetch supplied
URLs. Public tools stay usable without OAuth configuration.

Separate responsibilities introduced only with their owning M3 tasks:

1. Startup-validated immutable operator configuration and capability gates.
2. Connection service: owner lookup, pending state, lifecycle, per-connection
   serialization, account/resource guards, and bounded nonsecret projections.
3. Protected store: permission/path checks, exclusive process ownership,
   authenticated encryption, crash-safe snapshot replacement.
4. Callback handler: correlation and bounded browser responses only.
5. Destination-specific OAuth transport: only reviewed code exchange, refresh,
   and scope diagnostic operations; never a general request client.

## 3. Trusted configuration and deployment

All names below are approved startup configuration; the M3.2 runtime implements
these controls. See the [operator setup guide](../../setup-and-access.md#optional-browser-based-account-connection)
for the current activation instructions. Values are snapshotted at startup and
cannot be changed by tool arguments, client metadata, callback parameters, or
later environment changes. Paths are configuration, never model file handles.

| Setting | Contract |
| --- | --- |
| `ETSY_OAUTH_ENABLED` | Default false; strict true/false startup parsing. Account tools require this and successful prerequisites. |
| `ETSY_OAUTH_OPERATOR_ID` | Required when enabled, nonsecret stable namespace, 1–64 ASCII alphanumeric/underscore/hyphen characters; operator-provisioned per trusted MCP instance. |
| `ETSY_OAUTH_DATA_DIR` | Optional absolute local data root; resolve once, no URI/network share. |
| `ETSY_OAUTH_KEY_FILE` | Required absolute path to a separately provisioned 32-byte binary key file; no key value environment variable, tool argument, or CLI argument. |
| `ETSY_OAUTH_REDIRECT_URI` | Required exact HTTPS URI with fixed callback path; no userinfo, fragment, query, or wildcard. Personal domain is an example, never a library default. |
| `ETSY_OAUTH_CALLBACK_HOST` | Default `127.0.0.1`; explicit numeric IPv4/IPv6 LAN address or `0.0.0.0` permitted only with nonloopback peer policy below. No DNS hostname, interface discovery or model input. |
| `ETSY_OAUTH_CALLBACK_PORT` | Default 3001, validated integer 1–65535; configured port only, no automatic fallback. |
| `ETSY_OAUTH_TRUSTED_PROXY_IPS` | Comma-separated exact numeric socket-peer IPs, at most 16 entries of at most 45 characters; required and nonempty for any nonloopback bind. No hostname, wildcard, CIDR, port or zone ID. Normalize IPv4-mapped IPv6 before exact comparison. Loopback-only bind defaults to loopback peers only. |

The callback path is fixed in code and must match configured redirect's path
exactly. Deployment config may change the HTTPS host, not the transport's Etsy
destinations. Redirects are built from validated startup configuration, never
`Host`, `Forwarded`, `X-Forwarded-*`, a model URL, or an upstream error URI.

### Runtime paths and permissions

Initial implementation targets are native Windows on **local NTFS** and a Linux
**local POSIX filesystem**, with the latter the storage baseline for a future
Docker **local named volume**. Windows-host Docker bind mounts, network/shared
volumes and other filesystems are unsupported unless individually verified and
reviewed for permissions, locks, reparse/symlink handling and atomic replacement.
Linux native validation is not a claim of a tested Docker release. Other platform
path conventions below are future layout guidance, not initial support claims.

- Native Windows default: `%LOCALAPPDATA%\etsy-mcp-server\<operator-id>`.
  Require an absolute resolved application-data base; do not fall back to CWD
  when missing. Other native platforms use their user application-data directory
  (macOS `~/Library/Application Support/etsy-mcp-server/<operator-id>`, Linux
  absolute `XDG_DATA_HOME` or `~/.local/share/etsy-mcp-server/<operator-id>`).
- Docker future layout: operator-persisted local named-volume mount at `/data`,
  root `/data/<operator-id>`; key mounted read-only at
  `/run/secrets/etsy-oauth-key`. Run as a dedicated nonroot UID/GID with ownership
  of data and read access to this key, not a world-readable secret mount. Use a
  read-only container root filesystem where practical. Never bake key or store
  into an image, build argument, build cache, or environment value.
- Optional workspace data root `.etsy-mcp/`; optional workspace key provision
  directory `.etsy-mcp-secrets/` is discouraged but must be protected identically
  and physically separate from data. Preferred key location is outside both
  repository and data root. Reject key paths inside the data root, including
  canonical aliases. Backup media must not combine key and ciphertext by default.
- POSIX data directories 0700 and files 0600; external key 0400 or 0600, owned by
  runtime UID or explicitly trusted administrator, no group/other access. Data
  must be writable only by runtime UID/trusted administrator. Set restrictive
  creation permissions, not just chmod after exposing file contents.
- Windows requires a local NTFS directory/file ACL limited to runtime user SID,
  SYSTEM and Administrators, with inheritance that would grant other principals
  removed. Key need only grant runtime read; data grants runtime modify.
  Node mode bits alone do **not** verify Windows permissions. Implementation must
  use an explicitly permitted, reviewed fixed Windows ACL inspection helper (fixed PowerShell
  `Get-Acl`/SID inspection invoked without a shell and with paths passed as data,
  not interpolated script). No model-facing shell tool or arbitrary command.
  If ACL inspection is unavailable/unsupported or cannot establish these bounds,
  OAuth startup fails with nonsecret setup guidance. This platform helper needs
  no new runtime key-vault dependency; its availability is a Windows setup prerequisite.
  Approval of this design permits that narrowly fixed internal helper, not
  arbitrary scripts, model filesystem access, or shell commands.
- Canonicalize trusted configured roots; reject network filesystems, symlinks,
  junctions/reparse points, nonregular files, unexpected hard links, and
  untrusted-writable ancestors within the operator-managed tree. Validate again
  when opening; use no-follow/exclusive creation where supported. Existing
  ancestor OS/application-data folders must not permit an untrusted principal to
  replace the protected root. Permissions must precede secret access; Windows
  reparse checks and ACL tests are release gates, not assumed Node guarantees.
  The protected-directory boundary assumes no malicious same-user/admin process;
  this is not a sandbox against a compromised runtime user.
- Store filenames are fixed or derived from server-generated IDs only; no label,
  account ID, `connection_id` input, or callback field becomes a file path.

**Ignore prerequisites implemented and tested in M3.1.** Both `.gitignore` and
`.dockerignore` contain recursive `**/.etsy-mcp/` and `**/.etsy-mcp-secrets/`
rules covering root/nested encrypted records, locks, temporaries, backups, key
files, and any future contained pending-state artifacts. The synthetic ignore
test verifies representative absent paths with `git check-ignore --no-index`,
both files' rule contracts, and no tracked runtime/key descendants; M3.1 review
and coordinator evidence are recorded in `TASK.md`. Ignores do not untrack
existing files or remove history. No real secrets were created for verification.
The `.dockerignore` rule test is not a Docker build/context execution test;
verify the actual build context before any separately authorized future image
build. No Docker packaging is authorized by documenting these paths.

### Listener deployment

Current approved topology: home-server HTTPS proxy → development computer port
3001, preserving `/oauth/etsy/callback` and necessary query values exactly. The
operator explicitly configures the development computer's numeric LAN bind
(preferred) or `0.0.0.0` and a nonempty bounded exact home-server peer-IP allowlist.
The safe unset default stays `127.0.0.1`; it does not work for a remote proxy and
must not silently widen. Internal HTTP is acceptable only over a trusted isolated
LAN/protected tunnel after external TLS termination; an untrusted segment needs
TLS or other reviewed transport protection. Firewall permits the home server only;
never expose backend port 3001 directly to the Internet. No firewall/proxy/listener
changes are performed as part of documenting this contract.

Before query decoding, state lookup, or token exchange, normalize and compare
the **actual socket `remoteAddress`** to the configured peer allowlist; reject
unknown/missing/untrusted addresses generically. IPv4-mapped IPv6 must compare as
the equivalent IPv4 address; IPv6 canonical forms compare consistently. Reject
wildcards/unspecified/multicast allowlist entries. Forwarded-source headers are
never identity or authorization evidence. Even an allowlisted proxy must pass
all method/path/bounds/state/PKCE checks. Do not derive redirect/owner from Host,
forwarded headers or caller fields. Configuration accepts actual numeric values
only; it does not resolve arbitrary hostnames or expand CIDRs.

For future Docker use, explicitly select container bind `0.0.0.0:3001` with host
mapping `127.0.0.1:3001:3001` **only if the reverse proxy runs on that host**.
For the eventual home-server container, alternatively use a trusted restricted
container-proxy network. In either case configure the allowlist for the **nearest
actual socket peer**, accounting for Docker bridge/NAT addresses rather than
trusting `X-Forwarded-For`; changed topology requires trusted config and restart.
Otherwise use an operator-firewalled proxy-only backend/network and TLS or other
reviewed protection across untrusted links. Do not default to `3001:3001` on all
host interfaces. Only the callback is routed publicly; no stdio/MCP bridge.

Before reporting OAuth ready, acquire store ownership, validate permissions/key,
and bind the exact port. Missing key, unreadable store, permission uncertainty,
or port collision fails OAuth-enabled startup before tool registration. Public-
only startup with OAuth disabled never starts a listener or reads the key. No
silent partial account readiness or fallback to a different port/store.

## 4. Portable encrypted store

### Format and authentication

Use Node `crypto` AES-256-GCM with an operator-generated random **32-byte binary
key**, fresh CSPRNG 12-byte nonce for **every** encryption, 16-byte authentication
tag, and strict versioned JSON envelopes. No plaintext fallback, automatic key
generation in data, or automatic reset after authentication failure. Reject
unknown version/algorithm, wrong key, missing fields, oversized input, nonce/tag
length errors, and corrupt ciphertext before using any decrypted fields.

One bounded snapshot `connections.enc` contains all connections (maximum 100,
4 MiB encrypted file; maximum decrypted payload 2 MiB, per-record tokens 16 KiB
each, labels 100 characters). Use nested envelopes:

- Outer envelope exposes only format version, random store ID, operator namespace,
  monotonically increasing generation, nonce, tag, and ciphertext. Its canonical
  fixed-order AAD tuple is `[format, storeId, operatorId, generation]`.
- Encrypted snapshot holds bounded records and any local disconnect tombstones;
  each record envelope's AAD is the fixed-order tuple
  `[format, storeId, operatorId, connectionId, accountId, recordGeneration]`.
  This connection/account metadata remains inside the outer ciphertext. Each
  record has its own fresh nonce/tag. Outer authentication protects the complete
  set, membership, and deletion; inner authentication binds credentials to their
  owner/account/connection. Never concatenate ambiguous strings as AAD.
- Record payload: exact access/refresh token strings (including Etsy user-ID
  prefix), expiry/issued timestamps, requested and verified granted scopes,
  scope-evidence source/time, verified user/shop IDs, label, lifecycle state,
  revocation/reconnect reason code and record generation. No raw callback query,
  authorization code or PKCE verifier is persisted.
- Validate both envelope and decrypted schema; reject duplicate connection IDs,
  owner mismatch or inconsistent account metadata. ID/scopes are bounded and
  never coerced from unsafe integers. Sensitive fields never pass through a
  generic JSON/error serializer into MCP output.

Encryption protects offline data disclosure/tampering without the key, not an
attacker who can read process memory/key, replace application code, or restore
an old valid snapshot plus key. Generation detects in-process stale writes, not
cryptographic rollback after restart. Document that limitation; do not claim
hardware-backed rollback protection or guaranteed memory erasure in JavaScript.

### Single owner, updates, and crashes

Only one process may own a configured store and callback. Acquire an exclusive
fixed-name lock directory before reading/decrypting the store; no shared network
volume or multiwriter mode. Bound nonsecret lock metadata contains process ID,
random boot ID and creation time. Any existing lock fails closed; no timeout/PID
guessing or automatic stale-lock stealing. A stale or uncertain lock is not
permission to remove it and resume credentials: if an OAuth callback or durable
commit may have been in flight, require verified offline recovery or fresh Etsy
consent before reusing any affected connection. Stop all possible owners and
verify that no owner remains before any documented offline lock handling. Other
stdio processes may run public-only with separate configuration, but cannot
attach to this account service. No unreviewed broker, port takeover, or reading
another instance's unlocked credentials.

Serialize full-store commits plus per-connection lifecycle operations (including
refresh, scope inspection, reconnect and disconnect). Check record generation
before commit. Write an exclusively created 0600/ACL-protected same-directory
temporary containing ciphertext only, flush/fsync it, replace `connections.enc`
atomically, and flush the containing directory where supported. Never unlink
the live file before replacement. On Windows use same-volume atomic replacement;
bounded retry for local sharing violations only, otherwise fail without claiming
success. Windows/container filesystem crash behavior must be verified using
fault-injection tests before release; if a target cannot support safe replacement,
refuse that storage backend instead of weakening the protocol.

Startup after a crash accepts only a fully authenticated committed snapshot;
orphan temporaries are never promoted automatically. A missing live file with
unexpected temporaries requires recovery, not a new empty store. First use may
initialize only an otherwise empty provisioned store under lock. Unknown/corrupt
store data remains untouched for operator recovery. A successful token response
is not an established connection until identity/scopes and durable persistence
succeed. If persistence fails after a rotation, block further use and report
reconnect/recovery required; never use stale credentials from disk silently.

If a late OAuth commit cannot be safely compensated during shutdown, the owning
store writes the fixed `oauth-recovery-required.json` marker under its exclusive
lock. It contains only the format, exact operator/app owner context, and a fixed
reason; it contains no connection ID or record/token payload. Reopen checks this
marker after acquiring ownership but before reading key bytes or the encrypted
snapshot. A present, malformed, or differently owned marker fails closed. The
store releases its lock after a verified durable marker; if marker persistence or
verification fails, it deliberately retains the existing lock so ordinary reopen
continues to fail closed. Normal startup never clears the marker or resets the
store. Recovery is an offline operator action requiring verified recovery/fresh
consent; no model-facing filesystem operation is provided. This fence addresses
the handled uncertain-rollback path, not every power-loss window or a malicious
same-user/local administrator.

### Backup, disconnect, key loss and rotation

Backups are opt-in offline encrypted snapshots after stopping the owner; no
automatic token-bearing history. Keep key backups separately access-controlled,
out of Git/images, and document retention/deletion. Loss of the key is not
recoverable from the ciphertext: reauthorize accounts with a newly provisioned
store/key, preserving old data separately if needed. Corruption requires verified
offline backup restoration or fresh consent, not bypassing authentication.

Offline rotation: stop owner, separately back up ciphertext and old key, provision
new key outside data, authenticate/decrypt old snapshot, re-encrypt every record
and outer envelope with fresh nonces, atomically replace only after validation,
then switch configured read-only key path and restart. A reviewed local maintenance
utility can implement this in future; no model tool takes either key. Retain old
key only until separately protected backups are migrated/expired. No key auto-
discovery or trying a directory of keys at runtime. Restore only a matched
snapshot/key pair; old backups may contain stale rotated tokens or disconnected
credentials and must be treated as requiring fresh consent before account use.
Offline backup restore must mark all connections reconnect-required as part of
the reviewed recovery procedure; simply placing an old snapshot back is unsafe.

Local disconnect serializes behind in-flight lifecycle work, disables new
dispatch immediately, consumes pending attempts, drops caches/confirmations,
durably removes credentials, and only then reports removal complete. Late callback
or refresh results cannot resurrect a disconnected generation. If persistence
fails, keep runtime access disabled and report incomplete local removal; startup
must not be represented as durably disconnected. No promise of secure physical
erasure from journals/backups or Etsy-side revocation. Operator handles backups
and Etsy application access settings separately.

## 5. Operator ownership and consent lifecycle

### Identity boundary

Supported deployment is **one trusted human operator and exactly one MCP stdio
transport/client per server process**, isolated per OS/container instance. Reject
any attempted second transport/client attachment before dispatch or exposing
connection state; do not add a multiplexer, client-switching API or shared broker.
Startup namespace + protected store location bind its connections;
the process has one trusted owner context supplied internally to all account
services. Model labels, MCP client names/session metadata, arbitrary account IDs,
and possession of `connection_id` do not establish owner identity. Do not expose
the namespace selector as a tool argument. Different operators/less-trusted
clients need separate OS/container isolation, stores and keys; do not point them
at the same service. The one attached client acts for that trusted operator;
neither namespace nor a model-supplied name authenticates multiple clients.

This preserves M3.5's cross-client denial prerequisite under the supported
architecture: no second client can attach to obtain the first client's context;
foreign connection IDs in an independently isolated instance are unavailable;
another process targeting the same protected store fails its ownership lock.
Test all three boundaries, including direct foreign-ID dispatch. Do not weaken
M3.5 to trusting labels or drop its cross-client checks. A truly shared multiuser
broker would require a new approved authentication/isolation design; this design
does not claim tenant authentication or protection from malicious same-user code.

Opaque request/connection IDs use at least 128 random bits, bounded base64url
syntax and internal lookup; guessed/foreign IDs yield the same generic unavailable
outcome without enumerating another owner's records. Persisted connections may
be reused after restart **only** with the same trusted operator namespace, store,
key and app identity; bind the application client-ID fingerprint in the protected
store and require new consent on mismatch. Do not transfer sessions by copying
labels. Pending attempts die on process restart/stdio termination. No cross-
instance connection discovery tool or public status endpoint.

### Flow

1. Explicit human intent initiates `begin_etsy_connection` for approved bundle
   enum(s) and optional nonsecret label. Validate capability availability first;
   unsupported features are not made available by granting scopes. State is 32
   random bytes; verifier is 32 random bytes base64url (43 unreserved characters),
   PKCE challenge SHA-256/base64url, method S256. Pending memory binds a separate
   opaque request ID, operator, initiating local session/boot, requested scopes,
   exact redirect/client ID, creation/expiry, and optional replacement connection
   generation. Maximum 10 pending attempts, five-minute TTL; refuse overflow.
2. Return the fixed Etsy authorization URL with response_type=code, client_id,
   redirect_uri, explicit space-delimited scope, state, challenge and S256.
   Human opens it and reviews Etsy consent/account selection; no auto-launch or
   background consenting. Explain bundle purposes, identity scope, and no
   inference of approval for later private data reads/writes.
3. Callback requires an unexpired pending state tied to the still-live initiating
   context. Atomically claim/consume it **before** exchange. A matching denied
   consent also consumes it. Unsolicited, expired, replayed, foreign-session or
   malformed requests cannot exchange codes or establish a connection.
4. Exchange code internally once. Validate token response, actual scopes, expiry
   and full token format; discover identity with `getMe` using `shops_r`. Require
   verified safe-integer user ID and matching bearer user-ID prefix. Use returned
   shop ID only if valid/present; absence is not an invented owned shop. Reject
   conflicting IDs and make identity-verification failures reconnect-required.
5. Persist connection only after these checks and durable store commit. Callback
   shows generic completion, not account details or connection IDs. Status by
   request/connection ID in the original trusted MCP instance supplies outcome.
   The request ID issued at initiation becomes the connection ID on success;
   no state value is needed for status lookup. Denied/expired/failed attempts
   remain only bounded nonsecret in-memory status until TTL cleanup.

**State-output clarification:** authorization URL necessarily contains opaque
state and public code challenge. Permit those only in this dedicated consent URL
response; state is not a separate returned field, credential, ownership proof,
or status handle. Never log it or reflect it on completion. The verifier stays
secret. This narrowly resolves any absolute “no state in output” prose; codes,
tokens, shared secret and verifier remain prohibited everywhere in model output.
The URL itself is sensitive correlation data and should not enter analytics,
issue reports or proxy logs. A client that cannot present a consent URL without
inappropriate retention must not enable this flow without another reviewed UI.

Reauthorization explicitly targets an owned connection, requests a reviewed new
bundle union and leaves existing verified access unchanged until success. For an
in-place reconnect, returned account ID must equal the existing account; account
switching instead creates a new connection after explicit operator intent. New
account never inherits private cache entries or confirmations. Failed/denied
scope escalation does not overwrite working credentials or increase permissions.

## 6. Scope evidence, refresh, and authorization

### Bundles

No all-scopes default. Empty bundle selection means identity-only `shops_r` and
must be described as such; connection UI shows the final exact scope set.

| Explicit bundle | Incremental scopes beyond identity `shops_r` |
| --- | --- |
| Own catalog/inventory | `listings_r` |
| Shop/configuration reads | none (`shops_r` already present) |
| Order/financial reads | `transactions_r` |
| Profile reads, only if requested | `email_r` |
| Address reads, only if requested | `address_r` |
| Listing edits, separately approved future feature | `listings_w` |
| Listing deletion, distinct future consent | `listings_d` |
| Shop writes, separately approved future feature | `shops_w` (together with baseline `shops_r`) |
| Fulfillment/receipt writes, separately approved future feature | `transactions_w` |

`shops_r` is broader than a pure identity-only scope, but `getMe` requires it;
safe account binding justifies this explicitly disclosed baseline. Write bundles
are not enabled in M3; keep the scope map for future exact-operation consent, not
as permission to ship write handlers. Read-before-write features may separately
need `listings_r`/`transactions_r`; do not assume write implies read. Address
deletion remains blocked by the audited address_r/address_w conflict. Profile/
address/email access and app approval restrictions remain even with scope consent.

### Actual granted scopes

Never equate requested with granted. **Primary evidence is the documented
`scope` string from the trusted authorization-code or refresh token response**,
per the current official guide retrieved by the coordinator on 2026-10-17.
Validate a bounded space-delimited string and its scope names, then record source
(`authorization_code_response` or `refresh_response`) and receipt time. Its
documented shape is not an invented field. A valid token response's actual scope
set is sufficient evidence for a usable connection (subject to identity, grants,
ownership and durable storage); **no tokenScopes call is required** to connect or
refresh when this evidence is present. Reduced grants immediately reduce access.

Missing, malformed or uncertain `scope` yields `scope_verification_required` and
no private dispatch; never silently retain previously granted scopes after a
refresh lacking current evidence, or fall back to requested scopes. A separately
supported diagnostic may establish evidence later, but cannot be assumed usable.

**Separate M3.5 diagnostic gate:** the captured official `Scopes` schema has no
declared properties. Before enabling `get_etsy_token_scopes`, refresh its exact
reference/guide and establish the supported bounded response shape with documented
fixtures. Do not invent parser keys. Until then keep this diagnostic unavailable
with a safe prerequisite message, not all token-response-verified connections.
The diagnostic always resolves its token internally, never from a model argument.
If no supported shape can be established, M3.5's diagnostic remains outstanding;
this does not block valid token-response-scope connect/refresh flows or falsely
complete M3.5. Unknown diagnostic shapes cannot elevate or replace trusted grants.
An absent/unknown/malformed diagnostic response is not contradictory trusted
evidence and cannot invalidate already validated documented token-response
grants; only a successfully parsed supported response can supply such evidence.

Validate scope names against the reviewed Etsy scope enum, bounded to 32 names
of at most 64 characters; unknown/new scope values cannot enable capabilities.
Use the intersection of verified grants, explicitly consent-requested scopes,
configured capabilities, exact operation requirements and ownership checks.
Unexpected broader evidence is not additional consent. Token endpoint and
diagnostic disagreement blocks affected access until resolved; do not choose the
more permissive set. Scope inspection updates grants durably under the connection
lock and invalidates affected caches/confirmations on reductions.

### Refresh and outcomes

Refresh internally when within 60 seconds of recorded access expiry or on a
definite expired-token response, single-flight per connection. Honor finite,
positive `expires_in` from trusted response (bounded to one year); record absolute
expiry from receipt time. Guide's ~one-hour access/~90-day refresh lifetime is
guidance, not proof of a particular token's lifetime. No supplied refresh expiry
means unknown; invalid_grant/removed consent requires reconnect. Reject malformed
responses, ambiguous rotation data, account-prefix changes or expanded consent.
Preserve replacement refresh token only under the reviewed response contract;
an omitted field is not blindly interpreted as unchanged without documented
support. Reverify actual grants from the documented refresh-response `scope`
before resuming; a separately supported diagnostic is optional, never an assumed
dependency of valid refresh responses.

Do not automatically retry code exchange or refresh after timeout/ambiguous
network failure; a one-time code or refresh credential may already have rotated.
Block access, mark uncertain/reconnect-required and offer fresh consent. Rate
limits report bounded retry guidance without automatic credential replay.
Persist rotated credentials atomically before releasing waiters; if storage
fails do not let waiters use stale state. Refresh never expands scopes. Disconnect
and reconnect generations prevent late operations committing old credentials.

Per-operation private dispatch resolves owner/connection, lifecycle, expiry,
verified scopes, capability and resource relationship internally. A valid token
or public ID alone proves no ownership. For shop routes require the shop verified
for that connection; listing/product/receipt/address IDs require an appropriate
authorized relationship read or documented account-scoped lookup before sensitive
access, never an untrusted model assertion. Cache keys include operator,
connection, account and generation. Later endpoint tasks must implement exact
relationship proofs; M3 does not register those private resource tools early.

## 7. Fixed destinations and unchanged development lock

| Purpose | Only permitted destination/operation | Credentials |
| --- | --- | --- |
| Human consent URL | GET `https://www.etsy.com/oauth/connect` | Public client ID/state/challenge; never bearer/shared secret/verifier |
| Exchange/refresh | POST `https://api.etsy.com/v3/public/oauth/token`, form-urlencoded UTF-8 | Required full `x-api-key: <keystring>:<shared_secret>` header; internal code+verifier or refresh token plus keystring client_id in body; matching configured redirect_uri on code exchange |
| Scope inspection | POST `https://openapi.etsy.com/v3/application/scopes`, form-urlencoded `token` | Internal token and required full x-api-key pair, no model raw token |
| Connected identity | GET `https://openapi.etsy.com/v3/application/users/me` | Full x-api-key and exact bearer, requires shops_r |

Use formal refresh grant `refresh_token`, not the guide's erroneous refresh_code
example. Preserve `redirect_uri` equality even where guide now makes it optional.
Do not send full application pair or bearer to consent/callback destinations.
The current authentication guide's formal every-request API-key requirement
governs token exchange/refresh too: send the full application pair only as the
`x-api-key` header to that fixed token endpoint, despite its curl examples omitting
the header. The body `client_id` remains the keystring alone. This is a
source-backed correction, not permission to send the pair to consent/callback.
Revalidate these contracts before implementation; never log the headers/body.

**Unchanged M0.4 contract:** when `ETSY_DEVELOPMENT_MODE=true`, every method other
than GET, HEAD and OPTIONS is rejected, including token exchange, refresh and
tokenScopes POSTs. Apply this captured startup policy to the isolated auth
transport too: fail before credential resolution/injection or network dispatch;
begin reports the prerequisite before issuing an unusable consent flow. No
auth-operation whitelist, extra switch, per-call override, or generic .post/request
escape hatch. A future locked-mode exception is deferred to separate review.

**Current user deployment:** the local lock is OFF. Normal fixed-allowlisted
OAuth transport therefore works under the usual consent, scope, ownership and
authorization rules once implemented and configured; OAuth is not currently
blocked by this lock. Shop Developer Mode being ON does not turn the local lock
on. No further mutation permission is requested or inferred by this design.

The isolated transport validates operation enum, exact origin/path, method,
grant/body keys and content type before dispatch and again at final dispatch;
it does not accept programmable per-call transforms/adapters/interceptors from
MCP input. Test adapters are dependency-injected only in tests and cannot change
allowed operation/destination/method. Preserve TLS verification, redirects off,
environment proxy bypass, credential redaction, ten-second timeout, 1 MiB upstream
body limit, five request starts/second and queue cap 25 shared with API quota
budget. No retry policy inherited blindly from public GETs. Responses are schema-
validated and selected, never returned as raw Axios errors/configs/bodies.

All seller/shop/account-resource mutations remain blocked under the lock,
regardless of granted write scopes, confirmations, annotations, headers, or
arguments. Token exchange/refresh and secret-bearing scope READ diagnostic are
not shop mutations, but their POST methods are deliberately still blocked when
locked. When unlocked, supported mutations must follow existing user permissions,
testing restrictions, scopes/ownership and operation-specific safeguards; lock-off
is not blanket authorization. Never silently change the captured local setting.
The prohibition on `mcp-etsy` mutations remains in force regardless of either mode.

## 8. Callback HTTP security

- Only exact GET `/oauth/etsy/callback`; no status API, generic handler, CORS,
  model-selected redirect, local begin-consent route, assets or third-party code.
  Unknown path 404, wrong method 405; do not exchange on either.
- Request target/query maximum 8 KiB, headers 8 KiB/32 fields, no body/transfer
  encoding for callback GET; five-second header/request timeout, at most ten
  concurrent requests and two concurrent exchanges. Reject overload, do not
  grow unbounded queues. Proxy applies equivalent request bounds/rate limits.
- Strict single decoding and parameter validation: exactly one state and either
  one code or one recognized denial error; never both. Reject duplicate names,
  malformed encoding, unknown parameters, control characters, oversize state/code
  (state exact generated length, code at most 2048 characters). Allow only bounded
  `error_description`/`error_uri` as ignored denial data (2048 characters each),
  never reflected/fetched. State comparison uses constant-time equality for
  equal-length candidates, with bounded map lookup. No code exchange for any
  validation/correlation failure. Valid denial consumes state; malformed attempts
  do not allow attacker-controlled partial updates.
- Cache-Control `no-store`, Referrer-Policy `no-referrer`, Content-Type fixed
  UTF-8 HTML, X-Content-Type-Options `nosniff`, restrictive CSP `default-src 'none';
  frame-ancestors 'none'; base-uri 'none'`. Generic bounded static HTML (<4 KiB)
  with no source errors, codes, state, account labels, links/redirects, scripts,
  analytics or external resources. Success page only says return to local client.
- **Operator prerequisite:** proxy/CDN/backend access logs, traces, APM and error
  reports must disable/redact callback queries before live use. Browser's initial
  callback URL may remain in local history; no-store/no-referrer is not erasure.
  Do not put query strings in operational diagnostics. No raw HTTP/Axios debug
  logging. Optional metrics use only bounded counters/reason enums, never IDs,
  labels, credentials, URL queries or consent URLs.
- Callback is intentionally reachable without proxy login to complete Etsy's
  redirect; one-time state/PKCE protects correlation. TLS/proxy routing and
  network restrictions protect backend access; neither replaces state binding.
  Hosting a callback is exposure to denial of service; bounds and proxy controls
  mitigate it, not promise availability. Bearer/code/verifier are never callback
  response fields or request arguments to MCP tools.

## 9. MCP controls and safe projections

Proposed tools are local orchestrators; no authorization code/secret input. Tool
schema rejects unknown fields. All outputs obey the existing 128 KiB bound and
sanitized `Error:` convention; labels/Etsy text remain untrusted data with the
existing notice when included. Prefer server-generated reason enums over raw
upstream messages. Scope names and IDs are selected nonsecret fields, not token
fragments. No full consent URL in status or errors.

| Tool | Input | Selected outcome |
| --- | --- | --- |
| `begin_etsy_connection` | Reviewed `bundles` enum array (max 9), optional bounded `label`; optional owned `replace_connection_id` for explicit reauthorization | Opaque `connection_id`, pending/expiry, requested scopes, approved consent URL and human action; no state field, code, verifier or credentials |
| `get_etsy_connection_status` | Opaque `connection_id` | State, nonsecret reason, requested/verified granted scopes, enabled capability names, verified account/shop IDs when established, access expiry and reconnect guidance |
| `disconnect_etsy_connection` | Opaque `connection_id`, explicit `confirm_local_disconnect: true` | Disabled/removed or incomplete local-removal outcome; explicitly no upstream-revocation guarantee |
| `get_etsy_token_scopes` | Opaque `connection_id` | Verified scope names/source timestamp or safe verification-required outcome; internally resolved token only |

Lifecycle states: pending → connected, connected_limited (identity verified but
some requested grants absent), denied, expired or failed; durable records may
also be scope_verification_required, reconnect_required, recovery_required, or
disconnected. Connected_limited never permits missing scopes. Pending flow failures
have no usable durable credentials. Scope uncertainty/identity failure blocks all
private dispatch. Status is normally a local read, not an implicit refresh or
connection creation. Diagnostic scope inspection may refresh only under the same
approved lifecycle/transport policy and reports that network work explicitly.

Registry account capability needs trusted OAuth readiness; each handler still
checks connection/scopes/ownership even on direct calls. Public discovery does
not depend on a connected account. Account resource tools expose only supported
configured operations and explain missing scopes safely; a scope bundle is never
a substitute for implementation. Begin and disconnect are state-changing local
operations and are **not** annotated read-only/idempotent merely because they
make no shop mutation; disconnect is destructive to local authorization. Status
is read-only/idempotent. Scope diagnostic is a read-purpose open-world operation
but may refresh/update local grant state; annotate conservatively as not read-only
and not idempotent if that behavior is implemented. Annotations never authorize
consent, local removal, private data reads, or seller writes.

Implementation may add a trusted per-registration availability snapshot to the
existing capability registry, defaulting to available for backward compatibility.
This hides locked/unready begin or unsupported diagnostic controls while known
direct calls fail with a server-authored prerequisite before handlers; local
status/disconnect can remain available. It never overrides capability dependencies,
method lock or authorization, and cannot come from model arguments. Runtime/server
development-mode snapshots must match; injected configuration cannot relax a lock.

## 10. Delivery and acceptance gates

**Dependency ruling:** M3.1 → **M3.3a protected store/config/permissions** → M3.2
secure connect → **M3.3b refresh/lifecycle** → M3.4 → M3.5. M3.3's original scope
is preserved and its parent remains unchecked until both children pass. An
injected store interface may support early isolated tests, but production begin
requires the actual protected durable store. No plaintext or memory-only usable
production connection is an interim deliverable. Detailed numeric tasks and
interfaces: [implementation plan](../plans/2026-10-17-portable-oauth.md).

1. **M3.1 review complete:** user approval, registration and home-server →
   dev-computer topology are recorded. Independent review of finalized
   contracts/plan and the separately implemented/tested ignore prerequisites
   passed; see `TASK.md`. Future work remains unchecked until verified.
2. **Before implementation:** refresh exact official auth/getMe/tokenScopes
   contracts; use documented token-response `scope` for connect/refresh and keep
   only the unresolved tokenScopes diagnostic behind its separate M3.5 gate;
   preserve existing public behavior and user README/AGENTS changes. Add ignored
   workspace/runtime paths before any real provisioning. Do not add unnecessary
   dependencies or Docker packaging under this approval.
3. **M3.2:** mocked PKCE/state/URL/callback tests first: denial, replay, wrong
   session, restart, TTL, malformed/duplicate/large query, port conflict, body,
   concurrency, no secret reflection/logs, wrong redirect, nonloopback bind without
   allowlist, actual untrusted peer despite spoofed forwarded headers, mapped-IP
   normalization and nearest-proxy policy. No live listener
   deployment or account consent inferred from code tests.
4. **M3.3a/b:** storage foundation before connect, refresh after connect; mocked
   crypto/store/key/permission tests first: wrong key, nonce/AAD
   tamper, corrupt/oversize/unknown records, symlink/reparse/hardlink/path escapes,
   ACL denial, missing key, exclusive process collision, no stale-lock guessing,
   interrupted replacement, disk full/sharing violation, unknown refresh outcome,
   rotated persistence, reduced/absent grants and recovery. Exercise Windows
   local NTFS filesystem/ACL and Linux local POSIX permissions before claiming
   both native baselines supported; mocked plus native cross-platform tests do
   not prove Docker packaging, Windows-host bind mounts or network volumes safe.
   Docker local named-volume verification belongs to future authorized packaging.
5. **M3.4–M3.5:** owner/foreign-ID indistinguishability, reconnect account mismatch,
   pending disconnect and late callback/refresh races, status minimization, local
   removal failures, grant reductions, unsupported introspection and hidden-tool
   direct dispatch. Assert one client/transport per process, rejected second
   attachment and same-store process collision; foreign IDs stay unavailable in
   separate isolated instances. Lock tests prove every non-GET/HEAD/OPTIONS request,
   including exchange/refresh/scope POSTs, fails before credentials/network;
   no auth-operation whitelist or transformed method/destination bypass exists.
   With the local lock off, mocked normal allowlisted OAuth flows succeed under
   the same consent/scope/ownership rules. Synthetic credential canaries never appear in
   tool results, callbacks, logs or errors.
6. **Release:** run project build/tests/audit under supported Node versions,
   independent security review, update setup/safety/planned/current docs and
   user-facing release notes only for verified shipped behavior. Record supported
   filesystem/runtime assumptions and manual recovery procedure. No automatic
   publish/deployment. Future Docker smoke checks require separate packaging
   authorization; until then say compatible design, not a tested Docker release.

### Manual operator setup before live OAuth use

- Provision/protect the independent key and data root; prove ACL/modes and no
  tracked secrets. Back up key separately. Configure trusted operator namespace,
  correct app identity and OAuth settings; preserve the user's local-lock-off
  configuration rather than adding an auth-POST exception setting.
- **Completed operator action:** registered exactly
  `https://www.methejuggler.com/oauth/etsy/callback` with the intended Etsy
  application for this deployment. Exact HTTPS URI, no
  wildcard/extra slash. The user has confirmed registration in the Etsy developer
  portal; that completed operator action need not be repeated and is not
  independently verified by a live authorization attempt.
- Route proxy path unchanged to the approved backend on port 3001, terminate
  valid external TLS, restrict backend reachability, redact query logging across
  all proxy/CDN/APM layers, and apply bounds. Current proxy is on the home server,
  backend on the dev computer: explicitly set LAN bind and actual peer allowlist,
  protect the LAN/tunnel and restrict firewall before enabling. Future container
  setup must account for actual nearest-proxy/bridge socket IPs.
- Check port availability, native/container permission behavior, backend routing
  and listener startup with separately authorized nonsecret diagnostics first.
  These are prerequisites, **not completed checks** in this design.
- Human completes browser Etsy consent after setup; existing own-shop isolated
  testing permission does not replace that consent and need not be requested
  again. Any later supported tests stay within that permission and Etsy testing
  restrictions (draft/test-labelled low-price listings where applicable, cleanup,
  no purchases or effects on others), with no mutations through `mcp-etsy`.
  No live test, deployment or credential submission occurs in this design task.

### Resolved operator choices and remaining verification

User approval, exact registered callback, port 3001 and home-server proxy → dev-
computer topology are resolved; do not re-ask. Future dev-container placement on
the home server is recorded without authorizing packaging/deployment. Existing
own-shop testing permission remains distinct from browser consent; no auth-POST
exception is needed or approved. Local lock remains off and conservative if
enabled later. Live callback reachability remains untested.

Operator filesystem paths/key values stay out of this conversation and can be
supplied as trusted local configuration later. Exact diagnostic scope response
shape is a separate M3.5 gate, not a blocker for documented token-response-scope
connections. Platform crash/ACL behavior, helper review, ignore rules and actual
protected proxy setup remain implementation/release prerequisites, not
additional unresolved architecture choices or claims that live OAuth works.
