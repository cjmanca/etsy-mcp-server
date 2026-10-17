import { OAuthError, type ScopeEvidence } from "./types.js";

const MIN_EPOCH_MS = 946_684_800_000;
const MAX_EPOCH_MS = 4_102_444_800_000;
const MAX_SCOPE_TEXT_LENGTH = 2_048;
const MAX_SCOPES = 32;
const SCOPE_NAME = /^[a-z][a-z0-9_]{0,63}$/;

// This is the current scope list in Etsy's public authentication guide. It is
// used only to validate the `scope` string documented on token responses; it
// does not describe or parse the separate tokenScopes endpoint response.
const KNOWN_SCOPES = new Set([
  "address_r",
  "address_w",
  "email_r",
  "listings_d",
  "listings_r",
  "listings_w",
  "profile_r",
  "profile_w",
  "shops_r",
  "shops_w",
  "transactions_r",
  "transactions_w",
]);

const SOURCES = new Set<ScopeEvidence["source"]>([
  "authorization_code_response",
  "refresh_response",
  "diagnostic",
]);

function invalidScopeEvidence(): never {
  throw new OAuthError("oauth_scope_invalid");
}

export function parseGrantedScopes(
  value: unknown,
  source: ScopeEvidence["source"],
  checkedAt: number,
): ScopeEvidence {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_SCOPE_TEXT_LENGTH ||
    typeof source !== "string" ||
    !SOURCES.has(source) ||
    !Number.isSafeInteger(checkedAt) ||
    checkedAt < MIN_EPOCH_MS ||
    checkedAt > MAX_EPOCH_MS
  ) {
    return invalidScopeEvidence();
  }

  const names = value.split(" ");
  if (names.length === 0 || names.length > MAX_SCOPES) return invalidScopeEvidence();
  const scopes: string[] = [];
  for (const name of names) {
    if (
      name.length === 0 ||
      name.length > 64 ||
      !SCOPE_NAME.test(name) ||
      !KNOWN_SCOPES.has(name) ||
      scopes.includes(name)
    ) {
      return invalidScopeEvidence();
    }
    scopes.push(name);
  }
  return Object.freeze({ scopes: Object.freeze(scopes), source, checkedAt });
}
