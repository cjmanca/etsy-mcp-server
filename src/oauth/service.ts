import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { OAuthTransport } from "./transport.js";
import { parseGrantedScopes } from "./scopes.js";
import {
  OAuthError,
  type ConnectionRecord,
  type ConnectionStore,
  type OAuthConfig,
  type Scope,
  type ScopeEvidence,
} from "./types.js";

export type Bundle =
  | "catalog_read"
  | "shop_read"
  | "financial_read"
  | "profile_read"
  | "address_read"
  | "listing_write"
  | "listing_delete"
  | "shop_write"
  | "fulfillment_write";

export interface BeginInput {
  bundles: readonly Bundle[];
  label?: string;
  replaceConnectionId?: string;
}

export interface BeginResult {
  connection_id: string;
  state: "pending";
  expires_at: number;
  requested_scopes: readonly Scope[];
  authorization_url: string;
  human_action: string;
}

export type ConnectionStatusState =
  | ConnectionRecord["state"]
  | "pending"
  | "denied"
  | "expired"
  | "failed"
  | "disconnected";

export interface ConnectionStatus {
  connection_id: string;
  state: ConnectionStatusState;
  reason?: string;
  requested_scopes?: readonly Scope[];
  granted_scopes?: readonly Scope[];
  enabled_capabilities?: readonly string[];
  account_id?: number;
  shop_id?: number;
  expires_at?: number;
  reconnect_guidance?: string;
}

export interface DisconnectResult {
  connection_id: string;
  state: "disconnected" | "recovery_required";
  local_credentials_removed: boolean;
  upstream_revoked: false;
}

export type CallbackInput = { state: string; code: string } | { state: string; denied: true };
export type CallbackOutcome = "complete" | "denied" | "failed";

export interface OAuthService {
  readonly beginAvailable: boolean;
  readonly scopeInspectionAvailable: boolean;
  begin(input: BeginInput): Promise<BeginResult>;
  completeCallback(input: CallbackInput): Promise<CallbackOutcome>;
  status(connectionId: string): Promise<ConnectionStatus>;
  disconnect(connectionId: string): Promise<DisconnectResult>;
  /** Internal token lifecycle operation. Never expose the returned record to MCP. */
  ensureFresh(connectionId: string): Promise<ConnectionRecord>;
  /**
   * Run trusted lifecycle work while the connection is serialized. The callback
   * must not reenter ensureFresh/withConnection for this same connection ID.
   */
  withConnection<T>(
    connectionId: string,
    work: (record: ConnectionRecord) => Promise<T>,
  ): Promise<T>;
  inspectScopes(connectionId: string): Promise<{ scopes: readonly Scope[]; checked_at: number }>;
  close(): Promise<void>;
}

interface PendingAttempt {
  readonly state: string;
  readonly verifier: string;
  readonly connectionId: string;
  readonly requestedScopes: readonly Scope[];
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly owner: OAuthConfig["owner"];
  readonly sessionId: string;
  readonly bootId: string;
  readonly label?: string;
  readonly replaceRecord?: ConnectionRecord;
}

const AUTHORIZATION_URL = "https://www.etsy.com/oauth/connect";
const PENDING_TTL_MS = 5 * 60 * 1_000;
const MAX_PENDING_ATTEMPTS = 10;
const MAX_CONCURRENT_EXCHANGES = 2;
const MAX_TOKEN_BYTES = 16 * 1024;
const MAX_TOKEN_LIFETIME_SECONDS = 366 * 24 * 60 * 60;
const MIN_EPOCH_MS = 946_684_800_000;
const MAX_EPOCH_MS = 4_102_444_800_000;
const REFRESH_SKEW_MS = 60_000;
const MAX_TERMINAL_STATUSES = 100;
const TERMINAL_STATUS_TTL_MS = 5 * 60 * 1_000;
const CONNECTION_ID = /^[A-Za-z0-9_-]{22}$/;
const STORED_CONNECTION_ID = /^[A-Za-z0-9_-]{22,128}$/;
const STATE_OR_VERIFIER = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_PATTERN = /^([1-9][0-9]{0,15})\.[\x21-\x7e]+$/;
const CODE_PATTERN = /^[\x21-\x7e]{1,2048}$/;
const CONNECTION_STATES = new Set([
  "connected",
  "connected_limited",
  "scope_verification_required",
  "reconnect_required",
  "recovery_required",
]);
const TOKEN_RESULT_KEYS = new Set(["accessToken", "refreshToken", "expiresIn", "grants"]);
const SCOPE_EVIDENCE_KEYS = new Set(["scopes", "source", "checkedAt"]);
const SAFE_STATUS_REASONS = new Set([
  "scope_missing",
  "scope_verification_required",
  "refresh_uncertain",
  "identity_unverified",
  "consent_denied",
  "consent_expired",
  "connection_failed",
  "access_token_expired",
  "local_disconnect_incomplete",
]);

const STATUS_RECONNECT_GUIDANCE: Readonly<Partial<Record<ConnectionStatusState, string>>> = Object.freeze({
  denied: "Start a new Etsy authorization flow if you still want to connect this account.",
  expired: "Start a new Etsy authorization flow before using this connection again.",
  failed: "Start a new Etsy authorization flow if you still want to connect this account.",
  scope_verification_required: "Start a new Etsy authorization flow to verify scopes before using this connection.",
  reconnect_required: "Start a new Etsy authorization flow before using this connection again.",
  recovery_required: "Stop all possible owners and require verified offline recovery or fresh Etsy consent before reusing affected credentials.",
  disconnected: "Start a new Etsy authorization flow if you want to reconnect this account.",
});

interface PendingStatus {
  readonly connectionId: string;
  readonly state: "pending" | "denied" | "expired" | "failed" | "disconnected" | "recovery_required";
  readonly requestedScopes: readonly Scope[];
  readonly expiresAt?: number;
  readonly reason?: string;
  readonly retainUntil?: number;
}

const BUNDLE_SCOPES: Readonly<Record<Bundle, readonly Scope[]>> = Object.freeze({
  catalog_read: ["listings_r"],
  shop_read: [],
  financial_read: ["transactions_r"],
  profile_read: ["email_r"],
  address_read: ["address_r"],
  listing_write: [],
  listing_delete: [],
  shop_write: [],
  fulfillment_write: [],
});

const ENABLED_BUNDLES = new Set<Bundle>([
  "catalog_read",
  "shop_read",
  "financial_read",
  "profile_read",
  "address_read",
]);
const ALL_BUNDLES = new Set(Object.keys(BUNDLE_SCOPES));

function fail(reason: ConstructorParameters<typeof OAuthError>[0]): never {
  throw new OAuthError(reason);
}

function validEpoch(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= MIN_EPOCH_MS && Number(value) <= MAX_EPOCH_MS;
}

