import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Duplex } from "node:stream";
import { normalizePeerIp } from "./config.js";
import type { OAuthService, CallbackInput, CallbackOutcome } from "./service.js";
import { OAuthError, type OAuthConfig } from "./types.js";

const CALLBACK_PATH = "/oauth/etsy/callback";
const MAX_REQUEST_TARGET_BYTES = 8 * 1024;
const MAX_HEADER_BYTES = 8 * 1024;
const MAX_HEADER_FIELDS = 32;
const MAX_ACTIVE_REQUESTS = 10;
const MAX_ACTIVE_EXCHANGES = 2;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_CODE_LENGTH = 2_048;
const MAX_ERROR_FIELD_LENGTH = 2_048;
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CODE_PATTERN = /^[\x21-\x7e]{1,2048}$/;
const ALLOWED_ERRORS = new Set([
  "access_denied",
  "invalid_request",
  "unauthorized_client",
  "unsupported_response_type",
  "invalid_scope",
  "server_error",
  "temporarily_unavailable",
]);

const SUCCESS_HTML = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Etsy authorization</title></head><body><p>Authorization is complete. Return to your local MCP client.</p></body></html>";
const ERROR_HTML = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Etsy authorization</title></head><body><p>This request cannot be completed. Return to your local MCP client.</p></body></html>";

export interface CallbackHandle {
  close(): Promise<void>;
}

function respond(response: ServerResponse, status: number, body: string): void {
  if (response.headersSent || response.destroyed) return;
  const bytes = Buffer.from(body, "utf8");
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": String(bytes.length),
    Connection: "close",
  });
  response.end(bytes);
}

function trustedPeer(address: unknown, allowed: ReadonlySet<string>): boolean {
  if (typeof address !== "string" || address.length === 0) return false;
  try {
    return allowed.has(normalizePeerIp(address));
  } catch {
    return false;
  }
}

function validEncodedState(value: string): boolean {
  if (!STATE_PATTERN.test(value)) return false;
  const decoded = Buffer.from(value, "base64url");
  return decoded.length === 32 && decoded.toString("base64url") === value;
}

function decodeComponent(value: string): string | undefined {
  try {
    const decoded = decodeURIComponent(value.replace(/\+/g, " "));
    if (/[\u0000-\u001f\u007f]/.test(decoded)) return undefined;
    return decoded;
  } catch {
    return undefined;
  }
}

function parseQuery(rawQuery: string): CallbackInput | undefined {
  if (rawQuery.length === 0 || rawQuery.length > MAX_REQUEST_TARGET_BYTES) return undefined;
  const parameters = new Map<string, string>();
  const parts = rawQuery.split("&");
  if (parts.length === 0 || parts.length > 5) return undefined;
  for (const part of parts) {
    if (part.length === 0) return undefined;
    const equals = part.indexOf("=");
    if (equals <= 0) return undefined;
    const name = decodeComponent(part.slice(0, equals));
    const value = decodeComponent(part.slice(equals + 1));
    if (
      name === undefined ||
      value === undefined ||
      !["state", "code", "error", "error_description", "error_uri"].includes(name) ||
      parameters.has(name)
    ) {
      return undefined;
    }
    parameters.set(name, value);
  }

  const state = parameters.get("state");
  const code = parameters.get("code");
  const error = parameters.get("error");
  const errorDescription = parameters.get("error_description");
  const errorUri = parameters.get("error_uri");
  if (!state || !validEncodedState(state)) return undefined;
  if (errorDescription !== undefined && errorDescription.length > MAX_ERROR_FIELD_LENGTH) return undefined;
  if (errorUri !== undefined && errorUri.length > MAX_ERROR_FIELD_LENGTH) return undefined;

  if (code !== undefined) {
    if (
      error !== undefined ||
      errorDescription !== undefined ||
      errorUri !== undefined ||
      code.length > MAX_CODE_LENGTH ||
      !CODE_PATTERN.test(code)
    ) {
      return undefined;
    }
    return { state, code };
  }
  if (error === undefined || !ALLOWED_ERRORS.has(error)) return undefined;
  return { state, denied: true };
}

