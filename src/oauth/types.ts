export type Scope = string;

export type OwnerContext = Readonly<{
  operatorId: string;
  appFingerprint: string;
}>;

export type ScopeEvidence = Readonly<{
  scopes: readonly Scope[];
  source: "authorization_code_response" | "refresh_response" | "diagnostic";
  checkedAt: number;
}>;

export type ConnectionState =
  | "connected"
  | "connected_limited"
  | "scope_verification_required"
  | "reconnect_required"
  | "recovery_required";

export interface ConnectionRecord {
  connectionId: string;
  owner: OwnerContext;
  accountId: number;
  shopId?: number;
  generation: number;
  label?: string;
  state: ConnectionState;
  reason?: string;
  accessToken: string;
  refreshToken: string;
  issuedAt: number;
  expiresAt: number;
  requestedScopes: readonly Scope[];
  grants: ScopeEvidence;
}

export interface ConnectionStore {
  read(id: string): Promise<ConnectionRecord | undefined>;
  put(record: ConnectionRecord, expectedGeneration: number | null): Promise<void>;
  remove(id: string, expectedGeneration: number): Promise<void>;
  markRecoveryRequired(): Promise<void>;
  close(): Promise<void>;
}

export interface OAuthConfig {
  owner: OwnerContext;
  dataDir: string;
  keyFile: string;
  redirectUri: string;
  callbackHost: string;
  callbackPort: number;
  trustedProxyIps: readonly string[];
  developmentMode: boolean;
}

export type OAuthSettings =
  | { enabled: false }
  | { enabled: true; config: OAuthConfig };

export type OAuthErrorReason =
  | "invalid_configuration"
  | "storage_permissions"
  | "storage_unavailable"
  | "storage_conflict"
  | "storage_corrupt"
  | "storage_recovery_required"
  | "generation_conflict"
  | "record_invalid"
  | "key_invalid"
  | "store_closed"
  | "store_write_failed"
  | "development_mode_locked"
  | "request_queue_full"
  | "oauth_request_failed"
  | "oauth_response_invalid"
  | "oauth_scope_invalid"
  | "oauth_identity_invalid"
  | "oauth_flow_invalid"
  | "oauth_flow_unavailable"
  | "oauth_store_failed"
  | "connection_unavailable"
  | "oauth_token_expired"
  | "oauth_reconnect_required"
  | "oauth_operation_not_authorized"
  | "oauth_scope_diagnostic_unavailable"
  | "callback_bind_failed";

export type OAuthStorageDiagnosticCode =
  | "untrusted_ancestor_owner"
  | "untrusted_ancestor_mode"
  | "untrusted_ancestor_acl"
  | "untrusted_leaf_owner"
  | "untrusted_leaf_acl"
  | "required_key_read_missing"
  | "required_data_modify_missing"
  | "required_store_modify_missing"
  | "required_marker_modify_missing"
  | "reparse_point"
  | "filesystem_unsupported"
  | "acl_inspection_unavailable"
  | "object_identity_unavailable"
  | "object_identity_mismatch";

export type OAuthStorageDiagnostic = Readonly<{
  platform: "windows" | "posix";
  entry: "ancestor" | "data" | "key" | "store" | "marker";
  code: OAuthStorageDiagnosticCode;
}>;

const SAFE_ERROR_MESSAGES: Readonly<Record<OAuthErrorReason, string>> = {
  invalid_configuration: "OAuth configuration is invalid.",
  storage_permissions: "OAuth storage permissions are not sufficiently protected.",
  storage_unavailable: "OAuth storage is unavailable on this filesystem.",
  storage_conflict: "OAuth storage is already owned by another process.",
  storage_corrupt: "OAuth storage cannot be authenticated or validated.",
  storage_recovery_required: "OAuth storage requires offline recovery.",
  generation_conflict: "OAuth connection changed; reload it before updating.",
  record_invalid: "OAuth connection data is invalid.",
  key_invalid: "The separately provisioned OAuth key is unavailable or invalid.",
  store_closed: "OAuth storage is closed.",
  store_write_failed: "OAuth storage could not durably save the update.",
  development_mode_locked: "OAuth POST requests are blocked by the local development lock.",
  request_queue_full: "The Etsy request queue is full. Try again shortly.",
  oauth_request_failed: "The OAuth request could not be completed safely.",
  oauth_response_invalid: "Etsy returned an invalid OAuth response.",
  oauth_scope_invalid: "Etsy returned invalid granted-scope evidence.",
  oauth_identity_invalid: "The authorized Etsy account could not be verified.",
  oauth_flow_invalid: "The OAuth authorization flow is invalid or expired.",
  oauth_flow_unavailable: "OAuth authorization is not available until startup prerequisites are ready.",
  oauth_store_failed: "The OAuth connection could not be durably saved.",
  connection_unavailable: "The requested Etsy connection is unavailable.",
  oauth_token_expired: "The Etsy access token expired before it could be used; start a fresh connection operation.",
  oauth_reconnect_required: "The Etsy connection requires fresh consent or offline recovery before use.",
  oauth_operation_not_authorized: "The Etsy connection is not authorized for this operation.",
  oauth_scope_diagnostic_unavailable: "Scope inspection is unavailable because Etsy's official tokenScopes response fields are not documented.",
  callback_bind_failed: "The OAuth callback listener could not bind the configured address and port.",
};

export class OAuthError extends Error {
  readonly reason: OAuthErrorReason;
  readonly storageDiagnostic?: OAuthStorageDiagnostic;

  constructor(reason: OAuthErrorReason, storageDiagnostic?: OAuthStorageDiagnostic) {
    super(SAFE_ERROR_MESSAGES[reason]);
    this.name = "OAuthError";
    this.reason = reason;
    this.storageDiagnostic = storageDiagnostic;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
