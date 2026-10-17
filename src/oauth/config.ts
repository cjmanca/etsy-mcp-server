import { createHash } from "node:crypto";
import { isIP } from "node:net";
import os from "node:os";
import path from "node:path";
import { OAuthError, type OAuthConfig, type OAuthSettings } from "./types.js";

const CALLBACK_PATH = "/oauth/etsy/callback";
const MAX_REDIRECT_LENGTH = 2_048;
const MAX_TRUSTED_PEERS = 16;
const MAX_PEER_LENGTH = 45;
const OPERATOR_ID = /^[A-Za-z0-9_-]{1,64}$/;
const APP_KEY = /^[^\s\u0000-\u001f\u007f]{1,1024}$/;

function invalidConfiguration(): never {
  throw new OAuthError("invalid_configuration");
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (typeof value !== "string" || value.length === 0) return invalidConfiguration();
  return value;
}

function absolutePath(value: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 1_024 ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    !path.isAbsolute(value)
  ) {
    return invalidConfiguration();
  }
  return path.resolve(value);
}

function defaultDataDirectory(env: NodeJS.ProcessEnv, operatorId: string): string {
  if (process.platform === "win32") {
    const localAppData = env.LOCALAPPDATA;
    if (!localAppData || !path.isAbsolute(localAppData)) return invalidConfiguration();
    return path.resolve(localAppData, "etsy-mcp-server", operatorId);
  }
  if (process.platform === "linux") {
    const xdgDataHome = env.XDG_DATA_HOME;
    const base = xdgDataHome === undefined ? path.join(os.homedir(), ".local", "share") : xdgDataHome;
    if (!path.isAbsolute(base)) return invalidConfiguration();
    return path.resolve(base, "etsy-mcp-server", operatorId);
  }
  return invalidConfiguration();
}

function canonicalIpv6(value: string): string {
  try {
    return new URL(`http://[${value}]/`).hostname.slice(1, -1).toLowerCase();
  } catch {
    return invalidConfiguration();
  }
}

export function normalizePeerIp(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    return invalidConfiguration();
  }
  const kind = isIP(value);
  if (kind === 4) {
    return value
      .split(".")
      .map((octet) => String(Number(octet)))
      .join(".");
  }
  if (kind !== 6 || value.includes("%")) return invalidConfiguration();

  const normalized = canonicalIpv6(value);
  const mappedMatch = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(normalized);
  if (mappedMatch) {
    const first = Number.parseInt(mappedMatch[1], 16);
    const second = Number.parseInt(mappedMatch[2], 16);
    return [first >>> 8, first & 0xff, second >>> 8, second & 0xff].join(".");
  }
  return normalized;
}

function isLoopback(value: string): boolean {
  const kind = isIP(value);
  if (kind === 4) return value.startsWith("127.");
  return value === "::1";
}

function isUnspecified(value: string): boolean {
  return value === "0.0.0.0" || value === "::";
}

function isMulticastOrBroadcast(value: string): boolean {
  if (isIP(value) === 6) return value.startsWith("ff");
  const [first, second, third, fourth] = value.split(".").map(Number);
  return (
    first >= 224 ||
    (first === 255 && second === 255 && third === 255 && fourth === 255)
  );
}

function parseCallbackHost(value: string): { host: string; loopback: boolean } {
  let host: string;
  try {
    host = normalizePeerIp(value);
  } catch {
    return invalidConfiguration();
  }
  const kind = isIP(host);
  if (kind === 0 || (isUnspecified(host) && host !== "0.0.0.0")) {
    return invalidConfiguration();
  }
  if (isMulticastOrBroadcast(host)) return invalidConfiguration();
  return { host, loopback: isLoopback(host) };
}

