import { parseGrantedScopes } from "./scopes.js";
import { OAuthError, type ConnectionRecord, type OwnerContext, type Scope } from "./types.js";

export interface OperationRequirement {
  readonly scopes: readonly Scope[];
  readonly capability: "account" | "write";
  readonly resource: "account" | "shop" | "verified_relationship";
}

export interface AuthorizationInput {
  readonly record: ConnectionRecord;
  readonly owner: OwnerContext;
  readonly currentGeneration: number;
  readonly required: OperationRequirement;
  readonly enabledCapabilities: readonly string[];
  readonly requestedShopId?: number;
  readonly relationshipVerified: boolean;
  readonly developmentMode: boolean;
}

const TOKEN_SCOPE_SOURCES = new Set([
  "authorization_code_response",
  "refresh_response",
]);
const MIN_EPOCH_MS = 946_684_800_000;
const MAX_EPOCH_MS = 4_102_444_800_000;

function denied(): never {
  throw new OAuthError("oauth_operation_not_authorized");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownValue(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function validScopeList(value: unknown, checkedAt: number): readonly Scope[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 32 ||
    value.some((scope) => typeof scope !== "string")
  ) {
    return undefined;
  }
  try {
    return parseGrantedScopes(
      (value as string[]).join(" "),
      "authorization_code_response",
      checkedAt,
    ).scopes;
  } catch {
    return undefined;
  }
}

function validOwner(value: unknown): value is OwnerContext {
  if (!isPlainRecord(value)) return false;
  const operatorId = ownValue(value, "operatorId");
  const appFingerprint = ownValue(value, "appFingerprint");
  return (
    Object.keys(value).length === 2 &&
    typeof operatorId === "string" &&
    operatorId.length > 0 &&
    operatorId.length <= 64 &&
    typeof appFingerprint === "string" &&
    /^[a-f0-9]{64}$/.test(appFingerprint)
  );
}

function validateInput(value: unknown): AuthorizationInput {
  if (!isPlainRecord(value)) return denied();

  const record = ownValue(value, "record");
  const recordOwner = isPlainRecord(record) ? ownValue(record, "owner") : undefined;
  const owner = ownValue(value, "owner");
  const currentGeneration = ownValue(value, "currentGeneration");
  const required = ownValue(value, "required");
  const enabledCapabilities = ownValue(value, "enabledCapabilities");
  const requestedShopId = ownValue(value, "requestedShopId");
  const relationshipVerified = ownValue(value, "relationshipVerified");
  const developmentMode = ownValue(value, "developmentMode");

  if (
    !isPlainRecord(record) ||
    !validOwner(owner) ||
    !validOwner(recordOwner) ||
    !Number.isSafeInteger(currentGeneration) ||
    Number(currentGeneration) <= 0 ||
    !isPlainRecord(required) ||
    !Array.isArray(enabledCapabilities) ||
    enabledCapabilities.length > 16 ||
    enabledCapabilities.some((capability) => typeof capability !== "string") ||
    new Set(enabledCapabilities).size !== enabledCapabilities.length ||
    (requestedShopId !== undefined &&
      (!Number.isSafeInteger(requestedShopId) || Number(requestedShopId) <= 0)) ||
    typeof relationshipVerified !== "boolean" ||
    typeof developmentMode !== "boolean"
  ) {
    return denied();
  }

  if (
    ownValue(record, "generation") !== currentGeneration ||
    recordOwner.operatorId !== owner.operatorId ||
    recordOwner.appFingerprint !== owner.appFingerprint
  ) {
    return denied();
  }

  const accountId = ownValue(record, "accountId");
  const state = ownValue(record, "state");
  const grants = ownValue(record, "grants");
  const requestedScopesValue = ownValue(record, "requestedScopes");
  if (
    !Number.isSafeInteger(accountId) ||
    Number(accountId) <= 0 ||
    (state !== "connected" && state !== "connected_limited") ||
    !isPlainRecord(grants)
  ) {
    return denied();
  }

  const grantSource = ownValue(grants, "source");
  const checkedAt = ownValue(grants, "checkedAt");
  if (
    typeof grantSource !== "string" ||
    !TOKEN_SCOPE_SOURCES.has(grantSource) ||
    !Number.isSafeInteger(checkedAt) ||
    Number(checkedAt) < MIN_EPOCH_MS ||
    Number(checkedAt) > MAX_EPOCH_MS
  ) {
    return denied();
  }

  const grantedScopes = validScopeList(ownValue(grants, "scopes"), Number(checkedAt));
  const requestedScopes = validScopeList(requestedScopesValue, Number(checkedAt));
  if (!grantedScopes || !requestedScopes) return denied();

  const requiredScopes = validScopeList(ownValue(required, "scopes"), Number(checkedAt));
  const capability = ownValue(required, "capability");
  const resource = ownValue(required, "resource");
  if (
    !requiredScopes ||
    (capability !== "account" && capability !== "write") ||
    (resource !== "account" && resource !== "shop" && resource !== "verified_relationship") ||
    Object.keys(required).length !== 3
  ) {
    return denied();
  }

  const enabled = new Set(enabledCapabilities as string[]);
  // Write tools depend on the account capability, independently of Etsy scopes.
  if (
    !enabled.has(capability) ||
    (capability === "write" && !enabled.has("account"))
  ) {
    return denied();
  }
  if (capability === "write" && developmentMode) {
    throw new OAuthError("development_mode_locked");
  }

  // The exact operation scopes must be both actually granted and consent-requested;
  // configured capability only enables the handler group and never supplies scopes.
  const granted = new Set(grantedScopes);
  const requested = new Set(requestedScopes);
  if (requiredScopes.some((scope) => !granted.has(scope) || !requested.has(scope))) {
    return denied();
  }

  if (resource === "account") {
    if (requestedShopId !== undefined || !validOwner(owner)) return denied();
  } else if (resource === "shop") {
    const shopId = ownValue(record, "shopId");
    if (
      requestedShopId === undefined ||
      !Number.isSafeInteger(shopId) ||
      Number(shopId) <= 0 ||
      shopId !== requestedShopId
    ) {
      return denied();
    }
  } else {
    if (relationshipVerified !== true) return denied();
    if (requestedShopId !== undefined && ownValue(record, "shopId") !== requestedShopId) {
      return denied();
    }
  }

  return value as unknown as AuthorizationInput;
}

/**
 * Enforce connection, grant, configured-capability, and resource boundaries for
 * one server-defined operation. Call inside OAuthService.withConnection so token
 * freshness, generation serialization, and disconnect invalidation are current.
 * Passing this guard does not authorize or confirm a mutation; writes still need
 * the separate M5 operation-specific action/confirmation gate.
 */
export function authorizeOperation(input: AuthorizationInput): void {
  try {
    validateInput(input);
  } catch (error) {
    if (error instanceof OAuthError && error.reason === "development_mode_locked") throw error;
    if (error instanceof OAuthError && error.reason === "oauth_operation_not_authorized") throw error;
    return denied();
  }
}
