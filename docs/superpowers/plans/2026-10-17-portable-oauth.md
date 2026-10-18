# Portable OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` for this authorized execution method. Implement task-by-task; steps use checkbox (`- [ ]`) syntax. Implementation: GPT-6 Luna / Maximum; independent planning/review: GPT-6.1 Sol / Medium. Resolve exact model/variant IDs before dispatch per `AGENTS.md`; no silent substitution. Review before coordinator commits, not implementer commits.

**Goal:** Deliver the M3 protected single-operator OAuth lifecycle without weakening public access or M0.4.

**Architecture:** Keep stdio and the current public handlers. Add a protected store before a usable connection, a fixed-operation OAuth transport sharing the request budget, and one bounded callback listener accepting only trusted socket peers. Actual token-response scopes establish grants; the undocumented diagnostic parser is independently gated.

**Tech Stack:** Node.js 22/24, TypeScript strict/ES modules, Node crypto/fs/http/net/child_process, existing Axios/MCP SDK and Node test runner; no new vault dependency.

**Spec:** [User-approved design](../specs/2026-10-17-portable-oauth-design.md), [OAuth contracts](../../planned-oauth-and-accounts.md), [M0.1](../../contracts/README.md#account-callback-and-token-contracts).

## Global Constraints

- Read root/nested AGENTS, README, docs/index and task-relevant contracts before work and after compaction; recheck git status. Preserve user README/AGENTS changes.
- User approved proceeding; no additional execution-method/design/permission/hostname/registration questions. Home-server proxy → dev computer now; home-server dev container later; exact registered HTTPS callback `/oauth/etsy/callback`, backend 3001.
- Operator supplies actual numeric LAN bind and exact trusted proxy IPs locally; never ask for secrets/IPs in chat, change firewall/proxy, or deploy automatically.
- Windows local NTFS and Linux local POSIX baseline; future Docker local named volume. Windows-host Docker bind mounts/network volumes unsupported unless separately verified. No Docker packaging in these tasks.
- One operator/client/transport per process; OS/container/store/key isolation for less-trusted clients. Namespace/client labels do not authenticate tenants.
- Local `ETSY_DEVELOPMENT_MODE` is OFF; Etsy SHOP Developer Mode ON is separate, not a sandbox. If local lock enabled, all non-GET/HEAD/OPTIONS including auth POSTs fail before credentials/network. No exception, extra switch or per-call bypass.
- Existing temporary own-shop test permission remains subject to testing restrictions; no purchases/effects on others, no mutating `mcp-etsy` calls. These implementation tests use mocks/synthetic credentials only; browser consent/setup remain human actions.
- TLS verification, redirect blocking, environment proxies off; HTTP attempts 10 seconds, upstream 1 MiB, tool JSON 128 KiB; request starts at least 200 ms apart, queue cap 25 across data/auth clients for the configured application.
- Tokens/codes/verifiers/key/shared secret never in MCP/log/error output; authorization URL alone may contain state/public challenge. Paths/labels/foreign IDs never become arbitrary filesystem/network access.
- Encrypted store: separate operator-supplied 32-byte key, AES-256-GCM, fresh 12-byte nonce/16-byte tag per encryption, nested AAD per spec; no plaintext fallback or auto-reset.
- Never register unusable tools or report connected before verified scope/identity AND durable protected commit. No broadened write/private-resource surface; actual resource handlers remain M4+.

## Review Focus

- Remote proxy with spoofed forwarded headers: actual normalized socket peer, not headers, must authorize callback ingress (Task 3).
- Wrong key, insecure fresh directory, orphan temporary or process collision: fail closed without reading secret bytes/resetting live data (Task 2).
- Token rotated but disk commit fails/timeout ambiguous: no stale token reuse or blind POST retry (Task 4).
- Disconnect racing callback/refresh and another client's ID: no resurrection or foreign-state disclosure (Task 5).
- Missing diagnostic schema despite valid documented token-response scope: preserve usable verified connections while gating only diagnostic parsing (Tasks 3/6).

---

## Dependency ruling and focused files

**M3.1 → M3.3a → M3.2 → M3.3b → M3.4 → M3.5a/b.** M3.3 parent completes only after a+b; M3.5 parent only after authorization core AND supported diagnostic. This preserves backlog scope while forbidding a memory-only/plaintext production connection. Injected stores are test-only; production uses Task 2.

| Files | Responsibility / owning task |
| --- | --- |
| `.gitignore`, `.dockerignore`, `test/oauth-ignore.test.js` | Recursive runtime/secret exclusions; Task 1, separate implementation role |
| `src/oauth/types.ts`, `config.ts`, `permissions.ts`, `store.ts` | Trusted types/config, platform checks, locked encrypted snapshots; Task 2 |
| `src/request-limiter.ts`, `src/etsy-client.ts` | Small compatible extraction of existing limiter; Task 3 |
| `src/oauth/transport.ts`, `callback.ts`, `service.ts`, `runtime.ts`, `tools.ts` | Fixed network ops, ingress, lifecycle, startup/cleanup, registration; Task 3, extended 4–6 |
| `src/oauth/authorization.ts`, `scopes.ts` | Operation guard and documented evidence/diagnostic parsing; Task 6 (evidence function first introduced Task 3) |
| `src/index.ts` | Optional trusted runtime/limiter injection, one transport, lifecycle startup/close; Task 3/5 |
| `src/capabilities.ts` | Optional trusted per-registration readiness gate, preserving group/method guards; Task 3 |
| `test/helpers/oauth.js` | Synthetic records/config/store/clock/transport fixtures; Task 2 then extend per owning task |
| `test/oauth-{config,permissions,store,transport,callback,connection,refresh,status,authorization,scopes}.test.js`, `test/request-limiter.test.js` | Focused mocked/synthetic tests per task |

`build/` is generated, never edited. Use existing `test/helpers/mcp.js` (`withMcp`, `mockAdapter`, `successResponse`, `jsonText`, `syntheticKey`) and optional factory injection; avoid rewriting public mappings. Documentation changes when verified: planned OAuth, setup/safety and matching TASK/TODO/matrix; README/changelog only actual user-facing shipped behavior, preserving user work.

### Task 1: M3.1 contract and ignore prerequisites

**Files:** finalize this plan/spec, `docs/planned-oauth-and-accounts.md`, `docs/index.md`, `TASK.md`; implementation role modifies `.gitignore`, creates `.dockerignore`, `test/oauth-ignore.test.js`.

**Interfaces:** consumes the approved design; produces recursive `**/.etsy-mcp/` and `**/.etsy-mcp-secrets/` exclusions in Git AND build context, without untracking/deleting user files. No runtime files/secrets are created by this task. Name the root/nested cases `runtime and key directories are recursively excluded`; assertions include `assert.equal(checkIgnoreExitCode, 0)` and matching rule text in both ignore files, not existence of real key files.

- [ ] **Step 1: Add failing ignore-contract tests** for both root/nested directories and `connections.enc`, lock/temp/backup/key descendants. Use `git check-ignore --no-index -v --stdin` with synthetic nonexistent paths; assert each is ignored and corresponding recursive rules exist in `.dockerignore`. Assert no actual runtime/secret files appear in `git ls-files`; tests never print real contents/paths. Preserve pre-existing exclusions.
- [ ] **Step 2: Run RED:** `node --test test/oauth-ignore.test.js`. Expected: fails only on missing exclusions/dockerignore (not a module/build/network failure).
- [ ] **Step 3: Implement exclusions** in `.gitignore`/`.dockerignore`, not Docker packaging. Do not add `.superpowers` work artifacts to commits or create data/key files to prove ignoring works.
- [ ] **Step 4: Verify GREEN:** `node --test test/oauth-ignore.test.js` then `git check-ignore -v .etsy-mcp/connections.enc nested/.etsy-mcp-secrets/key.bin`. Expected: tests pass and both paths match exclusions. Inspect `git ls-files` locally; no tracked runtime credentials.
- [ ] **Step 5: Independent Sol/Medium review** of finalized docs + separate Luna/Maximum ignore implementation; coordinator checks only intended diff. Then coordinator may commit explicit reviewed paths with message `docs: approve portable OAuth deployment contract`. Do not mark M3.1 done before review/evidence; no future checkboxes complete.

### Task 2: M3.3a protected configuration/store foundation BEFORE connect

**Files:** create `src/oauth/types.ts`, `config.ts`, `permissions.ts`, `store.ts`; create `test/helpers/oauth.js`, `test/oauth-config.test.js`, `test/oauth-permissions.test.js`, `test/oauth-store.test.js`. No registration/startup listener yet.

**Interfaces (internal, never MCP inputs/outputs):**

```ts
// types.ts; all scopes are bounded validated strings; aliases are not authorization.
type Scope = string;
type OwnerContext = Readonly<{ operatorId: string; appFingerprint: string }>;
type ScopeEvidence = Readonly<{ scopes: readonly Scope[];
  source: 'authorization_code_response' | 'refresh_response' | 'diagnostic'; checkedAt: number }>;
type ConnectionState = 'connected' | 'connected_limited' | 'scope_verification_required'
  | 'reconnect_required' | 'recovery_required';
interface ConnectionRecord {
  connectionId: string; owner: OwnerContext; accountId: number; shopId?: number;
  generation: number; label?: string; state: ConnectionState; reason?: string;
  accessToken: string; refreshToken: string; issuedAt: number; expiresAt: number;
  requestedScopes: readonly Scope[]; grants: ScopeEvidence;
}
interface ConnectionStore {
  read(id: string): Promise<ConnectionRecord | undefined>;
  put(record: ConnectionRecord, expectedGeneration: number | null): Promise<void>;
  remove(id: string, expectedGeneration: number): Promise<void>;
  close(): Promise<void>;
}
// null = new record only; all read/put/remove implicitly validate configured owner.
// config.ts
interface OAuthConfig {
  owner: OwnerContext; dataDir: string; keyFile: string; redirectUri: string;
  callbackHost: string; callbackPort: number; trustedProxyIps: readonly string[];
  developmentMode: boolean;
}
type OAuthSettings = { enabled: false } | { enabled: true; config: OAuthConfig };
parseOAuthConfig(env: NodeJS.ProcessEnv, developmentMode: boolean): OAuthSettings;
normalizePeerIp(value: string): string; // numeric only, mapped IPv4 normalized
// permissions.ts
verifyStoragePermissions(config: OAuthConfig): Promise<void>;
// store.ts
openConnectionStore(config: OAuthConfig): Promise<ConnectionStore>;
```

Use `ConnectionState` only for durable candidates; pending/denied/expired/failed/disconnected are service status states, not fabricated token records. Token-missing-scope candidates need not be persisted; refuse positive completion. App fingerprint derives from trusted keystring, never model metadata. Times are bounded epoch milliseconds; counters positive safe integers. Define `OAuthError` in types with bounded fixed `reason` enum/message, no raw cause/path/credentials; extend that enum only with reviewed safe outcomes. Helpers produce synthetics matching these exact types, using approved `%LOCALAPPDATA%\Temp\opencode` on Windows, `os.tmpdir()` on Linux; own unique fixture subdirectory only, without printing resolved user paths.

- [ ] **Step 1: Write config/permission RED tests:** name primary cases `nonloopback bind requires exact trusted peers` and `unsafe storage fails before reading key bytes`. Assert `assert.throws(() => parseOAuthConfig(nonloopbackWithoutPeers, false))`, `assert.equal(normalizePeerIp('::ffff:192.0.2.10'), '192.0.2.10')` and zero instrumented key-read calls on unsafe paths. Disabled config touches no files/helper; strict booleans, required owner/key/HTTPS exact callback; no default personal domain; numeric bind and 1–16 exact proxy IPs for nonloopback; reject DNS/CIDR/wildcard/zone/invalid lists. Key inside canonical data root, network filesystem, unsafe ancestor/link/reparse/hardlink/nonregular target fail before key-byte read; missing key never creates one. Assert sanitized failures omit synthetic path/key canaries.
- [ ] **Step 2: Run RED:** `npm run build` then `node --test test/oauth-config.test.js test/oauth-permissions.test.js`. Expected: new tests fail for absent exports/modules or specified assertions, existing build remains healthy; no false RED from missing fixtures. Add type-only interfaces as necessary to isolate behavioral RED.
- [ ] **Step 3: Implement config + permission functions** with Node builtins and fixed internal PowerShell ACL/SID inspection (`execFile`, fixed script text, paths via data not interpolation, bounded stdout/time, no model command). Restrictive creation permissions precede ciphertext/secret bytes. Runtime verifies user/SYSTEM/Administrators ACLs on local NTFS, POSIX owner/modes; inability is explicit fail-closed platform blocker. Reject unsupported in-place/fresh-store layouts; no repair/reset of unknown files.
- [ ] **Step 4: Write store RED tests:** name primary cases `authenticated store round trips without plaintext writes` and `failed replacement preserves committed snapshot`. After put/close/reopen, `assert.deepEqual(await reopened.read(record.connectionId), record)`; captured raw writes must satisfy `assert.equal(bytes.includes(record.accessToken), false)`. Test unique nonces, outer+record metadata/AAD tamper, wrong key/corruption/version/oversize, 100-record/4 MiB encrypted/2 MiB decrypted caps, token 16 KiB. Exclusive owner collision fails, no stale-lock guessing; generation CAS rejects lost writes/deletes. Fault-inject temp write/fsync/atomic replace/sharing violations and orphan temp startup; no unlink-live fallback or auto-promote. Backup restore guidance requires fresh consent; no automatic history/key generation. Assert bytes remain untouched after wrong key/corrupt file.
- [ ] **Step 5: Run RED:** `npm run build` then `node --test test/oauth-store.test.js`. Expected: new behavior fails before store implementation; no Etsy requests.
- [ ] **Step 6: Implement open/read/put/remove/close** using spec nested AES-256-GCM/AAD envelopes, snapshot mutex plus generation checks, protected exclusive owner lock, same-directory exclusive ciphertext temp + flush/atomic replace; directory flush where supported. Persist app identity/owner binding. Unknown data, corrupt ciphertext and wrong key are recovery failures, never empty-store initialization. Fixed filenames only. Close releases only this process's owned lock after pending commits; no broad cleanup.
- [ ] **Step 7: Verify GREEN:** `npm run build` then `node --test test/oauth-config.test.js test/oauth-permissions.test.js test/oauth-store.test.js`. Expected: pass; native Windows ACL capability must actually run or report concrete blocker, not silently skip and claim support. Linux permission/atomic-replacement suite must run on native Linux before asserting that baseline; Docker remains untested future packaging.
- [ ] **Step 8: Independent review before coordinator commit** (`feat: add protected OAuth connection store`). Record platform/fault evidence and ignored fixture checks. Keep M3.3 parent unchecked; only M3.3a can gain verified evidence. No connection tool is shippable yet.

### Task 3: M3.2 fixed transport, PKCE, trusted callback and durable connect

**Status: complete (2026-10-17).** Independent source/docs review approved after
three core fix rounds and separate shared-limiter integration fixes (final
dispatch policy rechecks and reentrant queue ownership). Coordinator final
`npm test` includes build: Windows Node24 313 total/312 passed/0 failed/1
Linux-only skip; native Linux Node22 313 total/304 passed/0 failed/9 Windows-only
skips, including the real child SIGTERM test. Production audit: 0 vulnerabilities;
contract audit: 105/105; scoped whitespace clean. See [M3.2 evidence in TASK.md](../../../TASK.md#m3--oauth-and-account-connections)
and its Task 3/platform/limiter reports. The steps below retain the original
execution checklist; current completion is tracked in `TASK.md`. Task 3 was
committed as `217325c`. Task 4's M3.3b internal refresh and parent M3.3 are
complete after independent review and final coordinator verification; Task 5 is
also complete as recorded below; Task 6's M3.5a core is complete after independent
review and coordinator Windows/native-Linux verification, while M3.5b is blocked
by the undocumented diagnostic response shape. No Docker, deployed callback/proxy,
or live consent verification is claimed.

**Files:** create `src/request-limiter.ts`, `src/oauth/transport.ts`, `callback.ts`, `service.ts`, `runtime.ts`, `tools.ts`, `scopes.ts`; modify `src/etsy-client.ts:101-123,226-249`, `src/index.ts:1720-1763,1858-1903`, `src/capabilities.ts:28-39,91-125`; tests `test/request-limiter.test.js`, `test/oauth-transport.test.js`, `test/oauth-callback.test.js`, `test/oauth-connection.test.js`, extend `test/capabilities.test.js`, `test/helpers/oauth.js`. Consume Task 2 store/config/types and existing capability registry, validation/response helpers.

**Interfaces:**

```ts
// request-limiter.ts; extract existing interval/queue behavior without other requester refactor.
type RequestLimiter = () => Promise<void>;
createRequestLimiter(deps?: { now: () => number; sleep: (ms: number) => Promise<void> }): RequestLimiter;
// Throw RequestQueueFullError, mapped to existing EtsyApiError('busy', ...) by data requester.
// etsy-client.ts: backward-compatible optional limiter; default remains private per requester.
createEtsyRequester(client: AxiosInstance, options?: { limiter?: RequestLimiter }): { get(path: string, params?: EtsyQuery): Promise<unknown> };
// scopes.ts
parseGrantedScopes(value: unknown, source: ScopeEvidence['source'], checkedAt: number): ScopeEvidence;
// transport.ts, results remain private, never MCP-serialized
interface TokenResult { accessToken: string; refreshToken: string; expiresIn: number; grants: ScopeEvidence }
interface OAuthTransport {
  exchange(input: { code: string; verifier: string }): Promise<TokenResult>;
  refresh(refreshToken: string): Promise<TokenResult>;
  getMe(accessToken: string): Promise<{ accountId: number; shopId?: number }>;
}
createOAuthTransport(config: OAuthConfig, apiKey: string, limiter: RequestLimiter): OAuthTransport;
// service.ts; these aliases/interfaces are exported internally here.
type Bundle = 'catalog_read' | 'shop_read' | 'financial_read' | 'profile_read' | 'address_read'
  | 'listing_write' | 'listing_delete' | 'shop_write' | 'fulfillment_write';
interface BeginInput { bundles: readonly Bundle[]; label?: string; replaceConnectionId?: string }
interface BeginResult { connection_id: string; state: 'pending'; expires_at: number;
  requested_scopes: readonly Scope[]; authorization_url: string; human_action: string }
type CallbackInput = { state: string; code: string } | { state: string; denied: true };
type CallbackOutcome = 'complete' | 'denied' | 'failed';
interface OAuthService {
  readonly beginAvailable: boolean; // trusted startup lock/readiness, never model-supplied
  begin(input: BeginInput): Promise<BeginResult>;
  completeCallback(input: CallbackInput): Promise<CallbackOutcome>;
  close(): Promise<void>;
}
createOAuthService(config: OAuthConfig, store: ConnectionStore, transport: OAuthTransport,
  deps?: { now: () => number; randomBytes: (size: number) => Buffer }): OAuthService;
// callback.ts
interface CallbackHandle { close(): Promise<void> }
startCallbackServer(config: OAuthConfig, complete: OAuthService['completeCallback']): Promise<CallbackHandle>;
// runtime.ts: sole production composition/start/cleanup path; closes store on bind failure.
interface OAuthRuntime { readonly developmentMode: boolean; service: OAuthService; close(): Promise<void> }
startOAuthRuntime(config: OAuthConfig, apiKey: string, limiter: RequestLimiter): Promise<OAuthRuntime>;
// tools.ts: stage parameter is internal composition config, not caller-controlled.
createOAuthRegistrations(service: OAuthService, stage: 'connect' | 'lifecycle'): CapabilityRegistration[];
```

M3.2 minimally extends the consumed protected `ConnectionStore` with an
owner-bound `markRecoveryRequired(): Promise<void>` operation. If a late commit's
compensating remove/restore fails, the store persists the fixed nonsecret recovery
marker described in the design before its owner lock can be released. Ordinary
reopen checks the marker before key bytes; if marker persistence/verification
fails, `close()` retains the ownership lock. No model-facing filesystem operation,
automatic clear/reset, or stale-lock-as-consent recovery is permitted.

`startOAuthRuntime` opens real store, constructs transport/service, binds callback, and returns only after ready. Tests use constructed service/injected synthetic store/transport and handler/request fixtures; no LAN/public bind. Add trusted factory options `oauth?: OAuthRuntime`, `limiter?: RequestLimiter` to `createEtsyMcpServer` while preserving `now`/developmentMode and sync factory return; reject runtime/server mode mismatch, never use runtime injection as lock override. `main` creates one limiter for both clients, awaits optional runtime before registration, closes runtime on stdio close/start failure. No asynchronous file/key work hidden inside existing public factory. `safeToolError` recognizes only safe OAuthError messages, never raw Axios/fs/helper failures.

For unavailable-but-known controls add optional trusted `available?: boolean` and `prerequisite?: string` to CapabilityRegistration; default true preserves all existing tools. Registry copies these at register time, omits false entries from listTools and denies direct dispatch before handlers with `ToolPrerequisiteError` (server-authored bounded message only). Group/dependency/write-lock checks stay independent and cannot be weakened by this field. Begin registration uses service.beginAvailable; locked begin is undiscoverable but direct calls explain the prerequisite. Diagnostic registration later uses the same gate; local status/disconnect need not disappear merely because POSTs are locked.

- [ ] **Step 1: Write limiter compatibility RED tests:** mixed public/auth request starts ≥200 ms apart, pending 26th rejected at cap 25, fake clock shared, each public retry consumes a slot. Existing default requester and short GET retry behavior remain unchanged. Run `npm run build` then `node --test test/request-limiter.test.js test/security.test.js`. Expected new assertions RED, existing security tests unchanged.
- [ ] **Step 2: Extract/export limiter** and add optional injection; do not change development-mode guard or expose generic POST through data requester. Map queue failures to existing safe busy outcome. Run same command; Expected GREEN.
- [ ] **Step 3: Write transport/evidence RED tests:** exact token URL/form/headers including full x-api-key, keystring client_id only; exact getMe route; full bearer prefix preserved and identity matched later. TLS/proxy/redirect/10s/1 MiB bounds; valid actual `scope` grants accepted, requested set never substituted, missing/invalid scope fails safe. With local lock ON, exchange/refresh reject before assembling credential headers/body or calling adapters; begin/refresh orchestration checks policy before resolving stored credentials. OFF permits only fixed operations. No redirect/timeout/ambiguous-POST retries, no extra switch. Run `npm run build` then `node --test test/oauth-transport.test.js`. Expected failing new assertions.
- [ ] **Step 4: Implement transport and parseGrantedScopes** using closed private operation dispatch, fixed destinations/content types and safe OAuthError categories; maintain final method/destination checks. TokenResult requires documented scope, positive bounded expiresIn and complete valid token fields; no diagnostic call needed. Retain full API pair only on approved API endpoints, never consent/callback. Test-only low-level adapters must not alter policy. Run Step 3 command; Expected GREEN.
- [ ] **Step 5: Write callback/service RED tests:** name primary cases `spoofed forwarding headers cannot authorize actual socket peer` and `connection is complete only after protected commit`. Assert `assert.equal(exchangeCalls.length, 0)` for untrusted peers/replayed states; pending store-put promise keeps callback completion unresolved, and rejected put yields `assert.equal(outcome, 'failed')`. PKCE 43-character verifier/S256, 32-byte state, opaque ≥128-bit request ID separate from state; pending max 10/TTL 300000 ms, restart expires. Exact HTTPS URL constructed only from config; current LAN bind requires exact proxy list. Actual `remoteAddress` checked before query/state access, mapped peer normalized; forged forwarded headers do not help. Reject wrong path/method/body/duplicate/bad encoding/unknown/8 KiB-overflow query, 8 KiB/32 header limits, expiry/replay/foreign context/denial; deny consumes state. Assert 5s ingress timeout, 10 requests/2 exchanges concurrency, static HTML <4 KiB, no-store/no-referrer/CSP, no secret/error reflection. Run `npm run build` then `node --test test/oauth-callback.test.js test/oauth-connection.test.js`. Expected new RED assertions.
- [ ] **Step 6: Implement callback/service/runtime/tools and readiness gate** with internal owner/session/boot binding; connection IDs are 16 CSPRNG bytes base64url (22 characters), state/verifier each 32 bytes base64url (43 characters). Consume pending state before one exchange, require shops_r + prefix/getMe identity + protected store commit before complete. If a late committed write cannot be compensated, require the protected store's persistent recovery fence before lock release; failed marker persistence retains the lock, and reopen checks the fence before key bytes. Install SIGINT/SIGTERM handlers before OAuth resource startup and route them, stdin EOF/close, and transport close through one idempotent drain; signal shutdown waits for startup handoff, closes runtime/callback/store and stdio transport, then exits with the conventional signal status. Test controlled startup-time signal delivery and a real child signal on supported platforms. No store readiness/bind success means no begin discovery; disabled OAuth is public-only without key access. Failed reconnect never overwrites old good credentials; account mismatch requires distinct explicitly requested connection. Write bundles rejected until owning future feature enabled. Bind conflict fails startup/no fallback. Register begin in account group with state-changing annotations and trusted availability; false readiness hides it and direct dispatch denies before handler, without affecting existing 29 public tools or write lock. Test these registry paths and runtime mode mismatch. All HTTP peer/query errors are bounded generic responses, never forwarded URLs.
- [ ] **Step 7: Verify GREEN/integration:** `npm run build` then `node --test test/request-limiter.test.js test/oauth-transport.test.js test/oauth-callback.test.js test/oauth-connection.test.js test/development-mode.test.js test/capabilities.test.js`. Expected all pass; mocked successful connection has durable encrypted record, validated actual scope and getMe account; disk/identity/scope failure never reports connected. Run `npm test`; Expected all old/new tests pass, no live Etsy calls.
- [ ] **Step 8: Independent review before coordinator commit** (`feat: complete durable Etsy OAuth authorization`). Audit actual peer validation order, quotas, credential destination isolation, callback logs and cleanup. Record M3.2 evidence only after review; no claim proxy/listener deployment/live account tested.

### Task 4: M3.3b refresh, rotation and lifecycle concurrency

**Status: complete, committed as `d8eb5c3` (2026-10-17).** Independent
security/spec/quality review `ses_eb3a75465ffecKteduC8wXYx6m` approved after one
fix round (short-expiry single-flight and post-commit/queued-work expiry).
Coordinator final build/test: Windows336 total/335 pass/0 fail/1 Linux-only skip;
native Linux336 total/327 pass/0 fail/9 Windows-only skips, including real SIGTERM.
Production audit0, contracts105/105, scoped whitespace clean. Both M3.3a and b
are verified, so parent M3.3 is complete; full M3 is not. See the
[Task 4 report](../../../.superpowers/sdd/2026-10-17-portable-oauth/task-4-report.md)
and [TASK.md](../../../TASK.md#m3--oauth-and-account-connections). Refresh is
internal only; no current MCP/private handler invokes it. The original execution
checklist below is retained as historical procedure. Task 5 completion is recorded
below; Task 6b, live consent, callback/proxy deployment, and Docker verification
remain outstanding.

**Files:** extend `src/oauth/service.ts`, `types.ts` only if safe reason enums needed; create `test/oauth-refresh.test.js`, extend `test/helpers/oauth.js`.

**Interfaces:** consume store CAS and transport.refresh; extend OAuthService with `ensureFresh(connectionId: string): Promise<ConnectionRecord>` (strictly internal). Add `withConnection<T>(connectionId: string, work: (record: ConnectionRecord) => Promise<T>): Promise<T>` for serialized lifecycle use; callbacks must not reenter the same lock. Service owns per-connection mutex/single-flight and blocked-generation set; full-store serialization remains store responsibility. Failed durable updates block that generation in memory before returning any safe error.

- [ ] **Step 1: Write RED tests:** name `refresh is single flight and waits for durable rotation` and `uncertain refresh never replays or reuses stale token`. Assert `assert.equal(refreshCalls.length, 1)` for concurrent ensureFresh calls and `assert.rejects(service.ensureFresh(id))` after failed rotation commit. Access expiry ≤60000 ms triggers refresh; returned actual scope reduction applied before waiters, account prefix unchanged, refresh replacement durably saved before release. Invalid/missing refresh data/scope, invalid_grant, 429, timeout/ambiguous response and disk-full after rotation block access, no blind retry/stale fallback. Pending reconnect and refresh CAS cannot overwrite newer generation; foreign owner/IDs never resolve. Assert no diagnostic dependency and no raw secret leakage.
- [ ] **Step 2: Run RED:** `npm run build` then `node --test test/oauth-refresh.test.js`. Expected new behavior assertions fail.
- [ ] **Step 3: Implement ensureFresh/withConnection** using injected clock and per-connection single-flight; actual response expiry is authoritative. Hold serialization through refresh/verify/commit; if missing fresh scope then verification-required, not old grants. No second POST after uncertain outcome; safe reconnect/recovery guidance. Account switching invalidates associated private cache/confirmation references (no fabricated M4 cache implementation).
- [ ] **Step 4: Verify GREEN:** `npm run build` then `node --test test/oauth-refresh.test.js test/oauth-store.test.js test/oauth-connection.test.js test/oauth-transport.test.js`. Expected pass, one refresh request for concurrent waiters, no callback resurrection/disk rollback masked as success.
- [ ] **Step 5: Independent review before coordinator commit** (`feat: refresh protected Etsy connections safely`). Only then complete M3.3b and parent M3.3 with evidence of both a+b; record concrete platform blockers rather than broad support claims.

### Task 5: M3.4 local status/disconnect and supported stdio isolation

**Status: complete, committed as `5ad835c` (2026-10-17).** Independent security/spec/quality review `ses_eb35f82c6ffeSRYQvy4iop24KC` approved after two fix rounds covering four post-await lifecycle races and stale status after terminal expiry/eviction. Coordinator final `npm test` (includes build): Windows354 total/353 pass/0 fail/1 Linux-only skip; native Linux354 total/345 pass/0 fail/9 Windows-only skips, including real child SIGTERM. Production audit0/contracts105/105/scoped whitespace clean (TASK.md CRLF warning only). Exact logs, historical RED/failure evidence, and limits are in the [Task 5 report](../../../.superpowers/sdd/2026-10-17-portable-oauth/task-5-report.md). M3.5/M4+ and overall M3 acceptance remain open. No live consent, callback/proxy deployment, or Docker verification is claimed.

**Files:** extend `src/oauth/service.ts`, `tools.ts`, `runtime.ts`, `src/index.ts` startup/close/transport ownership; create `test/oauth-status.test.js`, extend `test/oauth-connection.test.js`.

**Interfaces:** export `ConnectionStatus` from service with allowlisted fields only: `connection_id`, `state` (durable states plus pending/denied/expired/failed/disconnected), optional `reason`, `requested_scopes`, `granted_scopes`, `enabled_capabilities`, `account_id`, `shop_id`, `expires_at`, `reconnect_guidance`; no credentials or URL. Extend OAuthService `status(id: string): Promise<ConnectionStatus>`, `disconnect(id: string): Promise<{ connection_id: string; state: 'disconnected' | 'recovery_required'; local_credentials_removed: boolean; upstream_revoked: false }>`; runtime projection excludes invalid/unknown fields. ID validation accepts `^[A-Za-z0-9_-]{22}$` only, foreign IDs return same unavailable error. Bound terminal pending-status entries to 100 and five-minute retention.

- [x] **Step 1: Write RED tests** named `status omits credentials without refreshing`, `disconnect cannot be resurrected by late refresh` and `second transport and foreign connections are denied`, with `withMcp` factory closure injecting synthetic runtime. Assert `assert.equal(refreshCalls.length, 0)` for status and `assert.equal(disconnected.upstream_revoked, false)`; raw serialized output must not include synthetic token canaries. Status is local, exact projection ≤128 KiB, unknown fields/raw tokens denied. Disconnect requires tool `confirm_local_disconnect: true`, disables dispatch immediately, consumes matching pending flow, serializes durable removal; failure reports incomplete removal while runtime stays disabled. Late callback/refresh cannot recreate it; second removal is safe without false upstream revocation. Register lifecycle tools only when available, hidden direct calls fail. A second transport attachment to a server instance is rejected before dispatch; separated store/operator foreign IDs unavailable; shared-store process collision still fails. Fake model name/namespace cannot change trusted context.
- [x] **Step 2: Run RED:** `npm run build` then `node --test test/oauth-status.test.js test/oauth-connection.test.js`. Expected new assertions fail; public factory behavior stable.
- [x] **Step 3: Implement projections/disconnect and registrations**: begin false/false/false/true annotations; status true/false/true/false; disconnect false/true/true/false (readOnly/destructive/idempotent/openWorld order). Bounded label/third-party text uses existing notice. Preserve one actual supported stdio transport per process using a one-attachment guard around server.connect, not invented MCP client authentication. Close consumes pending work and closes listener/store; no new listener on reconnect. No per-client supplied identity selector.
- [x] **Step 4: Verify GREEN:** `npm run build` then `node --test test/oauth-status.test.js test/oauth-connection.test.js test/oauth-refresh.test.js test/capabilities.test.js test/mcp-contracts.test.js`. Expected all pass, disconnect failure explicit, no secret canaries in MCP/errors/HTML/log capture; public-only discovery retains 29 tools.
- [x] **Step 5: Independent review before coordinator commit** (`feat: inspect and disconnect local Etsy connections`). Update only verified current setup/safety/tool docs, retain upstream revocation caveat. M3.4 evidence must include late-write races, disabled/foreign direct dispatch and no multi-tenant claim.

### Task 6: M3.5a operation authorization; M3.5b separately gated diagnostic

**Status (2026-10-17): M3.5a complete; core-only coordinator commit pending.** Independent security/spec/quality review `ses_eb31bb0fbffeIuVzfd3ngoeUOB` approved after one dispatch-coverage fix round. Coordinator fresh Windows Node24 verification: 370 total/369 pass/0 fail/1 Linux-only skip; native Linux Node22.23.3: 370 total/361 pass/0 fail/9 Windows-only skips, including real child SIGTERM. Production audit0/contracts105/105. Exact evidence and historical limitations are in the [Task 6 report](../../../.superpowers/sdd/2026-10-17-portable-oauth/task-6-report.md). **M3.5b remains blocked by the empty official `Scopes` response contract, not operator permission; parent M3.5 and overall M3 remain open.** No M4+ private handler, diagnostic parser/HTTP call, live consent, callback/proxy deployment, or Docker verification is claimed. The scope-array whitespace-element Minor is unchanged and deferred to final OAuth review.

**Files:** create `src/oauth/authorization.ts`; extend `scopes.ts`, `service.ts`, `transport.ts`, `tools.ts`; create `test/oauth-authorization.test.js`, `test/oauth-scopes.test.js`. Update exact diagnostic provenance in `docs/contracts/README.md` only after public official contract research, not guessed keys; leave pinned OpenAPI/checksum unchanged unless separately regenerated/reviewed.

**Interfaces:**

```ts
// authorization.ts, private operation requirements fixed by server, never caller scope claims.
interface OperationRequirement { scopes: readonly Scope[]; capability: 'account' | 'write';
  resource: 'account' | 'shop' | 'verified_relationship' }
interface AuthorizationInput { record: ConnectionRecord; owner: OwnerContext;
  currentGeneration: number; required: OperationRequirement;
  enabledCapabilities: readonly string[]; requestedShopId?: number;
  relationshipVerified: boolean; developmentMode: boolean }
authorizeOperation(input: AuthorizationInput): void;
// scopes.ts, ONLY after exact official diagnostic response shape established:
parseDiagnosticScopes(value: unknown, checkedAt: number): ScopeEvidence;
// transport extension, still fixed POST /v3/application/scopes:
OAuthTransport.inspectScopes?: (accessToken: string) => Promise<ScopeEvidence>;
// service extension; calls ensureFresh + serialized durable grant update:
OAuthService.scopeInspectionAvailable: boolean; // readonly, from supported transport only
OAuthService.inspectScopes(connectionId: string): Promise<{ scopes: readonly Scope[]; checked_at: number }>;
```

`relationshipVerified`, owner and currentGeneration are private proofs supplied by trusted service/handler state, never model args. Guard requires owner equality, record generation equal to currentGeneration, usable state + effective grant intersection (actual verified ∩ consent-requested ∩ configured capability ∩ exact operation) and matching resource/account. Write operations also need future M5 action/confirmation gate; this function alone never authorizes a mutation. No M4 private resource tools are registered here. Before a documented parser exists, transport.inspectScopes is absent, service.scopeInspectionAvailable is false, service.inspectScopes rejects with a safe prerequisite before resolving tokens, and tools register the diagnostic as available:false so discovery omits it and direct dispatch explains the gate; no model input can change this.

- [x] **Step 1: Write M3.5a RED tests:** name `actual grants authorize independently of unavailable diagnostic` and `missing scopes and stale owner generation deny direct dispatch`. Assert `assert.doesNotThrow(() => authorizeOperation(validOwnInput))` with diagnostic unavailable and `assert.throws(() => authorizeOperation(missingScopeInput))`. Missing/reduced scopes and direct hidden-tool calls deny; no all-scopes default or write→read inference. getMe shops_r baseline and updateShop shops_r+shops_w are explicit fixtures; foreign shop/wrong relationship/stale generation/reconnect state fail. Fake scope metadata/model name/connection possession never grants ownership. Valid documented token scope still authorizes own supported operation when diagnostic unavailable.
- [x] **Step 2: Run RED:** `npm run build` then `node --test test/oauth-authorization.test.js test/oauth-scopes.test.js`. Expected new core assertions fail; diagnostic-unavailable fixtures are expected safe outcomes, not invented successes.
- [x] **Step 3: Implement authorization core** and test-owned dispatch integration with service.withConnection/ensureFresh; preserve independent registry and method guard enforcement. **Coordinator round-1 coverage evidence:** `test/oauth-authorization.test.js` registers test-only operations through the real `CapabilityRegistry` and MCP `callTool` boundary, invokes the real service and `authorizeOperation`, supplies owner/generation from independent trusted fixture state, and asserts a mocked protected Etsy adapter/counter is reached only when authorized. Cases cover successful access with diagnostics unavailable, unrequested/missing/unknown grants, reduced grants after one shared refresh across concurrent dispatch plus `ensureFresh`, disconnect/in-flight result invalidation/reconnect, foreign owner/ID/stale generation/shop, and disabled/hidden direct-call denial before storage or adapter work. No production M4+/M5 route was added. Focused result and initial test-owned unguarded-baseline RED are recorded in the Task 6 report; independent review and coordinator verification are complete for M3.5a only.
- [x] **Step 4: Research M3.5b exact tokenScopes contract** using current public official reference/guide, no account request. The captured Scopes schema is `{}`: require documented exact response shape/provenance and bounded fixtures before creating parser or enabling inspectScopes registration. If still unspecified, record concrete blocker in TASK/report, leave M3.5b/TODO diagnostic and M3.5 parent unchecked; no fake endpoint coverage. Continue usable core/connection flows, not an operator-permission question. **Finding (2026-10-17):** the current official `Scopes` schema still has `properties: {}`; the auth guide documents token-response `scope`, not the diagnostic body. No parser or fixed transport call is enabled.
- [ ] **Step 5: If documented, write diagnostic RED tests** for exact form-urlencoded token body/API pair, internal resolution only, strict bounded source shape, missing/unknown/malformed/grant-disagreement/oversize response, lock ON pre-credential POST denial and OFF fixed destination; errors containing synthetic tokens must be sanitized. Run `npm run build` then `node --test test/oauth-scopes.test.js`. Expected fails on missing supported parser/transport/service behavior; otherwise mark this step blocked, not passed/skipped-as-complete. **Blocked:** current Etsy documentation provides no exact diagnostic fields or bounded response fixture; do not invent them.
- [ ] **Step 6: If unblocked, implement diagnostic interfaces** and explicit `get_etsy_token_scopes` tool with only opaque ID input, safe scopes/timestamp output. Under per-connection serialization reconcile grants; valid reductions invalidate dependent references and actual trusted disagreement blocks affected access, never expands consent. Missing/unknown/malformed diagnostic response is not contradictory evidence and must not erase validated token-response grants. Conservative annotations false/false/false/true because refresh/local scope update may occur. Unsupported parser remains undiscoverable and direct calls yield prerequisite without token/network. **Not applicable while Step 5 is blocked.**
- [x] **Step 7: Verify M3.5a core and unavailable-diagnostic boundary:** focused authorization/scope/status/development tests 46/46; coordinator fresh `npm test` (includes build) Windows Node v24.12.0 370 total/369 passed/0 failed/1 Linux-only skip (`task-6-reviewed-windows.log`), native Linux Node22.23.3 370 total/361 passed/0 failed/9 Windows-only skips (`task-6-reviewed-linux.log`), including real child SIGTERM. Production audit 0 vulnerabilities; `python docs/contracts/audit.py` PASS 105/105. The earlier default-shell `node: command not found` was a PATH observation, superseded by the existing checksum-verified portable runtime recorded in `linux-runtime.json` and `linux-runtime-proof.json`; it is not a remaining platform blocker. Exact evidence is in the Task 6 report. This step verifies core/gating only, not the blocked M3.5b diagnostic; parent M3.5 and overall M3 remain incomplete.
- [x] **Step 8: Independent security/spec/quality review of M3.5a before coordinator commit** (`feat: enforce Etsy connection scopes`): approved `ses_eb31bb0fbffeIuVzfd3ngoeUOB` after one dispatch-coverage fix round; final coordinator cross-platform evidence above. TASK/TODO/matrix record core only, no prospective diagnostic coverage or private handlers. Scope-array whitespace-element Minor remains unchanged/deferred to final OAuth review. **Coordinator commit pending for core only.** M3.5b implementation/review remains blocked under Steps 5–6; this does not finish parent M3.5 or overall M3. Whole-branch release review, live consent, proxy/firewall deployment, and Docker verification are not claimed.

## Execution handoff

The user has already approved proceeding after design review and the existing subagent execution method. Coordinator reviews this documentation plus separate Luna ignore changes, commits only reviewed explicit paths, then continues the numeric tasks with Luna/Maximum implementation and fresh Sol/Medium reviews. No extra human handoff confirmation; operator setup/browser consent and diagnostic/platform evidence remain real gates, not permission questions. This plan itself implements no tools and completes no future task.