function parsePeerList(value: string, loopbackBind: boolean): readonly string[] {
  if (value.length > MAX_TRUSTED_PEERS * MAX_PEER_LENGTH + MAX_TRUSTED_PEERS - 1) {
    return invalidConfiguration();
  }
  const parts = value.split(",");
  if (parts.length < 1 || parts.length > MAX_TRUSTED_PEERS) return invalidConfiguration();
  const normalized = parts.map((part) => {
    if (part.length === 0 || part.length > MAX_PEER_LENGTH) return invalidConfiguration();
    const peer = normalizePeerIp(part);
    if (isUnspecified(peer) || isMulticastOrBroadcast(peer)) return invalidConfiguration();
    if (loopbackBind && !isLoopback(peer)) return invalidConfiguration();
    return peer;
  });
  if (new Set(normalized).size !== normalized.length) return invalidConfiguration();
  return Object.freeze(normalized);
}

function parseRedirectUri(value: string): string {
  if (value.length > MAX_REDIRECT_LENGTH || /[\u0000-\u0020\u007f]/.test(value)) {
    return invalidConfiguration();
  }
  let redirect: URL;
  try {
    redirect = new URL(value);
  } catch {
    return invalidConfiguration();
  }
  if (
    redirect.protocol !== "https:" ||
    redirect.hostname.length === 0 ||
    redirect.hostname.includes("*") ||
    redirect.username !== "" ||
    redirect.password !== "" ||
    redirect.search !== "" ||
    redirect.hash !== "" ||
    redirect.pathname !== CALLBACK_PATH ||
    redirect.href !== value
  ) {
    return invalidConfiguration();
  }
  return value;
}

export function parseOAuthConfig(
  env: NodeJS.ProcessEnv,
  developmentMode: boolean,
): OAuthSettings {
  const enabledValue = env.ETSY_OAUTH_ENABLED;
  if (enabledValue === undefined || enabledValue === "false") return { enabled: false };
  if (enabledValue !== "true") return invalidConfiguration();

  if (typeof developmentMode !== "boolean") return invalidConfiguration();
  const operatorId = required(env, "ETSY_OAUTH_OPERATOR_ID");
  if (!OPERATOR_ID.test(operatorId)) return invalidConfiguration();

  const appKey = required(env, "ETSY_API_KEY");
  if (!APP_KEY.test(appKey)) return invalidConfiguration();
  const keyParts = appKey.split(":");
  if (keyParts.length !== 2 || keyParts[0].length === 0 || keyParts[1].length === 0) {
    return invalidConfiguration();
  }
  const appFingerprint = createHash("sha256")
    .update("etsy-mcp-oauth-app-fingerprint-v1\0")
    .update(keyParts[0], "utf8")
    .digest("hex");

  const configuredDataDir = env.ETSY_OAUTH_DATA_DIR;
  const dataDir = configuredDataDir === undefined
    ? absolutePath(defaultDataDirectory(env, operatorId))
    : absolutePath(configuredDataDir);
  const keyFile = absolutePath(required(env, "ETSY_OAUTH_KEY_FILE"));
  const redirectUri = parseRedirectUri(required(env, "ETSY_OAUTH_REDIRECT_URI"));

  const callbackHostInput = env.ETSY_OAUTH_CALLBACK_HOST ?? "127.0.0.1";
  const callback = parseCallbackHost(callbackHostInput);
  const callbackPortRaw = env.ETSY_OAUTH_CALLBACK_PORT ?? "3001";
  if (!/^[1-9][0-9]{0,4}$/.test(callbackPortRaw)) return invalidConfiguration();
  const callbackPort = Number(callbackPortRaw);
  if (!Number.isSafeInteger(callbackPort) || callbackPort > 65_535) {
    return invalidConfiguration();
  }

  const peersRaw = env.ETSY_OAUTH_TRUSTED_PROXY_IPS;
  let trustedProxyIps: readonly string[];
  if (peersRaw === undefined) {
    if (!callback.loopback) return invalidConfiguration();
    trustedProxyIps = Object.freeze(["127.0.0.1", "::1"]);
  } else {
    trustedProxyIps = parsePeerList(peersRaw, callback.loopback);
  }
  if (!callback.loopback && trustedProxyIps.length === 0) return invalidConfiguration();

  const owner = Object.freeze({ operatorId, appFingerprint });
  const config: OAuthConfig = Object.freeze({
    owner,
    dataDir,
    keyFile,
    redirectUri,
    callbackHost: callback.host,
    callbackPort,
    trustedProxyIps,
    developmentMode,
  });
  return { enabled: true, config };
}