function decodeOpaqueId(value: string, expectedBytes: number): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== expectedBytes || decoded.toString("base64url") !== value) return undefined;
  return decoded;
}

function generateOpaque(random: (size: number) => Buffer, size: number): string {
  const bytes = random(size);
  if (!Buffer.isBuffer(bytes) || bytes.length !== size) return fail("oauth_flow_unavailable");
  return bytes.toString("base64url");
}

function validOwner(value: OAuthConfig["owner"], expected: OAuthConfig["owner"]): boolean {
  return value?.operatorId === expected.operatorId && value?.appFingerprint === expected.appFingerprint;
}

function validClientId(value: unknown, owner: OAuthConfig["owner"]): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 1_024 ||
    /[:\s\u0000-\u001f\u007f]/.test(value)
  ) {
    return false;
  }
  const fingerprint = createHash("sha256")
    .update("etsy-mcp-oauth-app-fingerprint-v1\0")
    .update(value, "utf8")
    .digest("hex");
  return fingerprint === owner.appFingerprint;
}

function requestedScopesFor(value: unknown): readonly Scope[] {
  if (!Array.isArray(value) || value.length > 9) return fail("oauth_flow_invalid");
  const selected = new Set<Bundle>();
  for (const bundle of value) {
    if (typeof bundle !== "string" || !ALL_BUNDLES.has(bundle)) return fail("oauth_flow_invalid");
    if (selected.has(bundle as Bundle)) return fail("oauth_flow_invalid");
    if (!ENABLED_BUNDLES.has(bundle as Bundle)) return fail("oauth_flow_unavailable");
    selected.add(bundle as Bundle);
  }
  const scopes: Scope[] = ["shops_r"];
  for (const bundle of value as Bundle[]) {
    for (const scope of BUNDLE_SCOPES[bundle]) {
      if (!scopes.includes(scope)) scopes.push(scope);
    }
  }
  return Object.freeze(scopes);
}

function validLabel(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 100 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return fail("oauth_flow_invalid");
  }
  return value;
}

