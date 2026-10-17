import assert from "node:assert/strict";
import test from "node:test";
import {
  jsonText,
  mockAdapter,
  successResponse,
  withMcp,
} from "./helpers/mcp.js";

const { normalizeMoney } = await import("../build/index.js");

test("structured money preserves source units and currency without assuming cents", () => {
  assert.equal(typeof normalizeMoney, "function", "money normalizer is exported");
  assert.deepEqual(
    normalizeMoney({ amount: 1200, divisor: 60, currency_code: "EUR" }),
    { kind: "money", amount: 1200, divisor: 60, currency_code: "EUR" },
  );
});

test("structured money distinguishes missing and null from a real zero amount", () => {
  assert.equal(typeof normalizeMoney, "function", "money normalizer is exported");
  assert.deepEqual(normalizeMoney(undefined), {
    kind: "unavailable",
    reason: "missing",
  });
  assert.deepEqual(normalizeMoney(null), {
    kind: "unavailable",
    reason: "null",
  });
  assert.deepEqual(
    normalizeMoney({ amount: 0, divisor: 100, currency_code: "USD" }),
    { kind: "money", amount: 0, divisor: 100, currency_code: "USD" },
  );
});

test("structured money rejects malformed or unsafe numeric fields", () => {
  assert.equal(typeof normalizeMoney, "function", "money normalizer is exported");
  const invalidValues = [
    { amount: Number.NaN, divisor: 100, currency_code: "USD" },
    { amount: Number.POSITIVE_INFINITY, divisor: 100, currency_code: "USD" },
    { amount: Number.MAX_SAFE_INTEGER + 1, divisor: 100, currency_code: "USD" },
    { amount: 1.5, divisor: 100, currency_code: "USD" },
    { amount: 100, divisor: 0, currency_code: "USD" },
    { amount: 100, divisor: -1, currency_code: "USD" },
    { amount: 100, divisor: Number.MAX_SAFE_INTEGER + 1, currency_code: "USD" },
    { amount: 100, divisor: 100, currency_code: "" },
    { amount: 100, divisor: 100, currency_code: 3 },
    { amount: "100", divisor: 100, currency_code: "USD" },
    "100 USD",
    [],
  ];
  for (const value of invalidValues) {
    assert.deepEqual(normalizeMoney(value), { kind: "invalid" });
  }
});

test("listing price formatting remains compatible and ignores unselected money fields", async () => {
  await withMcp(
    mockAdapter((config) => successResponse(config, {
      count: 1,
      results: [{
        listing_id: 73,
        price: {
          amount: 1200,
          divisor: 60,
          currency_code: "EUR",
          converted_price: { amount: 500, divisor: 100, currency_code: "USD" },
          shipping_cost: { amount: 0, divisor: 100, currency_code: "EUR" },
        },
      }],
    })),
    async ({ client }) => {
      const response = await client.callTool({
        name: "search_listings",
        arguments: { keywords: "ceramic", limit: 1 },
      });
      const result = jsonText(response);
      assert.equal(result.results[0].price, "20 EUR");
      assert.equal("converted_price" in result.results[0], false);
      assert.equal("shipping_cost" in result.results[0], false);
    },
  );
});

test("legacy listing price formatting preserves safe numeric-string compatibility", async () => {
  await withMcp(
    mockAdapter((config) => successResponse(config, {
      count: 1,
      results: [{
        listing_id: 74,
        price: { amount: "1200", divisor: "60", currency_code: "EUR" },
      }],
    })),
    async ({ client }) => {
      const response = await client.callTool({
        name: "search_listings",
        arguments: { keywords: "ceramic", limit: 1 },
      });
      assert.equal(jsonText(response).results[0].price, "20 EUR");
    },
  );
});

test("legacy listing price formatting does not coerce null or unsafe values to zero", async () => {
  await withMcp(
    mockAdapter((config) => successResponse(config, {
      count: 3,
      results: [
        {
          listing_id: 75,
          price: { amount: null, divisor: "60", currency_code: "USD" },
        },
        {
          listing_id: 76,
          price: {
            amount: "9007199254740992",
            divisor: "60",
            currency_code: "USD",
          },
        },
        {
          listing_id: 77,
          price: {
            amount: 9007199254740992,
            divisor: "60",
            currency_code: "USD",
          },
        },
      ],
    })),
    async ({ client }) => {
      const response = await client.callTool({
        name: "search_listings",
        arguments: { keywords: "ceramic", limit: 3 },
      });
      assert.deepEqual(
        jsonText(response).results.map((listing) => listing.price),
        ["N/A", "N/A", "N/A"],
      );
    },
  );
});
