import axios, {
  AxiosError,
  AxiosInstance,
  type AxiosRequestTransformer,
  type InternalAxiosRequestConfig,
} from "axios";
import {
  assertDevelopmentModeDispatch,
  DevelopmentModeMutationError,
  enforceDevelopmentMode,
  snapshotDevelopmentMode,
  type DevelopmentModeFactoryOptions,
} from "./development-mode.js";
import {
  createRequestLimiter,
  RequestQueueFullError,
  runAtLimitedDispatch,
  type RequestLimiter,
} from "./request-limiter.js";

export const ETSY_API_BASE = "https://openapi.etsy.com/v3";
export const REQUEST_TIMEOUT_MS = 10_000;
export const MAX_UPSTREAM_RESPONSE_BYTES = 1024 * 1024;
const MAX_SHORT_RETRY_MS = 1000;

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}
export class EtsyApiError extends Error {
  constructor(
    readonly category:
      | "authentication"
      | "forbidden"
      | "not_found"
      | "rate_limit"
      | "timeout"
      | "redirect"
      | "network"
      | "upstream"
      | "response_too_large"
      | "busy",
    message: string,
  ) {
    super(message);
    this.name = "EtsyApiError";
  }
}

export function validateApiKey(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 1024 ||
    value.trim() !== value ||
    /[\s\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new ConfigurationError(
      "ETSY_API_KEY is required and must use the format <keystring>:<shared_secret>.",
    );
  }

  const separator = value.indexOf(":");
  if (
    separator <= 0 ||
    separator !== value.lastIndexOf(":") ||
    separator === value.length - 1
  ) {
    throw new ConfigurationError(
      "ETSY_API_KEY must contain a keystring and shared secret separated by one colon.",
    );
  }

  return value;
}

export function createEtsyClient(
  apiKey: string,
  options?: DevelopmentModeFactoryOptions,
): AxiosInstance {
  const developmentMode = snapshotDevelopmentMode(options);
  const validatedKey = validateApiKey(apiKey);
  const client = axios.create({
    baseURL: ETSY_API_BASE,
    headers: {
      "x-api-key": validatedKey,
      Accept: "application/json",
    },
    timeout: REQUEST_TIMEOUT_MS,
    maxRedirects: 0,
    maxContentLength: MAX_UPSTREAM_RESPONSE_BYTES,
    maxBodyLength: MAX_UPSTREAM_RESPONSE_BYTES,
    proxy: false,
    transitional: { clarifyTimeoutError: true },
    // The default Node.js HTTPS agent verifies certificates. Do not replace it
    // with an agent that disables TLS verification.
  });
  enforceDevelopmentMode(client, developmentMode);
  return client;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(error: AxiosError): number | undefined {
  const headers = error.response?.headers as
    | { get?: (name: string) => unknown; "retry-after"?: unknown }
    | undefined;
  const headerValue = headers?.get?.("retry-after") ?? headers?.["retry-after"];
  if (headerValue === undefined || headerValue === null) return undefined;

  const value = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    const waitMs = seconds * 1000;
    return Number.isFinite(waitMs) ? waitMs : Number.MAX_SAFE_INTEGER;
  }

  if (typeof value === "string") {
    const retryAt = Date.parse(value);
    if (Number.isFinite(retryAt)) return Math.max(0, retryAt - Date.now());
  }
  return undefined;
}

function retryDelay(error: unknown): number | undefined {
  if (!axios.isAxiosError(error)) return undefined;
  const status = error.response?.status;
  if (status === 429 || status === 502 || status === 503 || status === 504) {
    return retryAfterMs(error) ?? 250;
  }
  if (!error.response && ["ECONNRESET", "EAI_AGAIN", "EPIPE"].includes(error.code ?? "")) {
    return 250;
  }
  return undefined;
}

function retryHint(error: AxiosError): string {
  const waitMs = retryAfterMs(error);
  if (waitMs === undefined) return "Retry the request shortly.";
  return `Retry after about ${Math.max(1, Math.ceil(waitMs / 1000))} seconds.`;
}