function tokenAccountId(value: unknown): { token: string; accountId: number } {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > MAX_TOKEN_BYTES ||
    !/^[\x21-\x7e]+$/.test(value)
  ) {
    return fail("oauth_response_invalid");
  }
  const match = TOKEN_PATTERN.exec(value);
  if (!match) return fail("oauth_response_invalid");
  const accountId = Number(match[1]);
  if (!Number.isSafeInteger(accountId) || accountId <= 0) return fail("oauth_response_invalid");
  return { token: value, accountId };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownDataValue(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function hasExactOwnKeys(value: Record<string, unknown>, expected: ReadonlySet<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function validStoredConnectionId(value: unknown): value is string {
  if (typeof value !== "string" || !STORED_CONNECTION_ID.test(value)) return false;
  const decoded = Buffer.from(value, "base64url");
  return decoded.length >= 16 && decoded.length <= 96 && decoded.toString("base64url") === value;
}

function validateTokenResult(value: unknown, now: number, expectedSource?: ScopeEvidence["source"]): {
  accessToken: string;
  refreshToken: string;
  accountId: number;
  expiresAt: number;
  grants: ReturnType<typeof parseGrantedScopes>;
} {
  try {
    if (!isPlainRecord(value) || !hasExactOwnKeys(value, TOKEN_RESULT_KEYS)) {
      return fail("oauth_response_invalid");
    }
    const access = tokenAccountId(ownDataValue(value, "accessToken"));
    const refresh = tokenAccountId(ownDataValue(value, "refreshToken"));
    const prefix = access.token.slice(0, access.token.indexOf("."));
    const refreshPrefix = refresh.token.slice(0, refresh.token.indexOf("."));
    const expiresIn = ownDataValue(value, "expiresIn");
    if (
      access.accountId !== refresh.accountId ||
      prefix !== refreshPrefix ||
      !Number.isSafeInteger(expiresIn) ||
      Number(expiresIn) <= 0 ||
      Number(expiresIn) > MAX_TOKEN_LIFETIME_SECONDS ||
      !validEpoch(now)
    ) {
      return fail("oauth_response_invalid");
    }
    const grants = ownDataValue(value, "grants");
    if (
      !isPlainRecord(grants) ||
      !hasExactOwnKeys(grants, SCOPE_EVIDENCE_KEYS)
    ) {
      return fail("oauth_scope_invalid");
    }
    const rawScopes = ownDataValue(grants, "scopes");
    const source = ownDataValue(grants, "source");
    const checkedAt = ownDataValue(grants, "checkedAt");
    if (
      !Array.isArray(rawScopes) ||
      rawScopes.some((scope) => typeof scope !== "string") ||
      (source !== "authorization_code_response" && source !== "refresh_response") ||
      (expectedSource !== undefined && source !== expectedSource) ||
      !validEpoch(checkedAt)
    ) {
      return fail("oauth_scope_invalid");
    }
    const scopeText = rawScopes.join(" ");
    const parsedGrants = parseGrantedScopes(scopeText, source, checkedAt);
    const expiresAt = now + Number(expiresIn) * 1_000;
    if (!validEpoch(expiresAt) || expiresAt <= now) return fail("oauth_response_invalid");
    return {
      accessToken: access.token,
      refreshToken: refresh.token,
      accountId: access.accountId,
      expiresAt,
      grants: parsedGrants,
    };
  } catch (error) {
    if (error instanceof OAuthError) throw error;
    return fail("oauth_response_invalid");
  }
}

function validateConnectionRecord(value: unknown, connectionId: string, owner: OAuthConfig["owner"]): ConnectionRecord {
  try {
    if (!isPlainRecord(value)) return fail("connection_unavailable");
    const record = value;
    const storedId = ownDataValue(record, "connectionId");
    const recordOwner = ownDataValue(record, "owner");
    const accountId = ownDataValue(record, "accountId");
    const generation = ownDataValue(record, "generation");
    const state = ownDataValue(record, "state");
    const accessValue = ownDataValue(record, "accessToken");
    const refreshValue = ownDataValue(record, "refreshToken");
    const issuedAt = ownDataValue(record, "issuedAt");
    const expiresAt = ownDataValue(record, "expiresAt");
    const requestedValue = ownDataValue(record, "requestedScopes");
    const grantsValue = ownDataValue(record, "grants");
    if (
      storedId !== connectionId ||
      !validStoredConnectionId(storedId) ||
      !isPlainRecord(recordOwner) ||
      ownDataValue(recordOwner, "operatorId") !== owner.operatorId ||
      ownDataValue(recordOwner, "appFingerprint") !== owner.appFingerprint ||
      !Number.isSafeInteger(accountId) ||
      Number(accountId) <= 0 ||
      !Number.isSafeInteger(generation) ||
      Number(generation) <= 0 ||
      typeof state !== "string" ||
      !CONNECTION_STATES.has(state) ||
      !validEpoch(issuedAt) ||
      !validEpoch(expiresAt) ||
      Number(expiresAt) <= Number(issuedAt) ||
      Number(expiresAt) - Number(issuedAt) > MAX_TOKEN_LIFETIME_SECONDS * 1_000
    ) {
      return fail("connection_unavailable");
    }
    const access = tokenAccountId(accessValue);
    const refresh = tokenAccountId(refreshValue);
    if (access.accountId !== Number(accountId) || refresh.accountId !== Number(accountId)) {
      return fail("connection_unavailable");
    }
    if (!Array.isArray(requestedValue) || requestedValue.some((scope) => typeof scope !== "string")) {
      return fail("connection_unavailable");
    }
    const rawGrants = grantsValue;
    if (!isPlainRecord(rawGrants) || !hasExactOwnKeys(rawGrants, SCOPE_EVIDENCE_KEYS)) {
      return fail("connection_unavailable");
    }
    const rawGrantedScopes = ownDataValue(rawGrants, "scopes");
    const source = ownDataValue(rawGrants, "source");
    const checkedAt = ownDataValue(rawGrants, "checkedAt");
    if (
      !Array.isArray(rawGrantedScopes) ||
      rawGrantedScopes.some((scope) => typeof scope !== "string") ||
      (source !== "authorization_code_response" && source !== "refresh_response" && source !== "diagnostic") ||
      !validEpoch(checkedAt)
    ) {
      return fail("connection_unavailable");
    }
    const requestedScopes = parseGrantedScopes(
      requestedValue.join(" "),
      "authorization_code_response",
      checkedAt,
    ).scopes;
    const grants = parseGrantedScopes(rawGrantedScopes.join(" "), source, checkedAt);
    const shopId = ownDataValue(record, "shopId");
    const label = ownDataValue(record, "label");
    const reason = ownDataValue(record, "reason");
    if (
      (shopId !== undefined && (!Number.isSafeInteger(shopId) || Number(shopId) <= 0)) ||
      (label !== undefined && (typeof label !== "string" || label.length > 100)) ||
      (reason !== undefined && typeof reason !== "string")
    ) {
      return fail("connection_unavailable");
    }
    return Object.freeze({
      connectionId,
      owner: Object.freeze({ operatorId: owner.operatorId, appFingerprint: owner.appFingerprint }),
      accountId: Number(accountId),
      ...(shopId === undefined ? {} : { shopId: Number(shopId) }),
      generation: Number(generation),
      ...(label === undefined ? {} : { label }),
      state: state as ConnectionRecord["state"],
      ...(reason === undefined ? {} : { reason }),
      accessToken: access.token,
      refreshToken: refresh.token,
      issuedAt: Number(issuedAt),
      expiresAt: Number(expiresAt),
      requestedScopes,
      grants,
    });
  } catch (error) {
    if (error instanceof OAuthError && error.reason === "oauth_scope_invalid") {
      return fail("connection_unavailable");
    }
    if (error instanceof OAuthError && error.reason === "oauth_response_invalid") {
      return fail("connection_unavailable");
    }
    if (error instanceof OAuthError) throw error;
    return fail("connection_unavailable");
  }
}

function isValidCallback(value: unknown): value is CallbackInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  if (typeof input.state !== "string" || !STATE_OR_VERIFIER.test(input.state)) return false;
  if (!decodeOpaqueId(input.state, 32)) return false;
  if (input.denied === true) return Object.keys(input).length === 2 && input.code === undefined;
  return Object.keys(input).length === 2 && typeof input.code === "string" && CODE_PATTERN.test(input.code);
}

function constantTimeStateEqual(left: string, right: string): boolean {
  if (Buffer.byteLength(left, "ascii") !== Buffer.byteLength(right, "ascii")) return false;
  return timingSafeEqual(Buffer.from(left, "ascii"), Buffer.from(right, "ascii"));
}

export function createOAuthService(
  config: OAuthConfig,
  store: ConnectionStore,
  transport: OAuthTransport,
  deps?: { now?: () => number; randomBytes?: (size: number) => Buffer; clientId?: string },
): OAuthService {
  const now = deps?.now ?? Date.now;
  const random = deps?.randomBytes ?? randomBytes;
  const clientId = deps?.clientId;
  const bootId = generateOpaque(random, 16);
  const sessionId = bootId;
  const pendingByState = new Map<string, PendingAttempt>();
  const pendingConnections = new Set<string>();
  const pendingStatuses = new Map<string, PendingStatus>();
  const locallyDisabledConnections = new Set<string>();
  const disconnectFlights = new Map<string, Promise<DisconnectResult>>();
  const activeConnectionLifecycles = new Map<string, number>();
  const completedDisconnectsPendingDrain = new Set<string>();
  const activeBegins = new Set<Promise<BeginResult>>();
  const activeCompletions = new Set<Promise<CallbackOutcome>>();
  const activeLifecycle = new Set<Promise<unknown>>();
  const lifecycleLocks = new Map<string, Promise<void>>();
  const freshnessFlights = new Map<string, Promise<ConnectionRecord>>();
  const blockedGenerations = new Set<string>();
  const lifecycleContext = new AsyncLocalStorage<ReadonlySet<string>>();
  let activeExchanges = 0;
  let beginReservations = 0;
  let closed = false;
  let shutdownCleanupFailed = false;
  let closePromise: Promise<void> | undefined;
  // The official tokenScopes schema currently declares no response properties.
  // Do not infer support from injected transports until a parser-backed Etsy
  // transport implementation has been reviewed against documented fixtures.
  const scopeInspectionAvailable = false;

  function statusFromPending(entry: PendingStatus): ConnectionStatus {
    return {
      connection_id: entry.connectionId,
      state: entry.state,
      ...(entry.reason === undefined ? {} : { reason: entry.reason }),
      requested_scopes: entry.requestedScopes,
      ...(entry.expiresAt === undefined || entry.state !== "pending"
        ? {}
        : { expires_at: entry.expiresAt }),
      ...(STATUS_RECONNECT_GUIDANCE[entry.state] === undefined
        ? {}
        : { reconnect_guidance: STATUS_RECONNECT_GUIDANCE[entry.state] }),
    };
  }

  function setTerminalStatus(
    connectionId: string,
    state: Exclude<PendingStatus["state"], "pending">,
    requestedScopes: readonly Scope[],
    reason?: string,
    retainUntil?: number,
  ): void {
    const currentTime = now();
    if (!validEpoch(currentTime)) return;
    pendingStatuses.delete(connectionId);
    pendingStatuses.set(connectionId, Object.freeze({
      connectionId,
      state,
      requestedScopes: Object.freeze([...requestedScopes]),
      ...(reason === undefined || !SAFE_STATUS_REASONS.has(reason) ? {} : { reason }),
      retainUntil: retainUntil ?? currentTime + TERMINAL_STATUS_TTL_MS,
    }));

    let terminalCount = 0;
    for (const value of pendingStatuses.values()) {
      if (value.state !== "pending") terminalCount += 1;
    }
    while (terminalCount > MAX_TERMINAL_STATUSES) {
      const oldest = [...pendingStatuses.entries()].find(([, value]) => value.state !== "pending");
      if (!oldest) break;
      pendingStatuses.delete(oldest[0]);
      terminalCount -= 1;
    }
  }

  function cleanExpired(currentTime = now()): void {
    for (const [state, pending] of pendingByState) {
      if (currentTime >= pending.expiresAt) {
        pendingByState.delete(state);
        pendingConnections.delete(pending.connectionId);
        setTerminalStatus(
          pending.connectionId,
          "expired",
          pending.requestedScopes,
          "consent_expired",
          pending.expiresAt + TERMINAL_STATUS_TTL_MS,
        );
      }
    }
    for (const [connectionId, status] of pendingStatuses) {
      if (status.state !== "pending" && status.retainUntil !== undefined && currentTime >= status.retainUntil) {
        pendingStatuses.delete(connectionId);
      }
    }
  }

  async function readConnection(connectionId: string): Promise<ConnectionRecord | undefined> {
    try {
      const record = await store.read(connectionId);
      if (closed) return fail("oauth_flow_unavailable");
      if (record && (!validOwner(record.owner, config.owner) || record.connectionId !== connectionId)) {
        return fail("oauth_flow_invalid");
      }
      return record;
    } catch (error) {
      if (error instanceof OAuthError) throw error;
      return fail("oauth_flow_unavailable");
    }
  }

  function generationKey(connectionId: string, generation: number): string {
    return `${connectionId}:${generation}`;
  }

  function trackLifecycle<T>(operation: Promise<T>): Promise<T> {
    activeLifecycle.add(operation);
    void operation.then(
      () => activeLifecycle.delete(operation),
      () => activeLifecycle.delete(operation),
    );
    return operation;
  }

  function clearDisconnectInvalidationWhenDrained(connectionId: string): void {
    if (
      !activeConnectionLifecycles.has(connectionId) &&
      completedDisconnectsPendingDrain.delete(connectionId)
    ) {
      locallyDisabledConnections.delete(connectionId);
    }
  }

  function trackConnectionLifecycle<T>(
    connectionId: string,
    operation: Promise<T>,
  ): Promise<T> {
    if (!validStoredConnectionId(connectionId)) return trackLifecycle(operation);
    activeConnectionLifecycles.set(
      connectionId,
      (activeConnectionLifecycles.get(connectionId) ?? 0) + 1,
    );
    const tracked = operation.finally(() => {
      const active = activeConnectionLifecycles.get(connectionId) ?? 0;
      if (active <= 1) {
        activeConnectionLifecycles.delete(connectionId);
        clearDisconnectInvalidationWhenDrained(connectionId);
      } else {
        activeConnectionLifecycles.set(connectionId, active - 1);
      }
    });
    return trackLifecycle(tracked);
  }

  function completeDisconnectInvalidation(connectionId: string): void {
    completedDisconnectsPendingDrain.add(connectionId);
    clearDisconnectInvalidationWhenDrained(connectionId);
  }

  function assertConnectionLifecycleAvailable(connectionId: string): void {
    if (closed) return fail("oauth_flow_unavailable");
    assertConnectionNotLocallyDisabled(connectionId);
  }

  function assertConnectionNotLocallyDisabled(connectionId: string): void {
    if (locallyDisabledConnections.has(connectionId)) return fail("connection_unavailable");
  }

  function runConnectionLock<T>(connectionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = lifecycleLocks.get(connectionId) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => held);
    lifecycleLocks.set(connectionId, tail);
    return (async () => {
      await previous;
      try {
        return await operation();
      } finally {
        release();
        if (lifecycleLocks.get(connectionId) === tail) lifecycleLocks.delete(connectionId);
      }
    })();
  }

  async function requireRecoveryFence(): Promise<void> {
    try {
      await store.markRecoveryRequired();
    } catch {
      // The protected store retains its ownership lock when marker persistence
      // cannot be verified. Do not let service shutdown present as clean either.
      shutdownCleanupFailed = true;
    }
  }

  async function disableRefreshGeneration(
    record: ConnectionRecord,
    state: "scope_verification_required" | "reconnect_required",
    reason: string,
  ): Promise<never> {
    blockedGenerations.add(generationKey(record.connectionId, record.generation));
    const nextGeneration = record.generation + 1;
    if (!Number.isSafeInteger(nextGeneration)) {
      await requireRecoveryFence();
      return fail("oauth_reconnect_required");
    }
    try {
      await store.put({ ...record, generation: nextGeneration, state, reason }, record.generation);
    } catch {
      await requireRecoveryFence();
    }
    return fail("oauth_reconnect_required");
  }

  async function readLifecycleRecord(connectionId: string): Promise<ConnectionRecord> {
    assertConnectionLifecycleAvailable(connectionId);
    let value: ConnectionRecord | undefined;
    try {
      value = await store.read(connectionId);
    } catch (error) {
      assertConnectionLifecycleAvailable(connectionId);
      if (error instanceof OAuthError) throw error;
      return fail("connection_unavailable");
    }
    // The store read is an asynchronous boundary: disconnect may have disabled
    // this connection while the read was pending.
    assertConnectionLifecycleAvailable(connectionId);
    if (!value) return fail("connection_unavailable");
    return validateConnectionRecord(value, connectionId, config.owner);
  }

  function statusFromRecord(record: ConnectionRecord): ConnectionStatus {
    let state: ConnectionStatusState = record.state;
    let reason = record.reason;
    if (
      (state === "connected" || state === "connected_limited") &&
      record.expiresAt <= now()
    ) {
      state = "expired";
      reason = "access_token_expired";
    }

    const requested = new Set(record.requestedScopes);
    const granted = new Set(record.grants.scopes);
    const capabilities: string[] = [];
    if (
      (state === "connected" || state === "connected_limited") &&
      requested.has("shops_r") && granted.has("shops_r")
    ) {
      capabilities.push("account_identity");
    }
    if (
      (state === "connected" || state === "connected_limited") &&
      requested.has("listings_r") && granted.has("listings_r")
    ) {
      capabilities.push("catalog_read");
    }
    if (
      (state === "connected" || state === "connected_limited") &&
      requested.has("transactions_r") && granted.has("transactions_r")
    ) {
      capabilities.push("financial_read");
    }
    if (
      (state === "connected" || state === "connected_limited") &&
      requested.has("email_r") && granted.has("email_r")
    ) {
      capabilities.push("profile_read");
    }
    if (
      (state === "connected" || state === "connected_limited") &&
      requested.has("address_r") && granted.has("address_r")
    ) {
      capabilities.push("address_read");
    }

    const safeReason = reason !== undefined && SAFE_STATUS_REASONS.has(reason) ? reason : undefined;
    const guidance = STATUS_RECONNECT_GUIDANCE[state];
    return Object.freeze({
      connection_id: record.connectionId,
      state,
      ...(safeReason === undefined ? {} : { reason: safeReason }),
      requested_scopes: Object.freeze([...record.requestedScopes]),
      granted_scopes: Object.freeze([...record.grants.scopes]),
      enabled_capabilities: Object.freeze(capabilities),
      account_id: record.accountId,
      ...(record.shopId === undefined ? {} : { shop_id: record.shopId }),
      expires_at: record.expiresAt,
      ...(guidance === undefined ? {} : { reconnect_guidance: guidance }),
    });
  }

  function requireUnexpiredRecord(record: ConnectionRecord): ConnectionRecord {
    const currentTime = now();
    if (!validEpoch(currentTime)) return fail("oauth_flow_unavailable");
    if (record.expiresAt <= currentTime) return fail("oauth_token_expired");
    return record;
  }

  async function ensureFreshLocked(connectionId: string): Promise<ConnectionRecord> {
    if (config.developmentMode) return fail("development_mode_locked");
    assertConnectionLifecycleAvailable(connectionId);
    const record = await readLifecycleRecord(connectionId);
    assertConnectionLifecycleAvailable(connectionId);
    if (record.connectionId !== connectionId || !validOwner(record.owner, config.owner)) {
      return fail("connection_unavailable");
    }
    if (blockedGenerations.has(generationKey(connectionId, record.generation))) {
      return fail("oauth_reconnect_required");
    }
    if (record.state !== "connected" && record.state !== "connected_limited") {
      return fail("oauth_reconnect_required");
    }
    const currentTime = now();
    if (!validEpoch(currentTime)) return fail("oauth_flow_unavailable");
    if (record.expiresAt - currentTime > REFRESH_SKEW_MS) return record;

    let tokenResponse: unknown;
    try {
      // Revalidate at the credential-bearing dispatch boundary. A refresh that
      // has already started cannot be undone, but a completed disconnect must
      // not start a new refresh request.
      assertConnectionLifecycleAvailable(connectionId);
      tokenResponse = await transport.refresh(record.refreshToken);
    } catch (error) {
      // Shutdown drains an accepted refresh and must persist an uncertain
      // rotation fence. Local disconnect instead lets its queued removal own
      // the final state and suppresses this lifecycle result.
      assertConnectionNotLocallyDisabled(connectionId);
      const scopeEvidenceMissing = error instanceof OAuthError && error.reason === "oauth_scope_invalid";
      return disableRefreshGeneration(
        record,
        scopeEvidenceMissing ? "scope_verification_required" : "reconnect_required",
        scopeEvidenceMissing ? "scope_verification_required" : "refresh_uncertain",
      );
    }

    assertConnectionNotLocallyDisabled(connectionId);

    const receivedAt = now();
    let token: ReturnType<typeof validateTokenResult>;
    try {
      token = validateTokenResult(tokenResponse, receivedAt, "refresh_response");
    } catch (error) {
      const scopeEvidenceMissing = error instanceof OAuthError && error.reason === "oauth_scope_invalid";
      return disableRefreshGeneration(
        record,
        scopeEvidenceMissing ? "scope_verification_required" : "reconnect_required",
        scopeEvidenceMissing ? "scope_verification_required" : "refresh_uncertain",
      );
    }

    if (token.accountId !== record.accountId) {
      return disableRefreshGeneration(record, "reconnect_required", "identity_unverified");
    }
    const existingGrants = new Set(record.grants.scopes);
    const consentedScopes = new Set(record.requestedScopes);
    if (token.grants.scopes.some((scope) => !existingGrants.has(scope) || !consentedScopes.has(scope))) {
      return disableRefreshGeneration(record, "scope_verification_required", "scope_verification_required");
    }
    const nextGeneration = record.generation + 1;
    if (!Number.isSafeInteger(nextGeneration)) {
      return disableRefreshGeneration(record, "reconnect_required", "refresh_uncertain");
    }
    const completeGrant = record.requestedScopes.every((scope) => token.grants.scopes.includes(scope));
    const refreshed: ConnectionRecord = Object.freeze({
      ...record,
      generation: nextGeneration,
      state: completeGrant ? "connected" : "connected_limited",
      ...(completeGrant ? {} : { reason: "scope_missing" }),
      ...((completeGrant && record.reason === "scope_missing") ? { reason: undefined } : {}),
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      issuedAt: receivedAt,
      expiresAt: token.expiresAt,
      grants: token.grants,
    });

    const blockedKey = generationKey(connectionId, record.generation);
    blockedGenerations.add(blockedKey);
    try {
      assertConnectionNotLocallyDisabled(connectionId);
      await store.put(refreshed, record.generation);
    } catch {
      if (locallyDisabledConnections.has(connectionId)) return fail("connection_unavailable");
      await requireRecoveryFence();
      return fail("oauth_reconnect_required");
    }
    if (locallyDisabledConnections.has(connectionId) || closed) {
      blockedGenerations.delete(blockedKey);
      return fail(closed ? "oauth_flow_unavailable" : "connection_unavailable");
    }
    blockedGenerations.delete(blockedKey);
    assertConnectionLifecycleAvailable(connectionId);
    const validated = validateConnectionRecord(refreshed, connectionId, config.owner);
    if (blockedGenerations.has(generationKey(connectionId, validated.generation))) {
      return fail("oauth_reconnect_required");
    }
    return requireUnexpiredRecord(validated);
  }

  function getFreshnessFlight(connectionId: string): Promise<ConnectionRecord> {
    const existing = freshnessFlights.get(connectionId);
    if (existing) return existing;

    const flight = runConnectionLock(connectionId, () => ensureFreshLocked(connectionId));
    freshnessFlights.set(connectionId, flight);
    void flight.then(
      () => {
        if (freshnessFlights.get(connectionId) === flight) freshnessFlights.delete(connectionId);
      },
      () => {
        if (freshnessFlights.get(connectionId) === flight) freshnessFlights.delete(connectionId);
      },
    );
    return flight;
  }

  function ensureFresh(connectionId: string): Promise<ConnectionRecord> {
    const operation = (async () => {
      if (config.developmentMode) return fail("development_mode_locked");
      if (closed) return fail("oauth_flow_unavailable");
      if (!validStoredConnectionId(connectionId)) return fail("connection_unavailable");
      if (locallyDisabledConnections.has(connectionId)) return fail("connection_unavailable");
      if (lifecycleContext.getStore()?.has(connectionId)) return fail("oauth_flow_invalid");
      const record = await getFreshnessFlight(connectionId);
      // Freshness is shared and awaited; re-check ownership, generation and
      // disconnect invalidation before releasing the credential-bearing record.
      assertConnectionLifecycleAvailable(connectionId);
      const validated = validateConnectionRecord(record, connectionId, config.owner);
      if (blockedGenerations.has(generationKey(connectionId, validated.generation))) {
        return fail("oauth_reconnect_required");
      }
      if (validated.state !== "connected" && validated.state !== "connected_limited") {
        return fail("oauth_reconnect_required");
      }
      const unexpired = requireUnexpiredRecord(validated);
      assertConnectionLifecycleAvailable(connectionId);
      return unexpired;
    })();
    return trackConnectionLifecycle(connectionId, operation);
  }

  function withConnection<T>(
    connectionId: string,
    work: (record: ConnectionRecord) => Promise<T>,
  ): Promise<T> {
    const operation = (async () => {
      if (config.developmentMode) return fail("development_mode_locked");
      if (closed) return fail("oauth_flow_unavailable");
      if (!validStoredConnectionId(connectionId)) return fail("connection_unavailable");
      if (locallyDisabledConnections.has(connectionId)) return fail("connection_unavailable");
      if (lifecycleContext.getStore()?.has(connectionId)) return fail("oauth_flow_invalid");
      if (typeof work !== "function") return fail("oauth_flow_invalid");
      const prepared = await getFreshnessFlight(connectionId);
      assertConnectionLifecycleAvailable(connectionId);
      const validatedPrepared = validateConnectionRecord(prepared, connectionId, config.owner);
      if (
        blockedGenerations.has(generationKey(connectionId, validatedPrepared.generation)) ||
        (validatedPrepared.state !== "connected" && validatedPrepared.state !== "connected_limited")
      ) {
        return fail("oauth_reconnect_required");
      }

      return runConnectionLock(connectionId, async () => {
        assertConnectionLifecycleAvailable(connectionId);
        const record = await readLifecycleRecord(connectionId);
        assertConnectionLifecycleAvailable(connectionId);
        if (
          blockedGenerations.has(generationKey(connectionId, record.generation)) ||
          (record.state !== "connected" && record.state !== "connected_limited") ||
          record.connectionId !== validatedPrepared.connectionId ||
          record.generation !== validatedPrepared.generation ||
          record.accountId !== validatedPrepared.accountId ||
          !validOwner(record.owner, config.owner)
        ) {
          return fail("oauth_reconnect_required");
        }

        const usableRecord = requireUnexpiredRecord(record);
        // No async boundary may intervene between this final invalidation and
        // dispatching the trusted lifecycle callback.
        assertConnectionLifecycleAvailable(connectionId);
        if (
          usableRecord.connectionId !== validatedPrepared.connectionId ||
          usableRecord.generation !== validatedPrepared.generation ||
          usableRecord.accountId !== validatedPrepared.accountId ||
          !validOwner(usableRecord.owner, config.owner) ||
          blockedGenerations.has(generationKey(connectionId, usableRecord.generation))
        ) {
          return fail("oauth_reconnect_required");
        }

        const activeConnections = new Set(lifecycleContext.getStore() ?? []);
        activeConnections.add(connectionId);
        let result: T;
        try {
          result = await lifecycleContext.run(activeConnections, () => work(usableRecord));
        } catch (error) {
          // Prefer the invalidation outcome over an error from work which was
          // already running when the operator disconnected locally.
          assertConnectionLifecycleAvailable(connectionId);
          throw error;
        }

        // Work already dispatched is not cancelled by local disconnect. Its
        // result is withheld if the connection was invalidated while it ran.
        assertConnectionLifecycleAvailable(connectionId);
        const releasedRecord = validateConnectionRecord(usableRecord, connectionId, config.owner);
        if (
          releasedRecord.generation !== validatedPrepared.generation ||
          releasedRecord.accountId !== validatedPrepared.accountId ||
          (releasedRecord.state !== "connected" && releasedRecord.state !== "connected_limited") ||
          blockedGenerations.has(generationKey(connectionId, releasedRecord.generation))
        ) {
          return fail("oauth_reconnect_required");
        }
        return result;
      });
    })();
    return trackConnectionLifecycle(connectionId, operation);
  }

  function status(connectionId: string): Promise<ConnectionStatus> {
    const operation = (async () => {
      if (typeof connectionId !== "string" || !CONNECTION_ID.test(connectionId)) {
        return fail("connection_unavailable");
      }
      if (closed) return fail("oauth_flow_unavailable");
      cleanExpired();

      const disconnecting = disconnectFlights.get(connectionId);
      if (disconnecting) await disconnecting.catch(() => undefined);
      if (closed) return fail("oauth_flow_unavailable");

      const pending = pendingStatuses.get(connectionId);
      if (
        pending &&
        (pending.state === "pending" || pending.state === "disconnected" || pending.state === "recovery_required")
      ) {
        return statusFromPending(pending);
      }

      let stored: ConnectionRecord | undefined;
      try {
        stored = await store.read(connectionId);
      } catch {
        return fail("connection_unavailable");
      }
      if (closed) return fail("oauth_flow_unavailable");
      const disconnectingAfterRead = disconnectFlights.get(connectionId);
      if (disconnectingAfterRead) await disconnectingAfterRead.catch(() => undefined);
      if (closed) return fail("oauth_flow_unavailable");
      const latestPending = pendingStatuses.get(connectionId);
      if (
        latestPending &&
        (latestPending.state === "pending" || latestPending.state === "disconnected" ||
          latestPending.state === "recovery_required")
      ) {
        return statusFromPending(latestPending);
      }
      if (locallyDisabledConnections.has(connectionId)) return fail("connection_unavailable");
      if (!stored) {
        if (latestPending) return statusFromPending(latestPending);
        return fail("connection_unavailable");
      }
      try {
        const record = validateConnectionRecord(stored, connectionId, config.owner);
        return statusFromRecord(record);
      } catch {
        return fail("connection_unavailable");
      }
    })();
    return trackConnectionLifecycle(connectionId, operation);
  }

  function inspectScopes(_connectionId: string): Promise<{ scopes: readonly Scope[]; checked_at: number }> {
    // This check intentionally precedes ID validation, storage lookup, token
    // refresh, and all credential/network work while the response is unknown.
    if (!scopeInspectionAvailable) {
      return Promise.reject(new OAuthError("oauth_scope_diagnostic_unavailable"));
    }
    return Promise.reject(new OAuthError("oauth_scope_diagnostic_unavailable"));
  }

  function disconnectResult(
    connectionId: string,
    state: DisconnectResult["state"],
    localCredentialsRemoved: boolean,
  ): DisconnectResult {
    return Object.freeze({
      connection_id: connectionId,
      state,
      local_credentials_removed: localCredentialsRemoved,
      upstream_revoked: false,
    });
  }

  function disconnect(connectionId: string): Promise<DisconnectResult> {
    if (typeof connectionId !== "string" || !CONNECTION_ID.test(connectionId)) {
      return Promise.reject(new OAuthError("connection_unavailable"));
    }
    if (closed) return Promise.reject(new OAuthError("oauth_flow_unavailable"));

    const existingFlight = disconnectFlights.get(connectionId);
    if (existingFlight) return existingFlight;

    cleanExpired();
    const priorStatus = pendingStatuses.get(connectionId);
    if (priorStatus?.state === "disconnected") {
      return Promise.resolve(disconnectResult(connectionId, "disconnected", true));
    }
    if (priorStatus?.state === "recovery_required") {
      return Promise.resolve(disconnectResult(connectionId, "recovery_required", false));
    }

    const hadLocalAttempt = priorStatus !== undefined;
    const requestedScopes = priorStatus?.requestedScopes ?? [];
    if (priorStatus) setTerminalStatus(connectionId, "disconnected", requestedScopes);
    locallyDisabledConnections.add(connectionId);
    for (const [state, attempt] of pendingByState) {
      if (attempt.connectionId === connectionId) pendingByState.delete(state);
    }
    pendingConnections.delete(connectionId);

    const operation = trackLifecycle(runConnectionLock(connectionId, async () => {
      let stored: ConnectionRecord | undefined;
      try {
        stored = await store.read(connectionId);
      } catch {
        await requireRecoveryFence();
        setTerminalStatus(connectionId, "recovery_required", requestedScopes, "local_disconnect_incomplete");
        return disconnectResult(connectionId, "recovery_required", false);
      }

      if (!stored) {
        if (!hadLocalAttempt) {
          completeDisconnectInvalidation(connectionId);
          return fail("connection_unavailable");
        }
        setTerminalStatus(connectionId, "disconnected", requestedScopes);
        completeDisconnectInvalidation(connectionId);
        return disconnectResult(connectionId, "disconnected", true);
      }

      let record: ConnectionRecord;
      try {
        record = validateConnectionRecord(stored, connectionId, config.owner);
      } catch {
        return fail("connection_unavailable");
      }

      try {
        await store.remove(connectionId, record.generation);
      } catch {
        await requireRecoveryFence();
        setTerminalStatus(
          connectionId,
          "recovery_required",
          record.requestedScopes,
          "local_disconnect_incomplete",
        );
        return disconnectResult(connectionId, "recovery_required", false);
      }

      setTerminalStatus(connectionId, "disconnected", record.requestedScopes);
      completeDisconnectInvalidation(connectionId);
      return disconnectResult(connectionId, "disconnected", true);
    }));
    disconnectFlights.set(connectionId, operation);
    void operation.then(
      () => {
        if (disconnectFlights.get(connectionId) === operation) disconnectFlights.delete(connectionId);
      },
      () => {
        if (disconnectFlights.get(connectionId) === operation) disconnectFlights.delete(connectionId);
      },
    );
    return operation;
  }

  async function allocateConnectionId(): Promise<string> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const connectionId = generateOpaque(random, 16);
      if (pendingConnections.has(connectionId)) continue;
      pendingConnections.add(connectionId);
      let existing: ConnectionRecord | undefined;
      try {
        existing = await readConnection(connectionId);
        if (closed) return fail("oauth_flow_unavailable");
      } catch (error) {
        pendingConnections.delete(connectionId);
        throw error;
      }
      if (existing === undefined) return connectionId;
      pendingConnections.delete(connectionId);
    }
    return fail("oauth_flow_unavailable");
  }

  function buildAuthorizationUrl(input: {
    clientId: string;
    state: string;
    challenge: string;
    requestedScopes: readonly Scope[];
  }): string {
    const url = new URL(AUTHORIZATION_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", input.clientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("scope", input.requestedScopes.join(" "));
    url.searchParams.set("state", input.state);
    url.searchParams.set("code_challenge", input.challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.href;
  }

  async function performBegin(input: BeginInput): Promise<BeginResult> {
    if (closed) return fail("oauth_flow_unavailable");
    if (config.developmentMode) return fail("development_mode_locked");
    if (!validClientId(clientId, config.owner)) {
      return fail("oauth_flow_unavailable");
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) return fail("oauth_flow_invalid");
    const requestedScopes = requestedScopesFor(input.bundles);
    const label = validLabel(input.label);
    cleanExpired();
    if (pendingByState.size + beginReservations >= MAX_PENDING_ATTEMPTS) {
      return fail("oauth_flow_unavailable");
    }
    beginReservations += 1;

    let replaceRecord: ConnectionRecord | undefined;
    let connectionId: string | undefined;
    let keepConnectionReservation = false;
    try {
      if (input.replaceConnectionId !== undefined) {
        if (!CONNECTION_ID.test(input.replaceConnectionId) || !decodeOpaqueId(input.replaceConnectionId, 16)) {
          return fail("oauth_flow_invalid");
        }
        if (pendingConnections.has(input.replaceConnectionId)) return fail("oauth_flow_unavailable");
        // Reserve the reconnect generation before the store read so a
        // concurrent begin cannot pass the same generation check.
        pendingConnections.add(input.replaceConnectionId);
        connectionId = input.replaceConnectionId;
        const existing = await readConnection(connectionId);
        if (closed) return fail("oauth_flow_unavailable");
        if (!existing || !validOwner(existing.owner, config.owner) || !Number.isSafeInteger(existing.generation)) {
          return fail("oauth_flow_invalid");
        }
        replaceRecord = existing;
        connectionId = existing.connectionId;
      } else {
        connectionId = await allocateConnectionId();
        if (closed) return fail("oauth_flow_unavailable");
      }

      if (closed || connectionId === undefined) return fail("oauth_flow_unavailable");
      const createdAt = now();
      const expiresAt = createdAt + PENDING_TTL_MS;
      if (!validEpoch(createdAt) || !validEpoch(expiresAt)) return fail("oauth_flow_unavailable");
      const state = generateOpaque(random, 32);
      const verifier = generateOpaque(random, 32);
      if (pendingByState.has(state) || !STATE_OR_VERIFIER.test(state) || !STATE_OR_VERIFIER.test(verifier)) {
        return fail("oauth_flow_unavailable");
      }
      const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
      const pending: PendingAttempt = Object.freeze({
        state,
        verifier,
        connectionId,
        requestedScopes,
        createdAt,
        expiresAt,
        owner: config.owner,
        sessionId,
        bootId,
        ...(label === undefined ? {} : { label }),
        ...(replaceRecord === undefined ? {} : { replaceRecord }),
      });
      pendingByState.set(state, pending);
      pendingConnections.add(connectionId);
      pendingStatuses.set(connectionId, Object.freeze({
        connectionId,
        state: "pending",
        requestedScopes,
        expiresAt,
      }));
      keepConnectionReservation = true;

      return {
        connection_id: connectionId,
        state: "pending",
        expires_at: expiresAt,
        requested_scopes: requestedScopes,
        authorization_url: buildAuthorizationUrl({ clientId, state, challenge, requestedScopes }),
        human_action: "Open the authorization URL in a browser and approve the requested Etsy scopes.",
      };
    } finally {
      beginReservations -= 1;
      if (!keepConnectionReservation && connectionId !== undefined) {
        pendingConnections.delete(connectionId);
      }
    }
  }

  function begin(input: BeginInput): Promise<BeginResult> {
    const operation = performBegin(input);
    activeBegins.add(operation);
    void operation.then(
      () => activeBegins.delete(operation),
      () => activeBegins.delete(operation),
    );
    return operation;
  }

  async function finishCallback(input: unknown): Promise<CallbackOutcome> {
    if (closed) return "failed";
    cleanExpired();
    if (!isValidCallback(input)) return "failed";
    const candidate = pendingByState.get(input.state);
    if (!candidate || !constantTimeStateEqual(input.state, candidate.state)) return "failed";
    // Claim before network or durable work. A denial, failure, or uncertain
    // exchange consumes this single-use state permanently.
    pendingByState.delete(candidate.state);
    let terminalState: "denied" | "failed" = "failed";
    let connected = false;
    try {
      if (
        now() >= candidate.expiresAt ||
        candidate.bootId !== bootId ||
        candidate.sessionId !== sessionId ||
        !validOwner(candidate.owner, config.owner)
      ) {
        return "failed";
      }
      if ("denied" in input && input.denied === true) {
        terminalState = "denied";
        return "denied";
      }
      if (!("code" in input)) return "failed";
      if (config.developmentMode) return "failed";
      if (activeExchanges >= MAX_CONCURRENT_EXCHANGES) return "failed";

      activeExchanges += 1;
      try {
        return await runConnectionLock(candidate.connectionId, async () => {
          if (closed || locallyDisabledConnections.has(candidate.connectionId)) return "failed";
          const current = await readConnection(candidate.connectionId);
          if (closed || locallyDisabledConnections.has(candidate.connectionId)) return "failed";
          if (candidate.replaceRecord) {
            if (
              !current ||
              current.generation !== candidate.replaceRecord.generation ||
              current.accountId !== candidate.replaceRecord.accountId
            ) {
              return "failed";
            }
          } else if (current) {
            return "failed";
          }

          const tokenResponse = await transport.exchange({ code: input.code, verifier: candidate.verifier });
          if (closed || locallyDisabledConnections.has(candidate.connectionId)) return "failed";
          const issuedAt = now();
          const token = validateTokenResult(tokenResponse, issuedAt, "authorization_code_response");
          if (!token.grants.scopes.includes("shops_r")) return "failed";
          const identity = await transport.getMe(token.accessToken);
          if (
            closed ||
            locallyDisabledConnections.has(candidate.connectionId) ||
            !identity ||
            !Number.isSafeInteger(identity.accountId) ||
            identity.accountId <= 0 ||
            identity.accountId !== token.accountId ||
            (identity.shopId !== undefined && (!Number.isSafeInteger(identity.shopId) || identity.shopId <= 0)) ||
            (candidate.replaceRecord && identity.accountId !== candidate.replaceRecord.accountId)
          ) {
            return "failed";
          }
          if (closed) return "failed";
          const allRequestedGranted = candidate.requestedScopes.every((scope) => token.grants.scopes.includes(scope));
          const record: ConnectionRecord = {
            connectionId: candidate.connectionId,
            owner: config.owner,
            accountId: identity.accountId,
            ...(identity.shopId === undefined ? {} : { shopId: identity.shopId }),
            generation: candidate.replaceRecord ? candidate.replaceRecord.generation + 1 : 1,
            ...(candidate.label === undefined ? {} : { label: candidate.label }),
            state: allRequestedGranted ? "connected" : "connected_limited",
            ...(!allRequestedGranted ? { reason: "scope_missing" } : {}),
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
            issuedAt,
            expiresAt: token.expiresAt,
            requestedScopes: candidate.requestedScopes,
            grants: token.grants,
          };
          await store.put(record, candidate.replaceRecord ? candidate.replaceRecord.generation : null);
          if (locallyDisabledConnections.has(candidate.connectionId)) return "failed";
          if (closed) {
            try {
              if (candidate.replaceRecord) {
                await store.put(
                  { ...candidate.replaceRecord, generation: record.generation + 1 },
                  record.generation,
                );
              } else {
                await store.remove(record.connectionId, record.generation);
              }
            } catch {
              shutdownCleanupFailed = true;
              // The durable write may have committed even though its compensating
              // action failed. Fence the entire protected store before runtime
              // cleanup is allowed to release its process lock.
              try {
                await store.markRecoveryRequired();
              } catch {
                shutdownCleanupFailed = true;
              }
            }
            return "failed";
          }
          connected = true;
          return "complete";
        });
      } catch {
        return "failed";
      } finally {
        activeExchanges -= 1;
      }
    } finally {
      pendingConnections.delete(candidate.connectionId);
      if (pendingStatuses.get(candidate.connectionId)?.state !== "disconnected") {
        if (connected) {
          pendingStatuses.delete(candidate.connectionId);
        } else {
          setTerminalStatus(
            candidate.connectionId,
            terminalState,
            candidate.requestedScopes,
            terminalState === "denied" ? "consent_denied" : "connection_failed",
          );
        }
      }
    }
  }

  async function completeCallback(input: CallbackInput): Promise<CallbackOutcome> {
    const operation = finishCallback(input);
    activeCompletions.add(operation);
    try {
      return await operation;
    } finally {
      activeCompletions.delete(operation);
    }
  }

  return Object.freeze({
    get beginAvailable() {
      return !closed && !config.developmentMode && validClientId(clientId, config.owner);
    },
    scopeInspectionAvailable,
    begin,
    completeCallback,
    status,
    disconnect,
    ensureFresh,
    withConnection,
    inspectScopes,
    close() {
      if (closePromise) return closePromise;
      closed = true;
      pendingByState.clear();
      pendingConnections.clear();
      closePromise = (async () => {
        await Promise.allSettled([
          ...activeBegins,
          ...activeCompletions,
          ...activeLifecycle,
        ]);
        if (shutdownCleanupFailed) return fail("oauth_flow_unavailable");
      })();
      return closePromise;
    },
  });
}
