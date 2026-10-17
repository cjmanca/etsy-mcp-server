import type { CapabilityRegistration } from "../capabilities.js";
import type { Bundle, OAuthService } from "./service.js";
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

function invalidInput(): never {
  throw new OAuthError("oauth_flow_invalid");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
  if (stage !== "connect") return [];
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
