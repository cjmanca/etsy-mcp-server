import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

export const CAPABILITIES = ["public", "account", "write", "event"] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_PREREQUISITES: Readonly<Record<Capability, string>> = {
  public: "A valid Etsy API key configured by the server.",
  account:
    "An OAuth-connected Etsy account with the operation's required scope(s) and server-side account/resource authorization.",
  write:
    "An authorized account with the operation's required write scope and explicit operation-specific user authorization and confirmation.",
  event:
    "An authorized account and an approved, configured event receiver for authenticated deliveries.",
};

const CAPABILITY_DEPENDENCIES: Readonly<Record<Capability, readonly Capability[]>> = {
  public: [],
  account: ["public"],
  write: ["account"],
  event: ["account"],
};

export interface CapabilityRegistration {
  readonly capability: Capability;
  readonly tool: Tool;
  readonly handler: (args: unknown) => CallToolResult | Promise<CallToolResult>;
}

export interface CapabilityRegistryOptions {
  /** Trusted server configuration; never derive this from a model request. */
  readonly enabledCapabilities: readonly Capability[];
  readonly registrations?: readonly CapabilityRegistration[];
}

export class CapabilityConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityConfigurationError";
  }
}

export class CapabilityUnavailableError extends Error {
  readonly capability: Capability;

  constructor(capability: Capability) {
    super(
      `${capability} capability is unavailable. Prerequisite: ${CAPABILITY_PREREQUISITES[capability]}`,
    );
    this.name = "CapabilityUnavailableError";
    this.capability = capability;
  }
}

export class UnknownCapabilityToolError extends Error {
  constructor() {
    super("Unknown or unsupported Etsy tool.");
    this.name = "UnknownCapabilityToolError";
  }
}

function isCapability(value: unknown): value is Capability {
  return typeof value === "string" && CAPABILITIES.includes(value as Capability);
}

export class CapabilityRegistry {
  private readonly enabledCapabilities: Set<Capability>;
  private readonly registrations = new Map<string, CapabilityRegistration>();

  constructor(options: CapabilityRegistryOptions) {
    this.enabledCapabilities = new Set();
    for (const capability of options.enabledCapabilities) {
      if (!isCapability(capability)) {
        throw new CapabilityConfigurationError("Unknown server capability configuration.");
      }
      this.enabledCapabilities.add(capability);
    }
    this.validateDependencies();
    for (const registration of options.registrations ?? []) {
      this.register(registration);
    }
  }

  register(registration: CapabilityRegistration): void {
    if (
      !registration ||
      !isCapability(registration.capability) ||
      !registration.tool ||
      typeof registration.tool.name !== "string" ||
      registration.tool.name.length === 0 ||
      typeof registration.handler !== "function"
    ) {
      throw new CapabilityConfigurationError("Invalid capability tool registration.");
    }
    if (this.registrations.has(registration.tool.name)) {
      throw new CapabilityConfigurationError("Duplicate capability tool registration.");
    }
    this.registrations.set(registration.tool.name, registration);
  }

  listTools(): Tool[] {
    return [...this.registrations.values()]
      .filter((registration) => this.enabledCapabilities.has(registration.capability))
      .map((registration) => registration.tool);
  }

  async dispatch(name: string, args: unknown): Promise<CallToolResult> {
    const registration = this.registrations.get(name);
    if (!registration) throw new UnknownCapabilityToolError();
    if (!this.enabledCapabilities.has(registration.capability)) {
      throw new CapabilityUnavailableError(registration.capability);
    }
    return registration.handler(args);
  }

  private validateDependencies(): void {
    for (const capability of this.enabledCapabilities) {
      for (const dependency of CAPABILITY_DEPENDENCIES[capability]) {
        if (!this.enabledCapabilities.has(dependency)) {
          throw new CapabilityConfigurationError(
            `${capability} capability requires ${dependency} capability to be enabled by trusted server configuration.`,
          );
        }
      }
    }
  }
}