function safeApiError(error: unknown): EtsyApiError {
  if (error instanceof EtsyApiError) return error;
  if (error instanceof DevelopmentModeMutationError) {
    return new EtsyApiError("forbidden", error.message);
  }
  if (error instanceof RequestQueueFullError) {
    return new EtsyApiError("busy", error.message);
  }
  if (!axios.isAxiosError(error)) {
    return new EtsyApiError("upstream", "Unable to process the Etsy response.");
  }

  if (/maxContentLength size of \d+ exceeded/i.test(error.message)) {
    return new EtsyApiError(
      "response_too_large",
      "The Etsy response exceeded the server's 1 MiB upstream response limit.",
    );
  }

  const status = error.response?.status;
  if (status === 401) {
    return new EtsyApiError(
      "authentication",
      "Etsy rejected the API credentials. Check the keystring and shared secret.",
    );
  }
  if (status === 403) {
    return new EtsyApiError(
      "forbidden",
      "Etsy denied this operation. This server only supports public read-only access.",
    );
  }
  if (status === 404) {
    return new EtsyApiError("not_found", "The requested Etsy resource was not found.");
  }
  if (status === 429) {
    return new EtsyApiError("rate_limit", `Etsy rate limit exceeded. ${retryHint(error)}`);
  }
  if ((status !== undefined && status >= 300 && status < 400) ||
      ["ERR_FR_TOO_MANY_REDIRECTS", "ERR_FR_REDIRECTION_FAILURE"].includes(error.code ?? "")) {
    return new EtsyApiError(
      "redirect",
      "Etsy returned a redirect. Redirects are blocked for credential safety.",
    );
  }
  if (["ETIMEDOUT", "ECONNABORTED"].includes(error.code ?? "")) {
    return new EtsyApiError("timeout", "The Etsy request timed out after 10 seconds.");
  }
  if (status !== undefined && status >= 500) {
    return new EtsyApiError(
      "upstream",
      `Etsy returned a temporary server error (HTTP ${status}). ${retryHint(error)}`,
    );
  }
  if (status !== undefined) {
    return new EtsyApiError(
      "upstream",
      `Etsy rejected the request (HTTP ${status}). Check the supplied search filters.`,
    );
  }
  return new EtsyApiError("network", "Could not connect securely to the Etsy API.");
}

export type EtsyQuery = Record<string, string | number | boolean | undefined>;

function limitedAdapterTransform(
  client: AxiosInstance,
  limiter: RequestLimiter,
): AxiosRequestTransformer {
  return function (this: InternalAxiosRequestConfig, data: unknown): unknown {
    const adapter = axios.getAdapter(this.adapter ?? client.defaults.adapter);
    this.adapter = (config) => {
      return runAtLimitedDispatch(
        limiter,
        () => assertDevelopmentModeDispatch(client, config),
        () => Promise.resolve(adapter(config)),
      );
    };
    return data;
  };
}

function requestTransforms(client: AxiosInstance): AxiosRequestTransformer[] {
  const transforms = client.defaults.transformRequest;
  if (Array.isArray(transforms)) return [...transforms];
  return transforms ? [transforms] : [];
}

export function createEtsyRequester(
  client: AxiosInstance,
  options?: { limiter?: RequestLimiter },
): {
  get(path: string, params?: EtsyQuery): Promise<unknown>;
} {
  const limiter = options?.limiter ?? createRequestLimiter();

  return {
    async get(path, params) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await client.get<unknown>(path, {
            params,
            transformRequest: [
              ...requestTransforms(client),
              limitedAdapterTransform(client, limiter),
            ],
          });
          return response.data;
        } catch (error) {
          const waitMs = attempt === 0 ? retryDelay(error) : undefined;
          if (waitMs !== undefined && waitMs <= MAX_SHORT_RETRY_MS) {
            if (waitMs > 0) await delay(waitMs);
            continue;
          }
          throw safeApiError(error);
        }
      }
      throw new EtsyApiError("upstream", "The Etsy request could not be completed.");
    },
  };
}
