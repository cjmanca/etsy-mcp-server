import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { OAuthTransport } from "./transport.js";
import { parseGrantedScopes } from "./scopes.js";
import {
  OAuthError,
  type ConnectionRecord,
  type ConnectionStore,
  type OAuthConfig,
  type Scope,
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

export type CallbackInput = { state: string; code: string } | { state: string; denied: true };
export type CallbackOutcome = "complete" | "denied" | "failed";

export interface OAuthService {
  readonly beginAvailable: boolean;
  begin(input: BeginInput): Promise<BeginResult>;
  completeCallback(input: CallbackInput): Promise<CallbackOutcome>;
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
const CONNECTION_ID = /^[A-Za-z0-9_-]{22}$/;
const STATE_OR_VERIFIER = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_PATTERN = /^([1-9][0-9]{0,15})\.[\x21-\x7e]+$/;
const CODE_PATTERN = /^[\x21-\x7e]{1,2048}$/;

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

function validateTokenResult(value: unknown, now: number): {
  accessToken: string;
  refreshToken: string;
  accountId: number;
  expiresAt: number;
  grants: ReturnType<typeof parseGrantedScopes>;
} {
  try {
    if (value === null || typeof value !== "object") return fail("oauth_response_invalid");
    const token = value as Record<string, unknown>;
    const access = tokenAccountId(token.accessToken);
    const refresh = tokenAccountId(token.refreshToken);
    const prefix = access.token.slice(0, access.token.indexOf("."));
    const refreshPrefix = refresh.token.slice(0, refresh.token.indexOf("."));
    if (
      access.accountId !== refresh.accountId ||
      prefix !== refreshPrefix ||
      !Number.isSafeInteger(token.expiresIn) ||
      Number(token.expiresIn) <= 0 ||
      Number(token.expiresIn) > MAX_TOKEN_LIFETIME_SECONDS ||
      !validEpoch(now)
    ) {
      return fail("oauth_response_invalid");
    }
    const grants = token.grants as { scopes?: unknown; source?: unknown; checkedAt?: unknown } | undefined;
    if (
      !grants ||
      !Array.isArray(grants.scopes) ||
      (grants.source !== "authorization_code_response" && grants.source !== "refresh_response") ||
      !validEpoch(grants.checkedAt)
    ) {
      return fail("oauth_scope_invalid");
    }
    const scopeText = grants.scopes.join(" ");
    const parsedGrants = parseGrantedScopes(scopeText, grants.source, grants.checkedAt);
    const expiresAt = now + Number(token.expiresIn) * 1_000;
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
  const activeBegins = new Set<Promise<BeginResult>>();
  const activeCompletions = new Set<Promise<CallbackOutcome>>();
  let activeExchanges = 0;
  let beginReservations = 0;
  let closed = false;
  let shutdownCleanupFailed = false;
  let closePromise: Promise<void> | undefined;

  function cleanExpired(currentTime = now()): void {
    for (const [state, pending] of pendingByState) {
      if (currentTime >= pending.expiresAt) {
        pendingByState.delete(state);
        pendingConnections.delete(pending.connectionId);
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
    try {
      if (
        now() >= candidate.expiresAt ||
        candidate.bootId !== bootId ||
        candidate.sessionId !== sessionId ||
        !validOwner(candidate.owner, config.owner)
      ) {
        return "failed";
      }
      if ("denied" in input && input.denied === true) return "denied";
      if (!("code" in input)) return "failed";
      if (config.developmentMode) return "failed";
      if (activeExchanges >= MAX_CONCURRENT_EXCHANGES) return "failed";

      activeExchanges += 1;
      try {
        const tokenResponse = await transport.exchange({ code: input.code, verifier: candidate.verifier });
        if (closed) return "failed";
        const issuedAt = now();
        const token = validateTokenResult(tokenResponse, issuedAt);
        if (!token.grants.scopes.includes("shops_r")) return "failed";
        const identity = await transport.getMe(token.accessToken);
        if (
          closed ||
          !identity ||
          !Number.isSafeInteger(identity.accountId) ||
          identity.accountId <= 0 ||
          identity.accountId !== token.accountId ||
          (identity.shopId !== undefined && (!Number.isSafeInteger(identity.shopId) || identity.shopId <= 0))
        ) {
          return "failed";
        }
        if (candidate.replaceRecord) {
          const current = await readConnection(candidate.connectionId);
          if (
            closed ||
            !current ||
            current.generation !== candidate.replaceRecord.generation ||
            current.accountId !== identity.accountId
          ) {
            return "failed";
          }
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
        return "complete";
      } catch {
        return "failed";
      } finally {
        activeExchanges -= 1;
      }
    } finally {
      pendingConnections.delete(candidate.connectionId);
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
    begin,
    completeCallback,
    close() {
      if (closePromise) return closePromise;
      closed = true;
      pendingByState.clear();
      pendingConnections.clear();
      closePromise = (async () => {
        await Promise.allSettled([...activeBegins, ...activeCompletions]);
        if (shutdownCleanupFailed) return fail("oauth_flow_unavailable");
      })();
      return closePromise;
    },
  });
}
