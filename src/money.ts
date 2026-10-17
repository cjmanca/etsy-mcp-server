export type NormalizedMoney =
  | {
      readonly kind: "money";
      readonly amount: number;
      readonly divisor: number;
      readonly currency_code: string;
    }
  | {
      readonly kind: "unavailable";
      readonly reason: "missing" | "null";
    }
  | { readonly kind: "invalid" };

/**
 * Preserve Etsy's Money units as supplied. Consumers decide whether and how to
 * format the value; this helper does not assume a universal minor-unit divisor.
 */
export function normalizeMoney(value: unknown): NormalizedMoney {
  if (value === undefined) return { kind: "unavailable", reason: "missing" };
  if (value === null) return { kind: "unavailable", reason: "null" };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { kind: "invalid" };
  }

  const money = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(money.amount) ||
    !Number.isSafeInteger(money.divisor) ||
    (money.divisor as number) <= 0 ||
    typeof money.currency_code !== "string" ||
    money.currency_code.length === 0
  ) {
    return { kind: "invalid" };
  }

  return {
    kind: "money",
    amount: money.amount as number,
    divisor: money.divisor as number,
    currency_code: money.currency_code,
  };
}
