import axios, {
  getAdapter,
  type AxiosAdapter,
  type AxiosInstance,
  type AxiosRequestTransformer,
  type InternalAxiosRequestConfig,
} from "axios";

export interface DevelopmentModeFactoryOptions {
  /** Trusted factory configuration; caller-supplied MCP data is never consulted. */
  readonly developmentMode?: boolean;
}

const ACCEPTED_DEVELOPMENT_MODE_VALUES = new Set(["true", "false"]);
const SAFE_HTTP_METHODS = new Set(["get", "head", "options"]);
const LOCKED_MUTATION_MESSAGE =
  "Mutating Etsy operations are blocked while ETSY_DEVELOPMENT_MODE=true (read-only testing lock).";
const LOCKED_REQUEST_INTERCEPTOR_MESSAGE =
  "Custom Axios request interceptors are not supported while ETSY_DEVELOPMENT_MODE=true (read-only testing lock).";

function assertSafeHttpMethod(method: unknown): void {
  if (typeof method !== "string" || !SAFE_HTTP_METHODS.has(method.toLowerCase())) {
    throw new DevelopmentModeMutationError();
  }
}

export class DevelopmentModeConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DevelopmentModeConfigurationError";
  }
}

export class DevelopmentModeMutationError extends Error {
  constructor() {
    super(LOCKED_MUTATION_MESSAGE);
    this.name = "DevelopmentModeMutationError";
  }
}

/**
 * Resolve startup policy into a primitive snapshot. An explicit trusted `true`
 * can enable the lock, but no factory option can override an environment lock.
 */
export function snapshotDevelopmentMode(options?: unknown): boolean {
  let configuredMode = false;
  if (options !== undefined) {
    if (typeof options !== "object" || options === null || Array.isArray(options)) {
      throw new DevelopmentModeConfigurationError(
        "ETSY_DEVELOPMENT_MODE factory configuration must be an object.",
      );
    }

    const value = (options as { readonly developmentMode?: unknown }).developmentMode;
    if (value !== undefined && typeof value !== "boolean") {
      throw new DevelopmentModeConfigurationError(
        "ETSY_DEVELOPMENT_MODE factory option must be a boolean.",
      );
    }
    configuredMode = value === true;
  }

  const environmentMode = process.env.ETSY_DEVELOPMENT_MODE;
  if (
    environmentMode !== undefined &&
    environmentMode !== "" &&
    !ACCEPTED_DEVELOPMENT_MODE_VALUES.has(environmentMode)
  ) {
    throw new DevelopmentModeConfigurationError(
      'ETSY_DEVELOPMENT_MODE must be exactly "true" or "false".',
    );
  }

  return environmentMode === "true" || configuredMode;
}

const guardedClients = new WeakSet<AxiosInstance>();

function assertCompatibleRequestInterceptors(client: AxiosInstance): void {
  const interceptors = client.interceptors;
  if (!interceptors || typeof interceptors !== "object") {
    throw new DevelopmentModeConfigurationError(LOCKED_REQUEST_INTERCEPTOR_MESSAGE);
  }
  const requestInterceptors = interceptors?.request as unknown as {
    handlers?: unknown;
  };
  if (!requestInterceptors || typeof requestInterceptors !== "object") {
    throw new DevelopmentModeConfigurationError(LOCKED_REQUEST_INTERCEPTOR_MESSAGE);
  }
  const handlers = requestInterceptors?.handlers;
  const clientInterceptorsDescriptor = Object.getOwnPropertyDescriptor(
    client,
    "interceptors",
  );
  const requestManagerDescriptor = Object.getOwnPropertyDescriptor(
    interceptors,
    "request",
  );
  const handlersDescriptor = Object.getOwnPropertyDescriptor(
    requestInterceptors,
    "handlers",
  );

  const hasCustomRequestInterceptors =
    !Array.isArray(handlers) || handlers.some((handler) => handler !== null);
  const hasCustomizedManager =
    ["use", "eject", "clear", "forEach"].some((method) =>
      Object.hasOwn(requestInterceptors, method),
    ) ||
    ["use", "eject", "clear", "forEach"].some(
      (method) => typeof (requestInterceptors as Record<string, unknown>)[method] !== "function",
    ) ||
    !Object.isExtensible(requestInterceptors);
  const canLockRequestManager =
    Boolean(clientInterceptorsDescriptor?.configurable || clientInterceptorsDescriptor?.writable) &&
    Boolean(requestManagerDescriptor?.configurable || requestManagerDescriptor?.writable) &&
    Boolean(handlersDescriptor?.configurable || handlersDescriptor?.writable);

  if (hasCustomRequestInterceptors || hasCustomizedManager || !canLockRequestManager) {
    throw new DevelopmentModeConfigurationError(LOCKED_REQUEST_INTERCEPTOR_MESSAGE);
  }
}

function lockRequestInterceptorChanges(client: AxiosInstance): void {
  const interceptors = client.interceptors;
  const requestInterceptors = interceptors.request;
  const handlers = (requestInterceptors as unknown as { handlers: unknown[] }).handlers;
  const rejectInterceptorChange = () => {
    throw new DevelopmentModeConfigurationError(LOCKED_REQUEST_INTERCEPTOR_MESSAGE);
  };

  for (const method of ["use", "eject", "clear"] as const) {
    Object.defineProperty(requestInterceptors, method, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: rejectInterceptorChange,
    });
  }

  for (const handler of handlers) {
    if (handler && typeof handler === "object") Object.freeze(handler);
  }
  Object.freeze(handlers);
  Object.defineProperty(requestInterceptors, "handlers", {
    configurable: false,
    enumerable: true,
    writable: false,
    value: handlers,
  });
  Object.freeze(requestInterceptors);

  Object.defineProperty(interceptors, "request", {
    configurable: false,
    enumerable: true,
    writable: false,
    value: requestInterceptors,
  });
  Object.defineProperty(client, "interceptors", {
    configurable: false,
    enumerable: true,
    writable: false,
    value: interceptors,
  });
}

function protectAdapterSelection(config: InternalAxiosRequestConfig): void {
  const adapter = getAdapter(config.adapter ?? axios.defaults.adapter);
  const guardedAdapter: AxiosAdapter = (requestConfig) => {
    assertSafeHttpMethod(requestConfig.method);
    return adapter(requestConfig);
  };
  config.adapter = guardedAdapter;
}

const enforceAdapterBoundary: AxiosRequestTransformer = function (data) {
  assertSafeHttpMethod(this.method);
  protectAdapterSelection(this);
  return data;
};

function withoutAdapterBoundary(value: unknown): AxiosRequestTransformer[] {
  const transforms = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];
  return transforms.filter(
    (transform) => transform !== enforceAdapterBoundary,
  ) as AxiosRequestTransformer[];
}

function appendAdapterBoundary(config: InternalAxiosRequestConfig): void {
  config.transformRequest = [
    ...withoutAdapterBoundary(config.transformRequest),
    enforceAdapterBoundary,
  ];
}

/** Install an immutable request-time check before Axios selects an adapter. */
export function enforceDevelopmentMode(
  client: AxiosInstance,
  developmentMode: boolean,
): void {
  if (!developmentMode || guardedClients.has(client)) return;
  assertCompatibleRequestInterceptors(client);

  client.interceptors.request.use((config) => {
    assertSafeHttpMethod(config.method ?? "get");
    appendAdapterBoundary(config);
    return config;
  });

  lockRequestInterceptorChanges(client);
  guardedClients.add(client);
}
