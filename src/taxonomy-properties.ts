import { EtsyApiError } from "./etsy-client.js";

export const MAX_TAXONOMY_PROPERTIES = 100;
export const MAX_TAXONOMY_PROPERTY_SCALES = 10;
export const MAX_TAXONOMY_PROPERTY_VALUES = 50;
export const MAX_TAXONOMY_PROPERTY_SELECTED_VALUES = 25;
export const MAX_TAXONOMY_PROPERTY_EQUAL_VALUES = 10;
export const MAX_TAXONOMY_PROPERTY_TEXT_LENGTH = 200;
export const MAX_TAXONOMY_PROPERTY_DESCRIPTION_LENGTH = 500;

export interface MappedTaxonomyProperties {
  readonly count?: number | null;
  readonly results: Record<string, unknown>[];
  readonly truncated: boolean;
}

interface TruncationState {
  value: boolean;
}

const TEXT_TRUNCATION_MARKER = "…[truncated]";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidProperties(): EtsyApiError {
  return new EtsyApiError("upstream", "Etsy returned invalid taxonomy properties.");
}

function textField(
  value: unknown,
  maxLength: number,
  truncation: TruncationState,
): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string") throw invalidProperties();
  if (value.length <= maxLength) return value;
  truncation.value = true;
  if (maxLength <= TEXT_TRUNCATION_MARKER.length) {
    return value.slice(0, maxLength);
  }
  return value.slice(0, maxLength - TEXT_TRUNCATION_MARKER.length) + TEXT_TRUNCATION_MARKER;
}

function optionalBoolean(value: unknown): boolean | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "boolean") throw invalidProperties();
  return value;
}

function optionalInteger(
  value: unknown,
  minimum?: number,
): number | null | undefined {
  if (value === undefined || value === null) return value;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    (minimum !== undefined && value < minimum)
  ) {
    throw invalidProperties();
  }
  return value;
}

function optionalId(value: unknown): number | null | undefined {
  return optionalInteger(value, 1);
}

function mappedArray<T>(
  value: unknown,
  maxItems: number,
  truncation: TruncationState,
  map: (item: unknown) => T,
): T[] | null | undefined {
  if (value === undefined || value === null) return value;
  if (!Array.isArray(value)) throw invalidProperties();
  if (value.length > maxItems) truncation.value = true;
  return value.slice(0, maxItems).map(map);
}

function mapEqualValues(value: unknown, truncation: TruncationState): number[] | null | undefined {
  return mappedArray(
    value,
    MAX_TAXONOMY_PROPERTY_EQUAL_VALUES,
    truncation,
    (item) => {
      const id = optionalInteger(item, 0);
      if (id === undefined || id === null) throw invalidProperties();
      return id;
    },
  );
}

function mapScale(value: unknown, truncation: TruncationState): Record<string, unknown> {
  if (!isObject(value)) throw invalidProperties();
  return {
    scale_id: optionalId(value.scale_id),
    display_name: textField(value.display_name, MAX_TAXONOMY_PROPERTY_TEXT_LENGTH, truncation),
    description: textField(
      value.description,
      MAX_TAXONOMY_PROPERTY_DESCRIPTION_LENGTH,
      truncation,
    ),
  };
}

function mapPropertyValue(value: unknown, truncation: TruncationState): Record<string, unknown> {
  if (!isObject(value)) throw invalidProperties();
  return {
    value_id: optionalId(value.value_id),
    name: textField(value.name, MAX_TAXONOMY_PROPERTY_TEXT_LENGTH, truncation),
    scale_id: optionalId(value.scale_id),
    equal_to: mapEqualValues(value.equal_to, truncation),
  };
}

function mapProperty(value: unknown, truncation: TruncationState): Record<string, unknown> {
  if (!isObject(value)) throw invalidProperties();
  return {
    property_id: optionalId(value.property_id),
    name: textField(value.name, MAX_TAXONOMY_PROPERTY_TEXT_LENGTH, truncation),
    display_name: textField(value.display_name, MAX_TAXONOMY_PROPERTY_TEXT_LENGTH, truncation),
    is_required: optionalBoolean(value.is_required),
    supports_attributes: optionalBoolean(value.supports_attributes),
    supports_variations: optionalBoolean(value.supports_variations),
    is_multivalued: optionalBoolean(value.is_multivalued),
    max_values_allowed: optionalInteger(value.max_values_allowed),
    scales: mappedArray(
      value.scales,
      MAX_TAXONOMY_PROPERTY_SCALES,
      truncation,
      (item) => mapScale(item, truncation),
    ),
    possible_values: mappedArray(
      value.possible_values,
      MAX_TAXONOMY_PROPERTY_VALUES,
      truncation,
      (item) => mapPropertyValue(item, truncation),
    ),
    selected_values: mappedArray(
      value.selected_values,
      MAX_TAXONOMY_PROPERTY_SELECTED_VALUES,
      truncation,
      (item) => mapPropertyValue(item, truncation),
    ),
  };
}

/** Validate Etsy's unpaged property response and map only selected bounded fields. */
export function normalizeTaxonomyProperties(value: unknown): MappedTaxonomyProperties {
  if (!isObject(value) || !Array.isArray(value.results)) throw invalidProperties();
  const count = optionalInteger(value.count, 0);
  if (typeof count === "number" && count !== value.results.length) {
    throw invalidProperties();
  }

  const truncation = { value: false };
  if (value.results.length > MAX_TAXONOMY_PROPERTIES) truncation.value = true;
  const results = value.results
    .slice(0, MAX_TAXONOMY_PROPERTIES)
    .map((property) => mapProperty(property, truncation));

  return {
    ...(count !== undefined ? { count } : {}),
    results,
    truncated: truncation.value,
  };
}
