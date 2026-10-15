import axios, {
  AxiosError,
  AxiosInstance,
} from "axios";

export const ETSY_API_BASE = "https://openapi.etsy.com/v3";
export const REQUEST_TIMEOUT_MS = 10_000;
export const MAX_UPSTREAM_RESPONSE_BYTES = 1024 * 1024;
const MIN_REQUEST_INTERVAL_MS = 200;
const MAX_PENDING_REQUESTS = 25;
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

export function createEtsyClient(apiKey: string): AxiosInstance {
  const validatedKey = validateApiKey(apiKey);
  return axios.create({
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
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createRequestLimiter(): () => Promise<void> {
  let nextStartAt = 0;
  let pending = 0;

  return async () => {
    if (pending >= MAX_PENDING_REQUESTS) {
      throw new EtsyApiError(
        "busy",
        "The Etsy request queue is full. Try again shortly.",
      );
    }

    pending += 1;
    try {
      const now = Date.now();
      const startAt = Math.max(now, nextStartAt);
      nextStartAt = startAt + MIN_REQUEST_INTERVAL_MS;
      if (startAt > now) await delay(startAt - now);
    } finally {
      pending -= 1;
    }
  };
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
  if (!axios.isAxiosError(error)) {
    return new EtsyApiError("upstream", "Unable to process the Etsy response.");
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

export function createEtsyRequester(client: AxiosInstance): {
  get(path: string, params?: EtsyQuery): Promise<unknown>;
} {
  const waitForRequestSlot = createRequestLimiter();

  return {
    async get(path, params) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await waitForRequestSlot();
        try {
          const response = await client.get<unknown>(path, { params });
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
