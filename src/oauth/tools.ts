import type { CapabilityRegistration } from "../capabilities.js";
import type {
  Bundle,
  ConnectionStatus,
  DisconnectResult,
  OAuthService,
} from "./service.js";
import { OAuthError } from "./types.js";

const MAX_TOOL_OUTPUT_BYTES = 128 * 1024;
const READ_BUNDLES = [
  "catalog_read",
  "shop_read",
  "financial_read",
  "profile_read",
  "address_read",
] as const satisfies readonly Bundle[];
const BEGIN_PREREQUISITE = "OAuth authorization is unavailable while startup or the local development lock blocks it.";
const SCOPE_DIAGNOSTIC_PREREQUISITE = "Scope diagnostic is unavailable because the official response fields for Etsy tokenScopes are not documented.";
const CONNECTION_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const CONNECTION_STATES = new Set([
  "connected",
  "connected_limited",
  "scope_verification_required",
  "reconnect_required",
  "recovery_required",
  "pending",
  "denied",
  "expired",
  "failed",
  "disconnected",
]);
const STATUS_REASONS = new Set([
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
const STATUS_SCOPES = new Set([
  "address_r",
  "address_w",
  "email_r",
  "listings_d",
  "listings_r",
  "listings_w",
  "profile_r",
  "profile_w",
  "shops_r",
  "shops_w",
  "transactions_r",
  "transactions_w",
]);
const STATUS_CAPABILITIES = new Set([
  "account_identity",
  "catalog_read",
  "financial_read",
  "profile_read",
  "address_read",
]);
const RECONNECT_GUIDANCE = new Set([
  "Start a new Etsy authorization flow if you still want to connect this account.",
  "Start a new Etsy authorization flow before using this connection again.",
  "Start a new Etsy authorization flow to verify scopes before using this connection.",
  "Stop all possible owners and require verified offline recovery or fresh Etsy consent before reusing affected credentials.",
  "Start a new Etsy authorization flow if you want to reconnect this account.",
]);

function invalidInput(): never {
  throw new OAuthError("oauth_flow_invalid");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownDataValue(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function projectionFailure(): never {
  throw new OAuthError("connection_unavailable");
}

function parseConnectionIdArgs(value: unknown, extraKeys: readonly string[] = []): {
  connectionId: string;
  record: Record<string, unknown>;
} {
  if (!isRecord(value)) return invalidInput();
  const allowed = new Set(["connection_id", ...extraKeys]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return invalidInput();
  const connectionId = ownDataValue(value, "connection_id");
  if (typeof connectionId !== "string") return invalidInput();
  if (!CONNECTION_ID_PATTERN.test(connectionId)) projectionFailure();
  return { connectionId, record: value };
}

function projectStatus(value: unknown, expectedId: string): ConnectionStatus {
  if (!isRecord(value)) return projectionFailure();
  const connectionId = ownDataValue(value, "connection_id");
  const state = ownDataValue(value, "state");
  if (
    connectionId !== expectedId ||
    typeof state !== "string" ||
    !CONNECTION_STATES.has(state)
  ) {
    return projectionFailure();
  }

  const output: Record<string, unknown> = {
    connection_id: connectionId,
    state,
  };
  const reason = ownDataValue(value, "reason");
  if (reason !== undefined && typeof reason === "string" && STATUS_REASONS.has(reason)) {
    output.reason = reason;
  }
  for (const key of ["requested_scopes", "granted_scopes"] as const) {
    const scopes = ownDataValue(value, key);
    if (scopes === undefined) continue;
    if (
      !Array.isArray(scopes) ||
      scopes.length > 32 ||
      scopes.some((scope) => typeof scope !== "string" || !STATUS_SCOPES.has(scope)) ||
      new Set(scopes).size !== scopes.length
    ) {
      return projectionFailure();
    }
    output[key] = [...scopes];
  }
  const capabilities = ownDataValue(value, "enabled_capabilities");
  if (capabilities !== undefined) {
    if (
      !Array.isArray(capabilities) ||
      capabilities.length > STATUS_CAPABILITIES.size ||
      capabilities.some((capability) => typeof capability !== "string" || !STATUS_CAPABILITIES.has(capability)) ||
      new Set(capabilities).size !== capabilities.length
    ) {
      return projectionFailure();
    }
    output.enabled_capabilities = [...capabilities];
  }
  for (const key of ["account_id", "shop_id"] as const) {
    const id = ownDataValue(value, key);
    if (id === undefined) continue;
    if (!Number.isSafeInteger(id) || Number(id) <= 0) return projectionFailure();
    output[key] = id;
  }
  const expiresAt = ownDataValue(value, "expires_at");
  if (expiresAt !== undefined) {
    if (!Number.isSafeInteger(expiresAt) || Number(expiresAt) < 946_684_800_000 || Number(expiresAt) > 4_102_444_800_000) {
      return projectionFailure();
    }
    output.expires_at = expiresAt;
  }
  const guidance = ownDataValue(value, "reconnect_guidance");
  if (guidance !== undefined && typeof guidance === "string" && RECONNECT_GUIDANCE.has(guidance)) {
    output.reconnect_guidance = guidance;
  }
  return output as unknown as ConnectionStatus;
}

function projectDisconnectResult(value: unknown, expectedId: string): DisconnectResult {
  if (!isRecord(value)) return projectionFailure();
  const connectionId = ownDataValue(value, "connection_id");
  const state = ownDataValue(value, "state");
  const localCredentialsRemoved = ownDataValue(value, "local_credentials_removed");
  const upstreamRevoked = ownDataValue(value, "upstream_revoked");
  if (
    connectionId !== expectedId ||
    (state !== "disconnected" && state !== "recovery_required") ||
    typeof localCredentialsRemoved !== "boolean" ||
    (state === "disconnected" && !localCredentialsRemoved) ||
    (state === "recovery_required" && localCredentialsRemoved) ||
    upstreamRevoked !== false
  ) {
    return projectionFailure();
  }
  return {
    connection_id: connectionId,
    state,
    local_credentials_removed: localCredentialsRemoved,
    upstream_revoked: false,
  };
}

function projectScopeInspection(value: unknown): { scopes: string[]; checked_at: number } {
  if (!isRecord(value) || Object.keys(value).length !== 2) return projectionFailure();
  const scopes = ownDataValue(value, "scopes");
  const checkedAt = ownDataValue(value, "checked_at");
  if (
    !Array.isArray(scopes) ||
    scopes.length > STATUS_SCOPES.size ||
    scopes.some((scope) => typeof scope !== "string" || !STATUS_SCOPES.has(scope)) ||
    new Set(scopes).size !== scopes.length ||
    !Number.isSafeInteger(checkedAt) ||
    Number(checkedAt) < 946_684_800_000 ||
    Number(checkedAt) > 4_102_444_800_000
  ) {
    return projectionFailure();
  }
  return { scopes: [...scopes] as string[], checked_at: Number(checkedAt) };
}

function lifecycleRegistrations(service: OAuthService): CapabilityRegistration[] {
  return [
    {
      capability: "account",
      tool: {
        name: "get_etsy_connection_status",
        description: "Read bounded local Etsy connection status; this does not refresh credentials or expose private Etsy data.",
        inputSchema: {
          type: "object",
          properties: {
            connection_id: { type: "string", pattern: "^[A-Za-z0-9_-]{22}$" },
          },
          required: ["connection_id"],
          additionalProperties: false,
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      handler: async (args) => {
        const { connectionId } = parseConnectionIdArgs(args);
        const result = projectStatus(await service.status(connectionId), connectionId);
        const text = JSON.stringify(result);
        if (Buffer.byteLength(text, "utf8") > MAX_TOOL_OUTPUT_BYTES) {
          throw new OAuthError("oauth_response_invalid");
        }
        return { content: [{ type: "text", text }] };
      },
    },
    {
      capability: "account",
      tool: {
        name: "disconnect_etsy_connection",
        description: "Disable and remove local Etsy credentials after explicit confirmation; Etsy-side token revocation is not performed.",
        inputSchema: {
          type: "object",
          properties: {
            connection_id: { type: "string", pattern: "^[A-Za-z0-9_-]{22}$" },
            confirm_local_disconnect: { type: "boolean", const: true },
          },
          required: ["connection_id", "confirm_local_disconnect"],
          additionalProperties: false,
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      handler: async (args) => {
        const { connectionId, record } = parseConnectionIdArgs(args, ["confirm_local_disconnect"]);
        if (ownDataValue(record, "confirm_local_disconnect") !== true) return invalidInput();
        const result = projectDisconnectResult(await service.disconnect(connectionId), connectionId);
        const text = JSON.stringify(result);
        if (Buffer.byteLength(text, "utf8") > MAX_TOOL_OUTPUT_BYTES) {
          throw new OAuthError("oauth_response_invalid");
        }
        return { content: [{ type: "text", text }] };
      },
    },
    {
      capability: "account",
      available: service.scopeInspectionAvailable === true,
      prerequisite: SCOPE_DIAGNOSTIC_PREREQUISITE,
      tool: {
        name: "get_etsy_token_scopes",
        description: "Inspect documented scopes for a connected Etsy token; the credential is resolved internally.",
        inputSchema: {
          type: "object",
          properties: {
            connection_id: { type: "string", pattern: "^[A-Za-z0-9_-]{22}$" },
          },
          required: ["connection_id"],
          additionalProperties: false,
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      handler: async (args) => {
        const { connectionId } = parseConnectionIdArgs(args);
        const result = projectScopeInspection(await service.inspectScopes(connectionId));
        const text = JSON.stringify(result);
        if (Buffer.byteLength(text, "utf8") > MAX_TOOL_OUTPUT_BYTES) {
          throw new OAuthError("oauth_response_invalid");
        }
        return { content: [{ type: "text", text }] };
      },
    },
  ];
}

function parseBeginArgs(value: unknown): {
  bundles: readonly Bundle[];
  label?: string;
  replaceConnectionId?: string;
} {
  if (!isRecord(value)) return invalidInput();
  const allowed = new Set(["bundles", "label", "replace_connection_id"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return invalidInput();
  if (!Array.isArray(value.bundles) || value.bundles.length > 9) return invalidInput();
  const bundles = value.bundles.map((bundle) => {
    if (typeof bundle !== "string" || !READ_BUNDLES.includes(bundle as (typeof READ_BUNDLES)[number])) {
      return invalidInput();
    }
    return bundle as Bundle;
  });
  if (new Set(bundles).size !== bundles.length) return invalidInput();
  if (
    value.label !== undefined &&
    (typeof value.label !== "string" ||
      value.label.length === 0 ||
      value.label.length > 100 ||
      value.label.trim() !== value.label ||
      /[\u0000-\u001f\u007f]/.test(value.label))
  ) {
    return invalidInput();
  }
  if (
    value.replace_connection_id !== undefined &&
    (typeof value.replace_connection_id !== "string" ||
      !/^[A-Za-z0-9_-]{22}$/.test(value.replace_connection_id))
  ) {
    return invalidInput();
  }
  return {
    bundles,
    ...(value.label === undefined ? {} : { label: value.label as string }),
    ...(value.replace_connection_id === undefined
      ? {}
      : { replaceConnectionId: value.replace_connection_id as string }),
  };
}

export function createOAuthRegistrations(
  service: OAuthService,
  stage: "connect" | "lifecycle",
): CapabilityRegistration[] {
  if (stage === "lifecycle") return lifecycleRegistrations(service);
  return [{
    capability: "account",
    available: service.beginAvailable,
    prerequisite: BEGIN_PREREQUISITE,
    tool: {
      name: "begin_etsy_connection",
      description: "Start an Etsy account authorization flow for selected read capabilities.",
      inputSchema: {
        type: "object",
        properties: {
          bundles: {
            type: "array",
            items: { type: "string", enum: [...READ_BUNDLES] },
            maxItems: 9,
            uniqueItems: true,
          },
          label: { type: "string", minLength: 1, maxLength: 100 },
          replace_connection_id: { type: "string", pattern: "^[A-Za-z0-9_-]{22}$" },
        },
        required: ["bundles"],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    handler: async (args) => {
      const input = parseBeginArgs(args);
      const result = await service.begin(input);
      const text = JSON.stringify(result);
      if (Buffer.byteLength(text, "utf8") > MAX_TOOL_OUTPUT_BYTES) {
        throw new OAuthError("oauth_response_invalid");
      }
      return { content: [{ type: "text", text }] };
    },
  }];
}
