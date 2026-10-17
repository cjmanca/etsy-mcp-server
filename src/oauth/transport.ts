import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import { EtsyApiError, validateApiKey, MAX_UPSTREAM_RESPONSE_BYTES, REQUEST_TIMEOUT_MS } from "../etsy-client.js";
import {
  RequestQueueFullError,
  runAtLimitedDispatch,
  type RequestLimiter,
} from "../request-limiter.js";
import { OAuthError, type OAuthConfig, type ScopeEvidence } from "./types.js";
import { parseGrantedScopes } from "./scopes.js";

const TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";
const GET_ME_URL = "https://openapi.etsy.com/v3/application/users/me";
const MAX_TOKEN_BYTES = 16 * 1024;
const MAX_TOKEN_LIFETIME_SECONDS = 366 * 24 * 60 * 60;
const TOKEN_PATTERN = /^([1-9][0-9]{0,15})\.[\x21-\x7e]+$/;
const CODE_PATTERN = /^[\x21-\x7e]{1,2048}$/;
const VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;

export interface TokenResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  grants: ScopeEvidence;
}

export interface OAuthTransport {
  exchange(input: { code: string; verifier: string }): Promise<TokenResult>;
  refresh(refreshToken: string): Promise<TokenResult>;
  getMe(accessToken: string): Promise<{ accountId: number; shopId?: number }>;
}

type FixedOperation = Readonly<{
  method: "GET" | "POST";
  url: string;
  operation: "token" | "identity";
}>;

const TOKEN_OPERATION: FixedOperation = Object.freeze({
  method: "POST",
  url: TOKEN_URL,
  operation: "token",
});
const IDENTITY_OPERATION: FixedOperation = Object.freeze({
  method: "GET",
  url: GET_ME_URL,
  operation: "identity",
});

function invalidResponse(): never {
  throw new OAuthError("oauth_response_invalid");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownValue(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function getHeader(config: InternalAxiosRequestConfig, name: string): unknown {
  const headers = config.headers as unknown as { get?: (key: string) => unknown } & Record<string, unknown>;
  return headers.get?.(name) ?? headers[name.toLowerCase()];
}

function assertFinalDispatch(
  config: InternalAxiosRequestConfig,
  operation: FixedOperation,
  apiKey: string,
): void {
  const method = typeof config.method === "string" ? config.method.toUpperCase() : "";
  if (
    method !== operation.method ||
    config.url !== operation.url ||
    config.baseURL !== undefined ||
    config.timeout !== REQUEST_TIMEOUT_MS ||
    config.maxRedirects !== 0 ||
    config.maxContentLength !== MAX_UPSTREAM_RESPONSE_BYTES ||
    config.maxBodyLength !== MAX_UPSTREAM_RESPONSE_BYTES ||
    config.proxy !== false ||
    config.httpAgent !== undefined ||
    config.httpsAgent !== undefined ||
    config.transport !== undefined ||
    config.socketPath !== undefined ||
    config.lookup !== undefined ||
    config.auth !== undefined ||
    getHeader(config, "host") !== undefined ||
    getHeader(config, "x-api-key") !== apiKey
  ) {
    throw new OAuthError("oauth_request_failed");
  }

  if (operation.operation === "token") {
    if (
      getHeader(config, "authorization") !== undefined ||
      getHeader(config, "content-type") !== "application/x-www-form-urlencoded" ||
      typeof config.data !== "string" ||
      config.data.length > MAX_UPSTREAM_RESPONSE_BYTES ||
      config.params !== undefined
    ) {
      throw new OAuthError("oauth_request_failed");
    }
  } else if (
    getHeader(config, "authorization") === undefined ||
    config.data !== undefined ||
    config.params !== undefined
  ) {
    throw new OAuthError("oauth_request_failed");
  }
}

function createFixedClient(
  operation: FixedOperation,
  apiKey: string,
  limiter: RequestLimiter,
): AxiosInstance {
  const client = axios.create({
    timeout: REQUEST_TIMEOUT_MS,
    maxRedirects: 0,
    maxContentLength: MAX_UPSTREAM_RESPONSE_BYTES,
    maxBodyLength: MAX_UPSTREAM_RESPONSE_BYTES,
    proxy: false,
    headers: { Accept: "application/json" },
  });
  const adapter = axios.getAdapter(client.defaults.adapter);
  client.defaults.adapter = (config) => runAtLimitedDispatch(
    limiter,
    () => assertFinalDispatch(config, operation, apiKey),
    () => Promise.resolve(adapter(config)),
  );
  return client;
}

function safeRequestError(error: unknown): OAuthError {
  if (error instanceof OAuthError) return error;
  if (error instanceof RequestQueueFullError || (error instanceof EtsyApiError && error.category === "busy")) {
    return new OAuthError("request_queue_full");
  }
  if (
    axios.isAxiosError(error) &&
    /maxContentLength size of \d+ exceeded/i.test(error.message)
  ) {
    return new OAuthError("oauth_response_invalid");
  }
  return new OAuthError("oauth_request_failed");
}

function parseCredentials(value: unknown): { full: string; clientId: string } {
  try {
    if (typeof value !== "string") return invalidResponse();
    const full = validateApiKey(value);
    const separator = full.indexOf(":");
    return { full, clientId: full.slice(0, separator) };
  } catch {
    return invalidResponse();
  }
}

function validateOpaqueToken(value: unknown): { token: string; accountId: number; prefix: string } {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > MAX_TOKEN_BYTES ||
    !/^[\x21-\x7e]+$/.test(value)
  ) {
    return invalidResponse();
  }
  const match = TOKEN_PATTERN.exec(value);
  if (!match) return invalidResponse();
  const accountId = Number(match[1]);
  if (!Number.isSafeInteger(accountId) || accountId <= 0) return invalidResponse();
  return { token: value, accountId, prefix: match[1] };
}

function parseTokenResponse(value: unknown, source: "authorization_code_response" | "refresh_response", now: () => number): TokenResult {
  try {
    if (!isRecord(value)) return invalidResponse();
    const access = validateOpaqueToken(ownValue(value, "access_token"));
    const refresh = validateOpaqueToken(ownValue(value, "refresh_token"));
    const tokenType = ownValue(value, "token_type");
    const expiresIn = ownValue(value, "expires_in");
    const scope = ownValue(value, "scope");
    if (
      tokenType !== "Bearer" ||
      access.prefix !== refresh.prefix ||
      !Number.isSafeInteger(expiresIn) ||
      Number(expiresIn) <= 0 ||
      Number(expiresIn) > MAX_TOKEN_LIFETIME_SECONDS
    ) {
      return invalidResponse();
    }
    const grants = parseGrantedScopes(scope, source, now());
    return {
      accessToken: access.token,
      refreshToken: refresh.token,
      expiresIn: Number(expiresIn),
      grants,
    };
  } catch (error) {
    if (error instanceof OAuthError) throw error;
    return invalidResponse();
  }
}

function validInputString(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value);
}

