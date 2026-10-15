export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export type ToolArguments = Record<string, unknown>;

export function asArguments(value: unknown): ToolArguments {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("Tool arguments must be a JSON object.");
  }
  return value as ToolArguments;
}

export function requiredString(
  args: ToolArguments,
  key: string,
  maxLength: number,
): string {
  const value = args[key];
  if (typeof value !== "string") {
    throw new ValidationError(`${key} must be a string.`);
  }
  if (value.length > maxLength) {
    throw new ValidationError(`${key} must be at most ${maxLength} characters.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ValidationError(`${key} must not be empty.`);
  }
  return trimmed;
}

export function positiveSafeInteger(
  value: unknown,
  key: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new ValidationError(`${key} must be a positive safe integer.`);
  }
  return value;
}

export function optionalInteger(
  args: ToolArguments,
  key: string,
  minimum: number,
  maximum: number,
): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new ValidationError(
      `${key} must be an integer from ${minimum} through ${maximum}.`,
    );
  }
  return value;
}

export function optionalNonnegativeNumber(
  args: ToolArguments,
  key: string,
): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ValidationError(`${key} must be a finite, nonnegative number.`);
  }
  return value;
}

export function optionalEnum<const T extends readonly string[]>(
  args: ToolArguments,
  key: string,
  allowed: T,
): T[number] | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new ValidationError(
      `${key} must be one of: ${allowed.join(", ")}.`,
    );
  }
  return value;
}

export function pagination(args: ToolArguments): {
  limit: number;
  offset: number;
} {
  return {
    limit: optionalInteger(args, "limit", 1, 100) ?? 25,
    offset: optionalInteger(args, "offset", 0, 12000) ?? 0,
  };
}

export const SORT_ON = ["created", "price", "updated", "score"] as const;
export const SORT_ORDER = [
  "asc",
  "ascending",
  "desc",
  "descending",
  "up",
  "down",
] as const;

export function optionalUnixTimestamp(
  args: ToolArguments,
  key: string,
): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 946684800 ||
    !Number.isFinite(new Date(value * 1000).getTime())
  ) {
    throw new ValidationError(
      `${key} must be a valid Unix timestamp in seconds (year 2000 or later).`,
    );
  }
  return value;
}

export const LISTING_INCLUDES = ["Shop", "Images", "User", "Videos"] as const;

export function listingIncludes(args: ToolArguments): string[] {
  const value = args.includes;
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > LISTING_INCLUDES.length) {
    throw new ValidationError(
      `includes must be an array of up to ${LISTING_INCLUDES.length} supported values.`,
    );
  }

  const includes: string[] = [];
  for (const item of value) {
    if (
      typeof item !== "string" ||
      !LISTING_INCLUDES.includes(item as (typeof LISTING_INCLUDES)[number])
    ) {
      throw new ValidationError(
        `includes values must be one of: ${LISTING_INCLUDES.join(", ")}.`,
      );
    }
    if (!includes.includes(item)) includes.push(item);
  }
  return includes;
}