function requestTarget(request: IncomingMessage):
  | { type: "error"; status: 400 | 404 | 405 }
  | { type: "callback"; input: CallbackInput } {
  const target = request.url;
  if (
    typeof target !== "string" ||
    Buffer.byteLength(target, "utf8") > MAX_REQUEST_TARGET_BYTES ||
    !target.startsWith("/") ||
    target.includes("#")
  ) {
    return { type: "error", status: 400 };
  }
  const queryIndex = target.indexOf("?");
  const pathname = queryIndex < 0 ? target : target.slice(0, queryIndex);
  if (pathname !== CALLBACK_PATH) return { type: "error", status: 404 };
  if (request.method !== "GET") return { type: "error", status: 405 };
  if (
    request.headers["content-length"] !== undefined ||
    request.headers["transfer-encoding"] !== undefined ||
    request.headers.expect !== undefined
  ) {
    return { type: "error", status: 400 };
  }
  const rawQuery = queryIndex < 0 ? "" : target.slice(queryIndex + 1);
  const input = parseQuery(rawQuery);
  return input ? { type: "callback", input } : { type: "error", status: 400 };
}

function loglessClientError(socket: Duplex): void {
  if (!socket.destroyed && socket.writable) {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  }
}

function isOAuthOutcome(value: unknown): value is CallbackOutcome {
  return value === "complete" || value === "denied" || value === "failed";
}

export async function startCallbackServer(
  config: OAuthConfig,
  complete: OAuthService["completeCallback"],
): Promise<CallbackHandle> {
  if (
    !config ||
    typeof config.callbackHost !== "string" ||
    !Number.isSafeInteger(config.callbackPort) ||
    config.callbackPort < 1 ||
    config.callbackPort > 65_535 ||
    !Array.isArray(config.trustedProxyIps) ||
    config.trustedProxyIps.length === 0 ||
    typeof complete !== "function"
  ) {
    throw new OAuthError("callback_bind_failed");
  }
  let allowedPeers: Set<string>;
  try {
    allowedPeers = new Set(config.trustedProxyIps.map((peer) => normalizePeerIp(peer)));
  } catch {
    throw new OAuthError("callback_bind_failed");
  }

  let activeRequests = 0;
  let activeExchanges = 0;
  let closing = false;
  const server: Server = createServer({ maxHeaderSize: MAX_HEADER_BYTES }, (request, response) => {
    // This check deliberately precedes request-target/query access. Forwarded
    // headers and Host are never an identity source.
    if (!trustedPeer(request.socket.remoteAddress, allowedPeers)) {
      respond(response, 403, ERROR_HTML);
      return;
    }
    if (closing || activeRequests >= MAX_ACTIVE_REQUESTS) {
      respond(response, 503, ERROR_HTML);
      return;
    }
    activeRequests += 1;
    const acquiredRequestSlot = true;
    void (async () => {
      let acquiredExchangeSlot = false;
      try {
        if (request.rawHeaders.length / 2 > MAX_HEADER_FIELDS) {
          respond(response, 400, ERROR_HTML);
          return;
        }
        const target = requestTarget(request);
        if (target.type === "error") {
          respond(response, target.status, ERROR_HTML);
          return;
        }
        const isExchange = "code" in target.input;
        if (isExchange && activeExchanges >= MAX_ACTIVE_EXCHANGES) {
          respond(response, 503, ERROR_HTML);
          return;
        }
        if (isExchange) {
          activeExchanges += 1;
          acquiredExchangeSlot = true;
        }
        let outcome: CallbackOutcome = "failed";
        try {
          const result = await complete(target.input);
          if (isOAuthOutcome(result)) outcome = result;
        } catch {
          outcome = "failed";
        }
        // Keep all valid callback outcomes visually indistinguishable; no
        // account, error, state, code, or redirect is reflected to the browser.
        respond(response, 200, outcome === "complete" ? SUCCESS_HTML : ERROR_HTML);
      } catch {
        respond(response, 400, ERROR_HTML);
      } finally {
        if (acquiredExchangeSlot) activeExchanges -= 1;
        if (acquiredRequestSlot) activeRequests -= 1;
      }
    })();
  });
  server.headersTimeout = REQUEST_TIMEOUT_MS;
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.timeout = REQUEST_TIMEOUT_MS;
  server.keepAliveTimeout = REQUEST_TIMEOUT_MS;
  server.maxHeadersCount = MAX_HEADER_FIELDS;
  server.on("clientError", (_error, socket) => loglessClientError(socket));

  await new Promise<void>((resolve, reject) => {
    const onError = () => {
      server.off("listening", onListening);
      reject(new OAuthError("callback_bind_failed"));
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    try {
      server.listen(config.callbackPort, config.callbackHost);
    } catch {
      server.off("error", onError);
      server.off("listening", onListening);
      reject(new OAuthError("callback_bind_failed"));
    }
  });

  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    close(): Promise<void> {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(new OAuthError("callback_bind_failed"));
            return;
          }
          resolve();
        });
      });
      return closePromise;
    },
  });
}