function safeIdentity(value: unknown): { accountId: number; shopId?: number } {
  try {
    if (!isRecord(value)) throw new OAuthError("oauth_identity_invalid");
    const accountId = ownValue(value, "user_id");
    const shopId = ownValue(value, "shop_id");
    if (!Number.isSafeInteger(accountId) || Number(accountId) <= 0) {
      throw new OAuthError("oauth_identity_invalid");
    }
    if (shopId !== undefined && (!Number.isSafeInteger(shopId) || Number(shopId) <= 0)) {
      throw new OAuthError("oauth_identity_invalid");
    }
    return {
      accountId: Number(accountId),
      ...(shopId === undefined ? {} : { shopId: Number(shopId) }),
    };
  } catch (error) {
    if (error instanceof OAuthError) throw error;
    throw new OAuthError("oauth_identity_invalid");
  }
}

function sanitizeAxiosResponse<T>(response: AxiosResponse<T>): T {
  return response.data;
}

export function createOAuthTransport(
  config: OAuthConfig,
  apiKey: string,
  limiter: RequestLimiter,
  deps?: { now: () => number },
): OAuthTransport {
  const now = deps?.now ?? Date.now;

  async function postToken(fields: URLSearchParams): Promise<unknown> {
    // Preserve M0.4: a locked process rejects before parsing credentials,
    // building credential-bearing headers/body, using the limiter, or dispatch.
    if (config.developmentMode) throw new OAuthError("development_mode_locked");
    const credentials = parseCredentials(apiKey);
    const body = fields.toString();
    if (body.length > MAX_UPSTREAM_RESPONSE_BYTES) return invalidResponse();
    const client = createFixedClient(TOKEN_OPERATION, credentials.full, limiter);
    try {
      const response = await client.post<unknown>(TOKEN_URL, body, {
        headers: {
          "x-api-key": credentials.full,
          "content-type": "application/x-www-form-urlencoded",
        },
      });
      return sanitizeAxiosResponse(response);
    } catch (error) {
      throw safeRequestError(error);
    }
  }

  return Object.freeze({
    async exchange(input: { code: string; verifier: string }) {
      if (config.developmentMode) throw new OAuthError("development_mode_locked");
      if (
        !input ||
        !validInputString(input.code, CODE_PATTERN) ||
        !validInputString(input.verifier, VERIFIER_PATTERN)
      ) {
        throw new OAuthError("oauth_flow_invalid");
      }
      const credentials = parseCredentials(apiKey);
      const fields = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: credentials.clientId,
        redirect_uri: config.redirectUri,
        code: input.code,
        code_verifier: input.verifier,
      });
      const response = await postToken(fields);
      return parseTokenResponse(response, "authorization_code_response", now);
    },

    async refresh(refreshToken: string) {
      if (config.developmentMode) throw new OAuthError("development_mode_locked");
      const token = validateOpaqueToken(refreshToken);
      const credentials = parseCredentials(apiKey);
      const fields = new URLSearchParams({
        grant_type: "refresh_token",
        client_id: credentials.clientId,
        refresh_token: token.token,
      });
      const response = await postToken(fields);
      const result = parseTokenResponse(response, "refresh_response", now);
      if (validateOpaqueToken(result.accessToken).prefix !== token.prefix) {
        throw new OAuthError("oauth_identity_invalid");
      }
      return result;
    },

    async getMe(accessToken: string) {
      const token = validateOpaqueToken(accessToken);
      const credentials = parseCredentials(apiKey);
      const client = createFixedClient(IDENTITY_OPERATION, credentials.full, limiter);
      try {
        const response = await client.get<unknown>(GET_ME_URL, {
          headers: {
            "x-api-key": credentials.full,
            authorization: `Bearer ${token.token}`,
          },
        });
        return safeIdentity(sanitizeAxiosResponse(response));
      } catch (error) {
        if (error instanceof OAuthError) throw error;
        throw safeRequestError(error);
      }
    },
  });
}
