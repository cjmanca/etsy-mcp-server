import { createHash } from "node:crypto";
import { validateApiKey } from "../etsy-client.js";
import type { RequestLimiter } from "../request-limiter.js";
import { startCallbackServer, type CallbackHandle } from "./callback.js";
import { createOAuthService, type OAuthService } from "./service.js";
import { createOAuthTransport } from "./transport.js";
import { openConnectionStore } from "./store.js";
import { OAuthError, type ConnectionStore, type OAuthConfig } from "./types.js";

export interface OAuthRuntime {
  readonly developmentMode: boolean;
  readonly service: OAuthService;
  close(): Promise<void>;
}

function appFingerprint(clientId: string): string {
  return createHash("sha256")
    .update("etsy-mcp-oauth-app-fingerprint-v1\0")
    .update(clientId, "utf8")
    .digest("hex");
}

export async function startOAuthRuntime(
  config: OAuthConfig,
  apiKey: string,
  limiter: RequestLimiter,
): Promise<OAuthRuntime> {
  let validatedKey: string;
  try {
    validatedKey = validateApiKey(apiKey);
  } catch {
    throw new OAuthError("invalid_configuration");
  }
  const separator = validatedKey.indexOf(":");
  const clientId = validatedKey.slice(0, separator);
  if (separator <= 0 || config.owner.appFingerprint !== appFingerprint(clientId)) {
    throw new OAuthError("invalid_configuration");
  }

  let store: ConnectionStore | undefined;
  let service: OAuthService | undefined;
  let callback: CallbackHandle | undefined;
  try {
    store = await openConnectionStore(config);
    const transport = createOAuthTransport(config, validatedKey, limiter);
    service = createOAuthService(config, store, transport, { clientId });
    callback = await startCallbackServer(config, service.completeCallback.bind(service));
  } catch (error) {
    await callback?.close().catch(() => {});
    await service?.close().catch(() => {});
    await store?.close().catch(() => {});
    if (error instanceof OAuthError) throw error;
    throw new OAuthError("oauth_flow_unavailable");
  }

  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    developmentMode: config.developmentMode,
    service,
    close(): Promise<void> {
      if (closePromise) return closePromise;
      // Closing the service synchronously invalidates pending context before
      // callback.close() waits for its already accepted HTTP handlers.
      let serviceCleanup: Promise<void>;
      try {
        serviceCleanup = service.close();
      } catch {
        serviceCleanup = Promise.reject(new OAuthError("oauth_flow_unavailable"));
      }
      let callbackCleanup: Promise<void>;
      try {
        callbackCleanup = callback?.close() ?? Promise.resolve();
      } catch {
        callbackCleanup = Promise.reject(new OAuthError("callback_bind_failed"));
      }
      closePromise = (async () => {
        // Observe both already-started cleanups in this synchronous turn. The
        // service drain can reject while callback.close() waits for open sockets.
        const [callbackResult, serviceResult] = await Promise.allSettled([
          callbackCleanup,
          serviceCleanup,
        ]);
        let failed =
          callbackResult.status === "rejected" || serviceResult.status === "rejected";
        try {
          await store?.close();
        } catch {
          failed = true;
        }
        if (failed) throw new OAuthError("oauth_flow_unavailable");
      })();
      return closePromise;
    },
  });
}
