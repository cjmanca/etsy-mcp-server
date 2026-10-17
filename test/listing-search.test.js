import assert from "node:assert/strict";
import test from "node:test";
import { createEtsyMcpServer } from "../build/index.js";
import {
  httpError,
  jsonText,
  mockAdapter,
  successResponse,
  syntheticKey,
  withMcp,
} from "./helpers/mcp.js";

test("listing search publishes the documented filter controls and safe bounds", async () => {
  await withMcp(
    mockAdapter((config) => successResponse(config, { count: 0, results: [] })),
    async ({ client }) => {
      const { tools } = await client.listTools();
      const search = tools.find((tool) => tool.name === "search_listings");
      const shopListings = tools.find((tool) => tool.name === "get_shop_listings");

      assert.ok(search, "search_listings is discoverable");
      assert.ok(shopListings, "get_shop_listings remains discoverable");
      assert.deepEqual(search.inputSchema.required, ["keywords"]);
      assert.equal(search.inputSchema.properties.taxonomy_id.type, "integer");
      assert.equal(search.inputSchema.properties.taxonomy_id.minimum, 1);
      assert.equal(
        search.inputSchema.properties.taxonomy_id.maximum,
        Number.MAX_SAFE_INTEGER,
      );
      assert.equal(search.inputSchema.properties.shop_location.type, "string");
      assert.equal(search.inputSchema.properties.shop_location.maxLength, 200);
      assert.equal(search.inputSchema.properties.is_safe.type, "boolean");
      assert.equal(search.inputSchema.properties.currency.pattern, "^[A-Z]{3}$");
      assert.equal(search.inputSchema.properties.currency.minLength, 3);
      assert.equal(search.inputSchema.properties.currency.maxLength, 3);
      assert.equal(search.inputSchema.properties.buyer_country.pattern, "^[A-Z]{2}$");
      assert.equal(search.inputSchema.properties.buyer_country.minLength, 2);
      assert.equal(search.inputSchema.properties.buyer_country.maxLength, 2);
      assert.match(search.inputSchema.properties.sort_order.description, /score.*descending/i);
      assert.equal(search.inputSchema.properties.limit.maximum, 100);
      assert.equal(search.inputSchema.properties.offset.maximum, 12000);
      for (const filter of [
        "taxonomy_id", "shop_location", "is_safe", "currency", "buyer_country",
      ]) {
        assert.equal(
          Object.hasOwn(shopListings.inputSchema.properties, filter),
          false,
          `${filter} is not added to the shop-scoped search`,
        );
      }
    },
  );
});

test("seller taxonomy IDs and all documented listing filters reach the active-search GET", async () => {
  const calls = [];
  await withMcp(
    mockAdapter((config) => {
      if (config.url === "/application/seller-taxonomy/nodes") {
        return successResponse(config, {
          count: 1,
          results: [{
            id: 54321,
            name: "Handmade ceramics",
            level: 0,
            parent_id: null,
            full_path_taxonomy_ids: [54321],
            children: [],
          }],
        });
      }
      return successResponse(config, {
        count: 2,
        results: [{
          listing_id: 73,
          title: "Original shop price",
          description: "Hand-thrown stoneware.",
          price: { amount: 1800, divisor: 100, currency_code: "USD" },
          converted_price: { amount: 1650, divisor: 100, currency_code: "EUR" },
          url: "https://www.etsy.com/listing/73",
          shop_id: 9,
          quantity: 2,
          state: "active",
          created_timestamp: 1700000000,
          updated_timestamp: 1700000100,
          tags: ["ceramic", "mug"],
          buyer_email: "private@example.invalid",
          api_key: syntheticKey,
        }, {
          listing_id: 74,
          title: "Unavailable source price",
          price: null,
          converted_price: null,
          url: "https://www.etsy.com/listing/74",
          shop_id: 9,
        }],
      });
    }, calls),
    async ({ client, etsyClient }) => {
      const taxonomy = await client.callTool({
        name: "get_taxonomy_nodes",
        arguments: { taxonomy_type: "seller" },
      });
      assert.equal(taxonomy.isError, undefined, taxonomy.content[0].text);
      const sellerCategoryId = jsonText(taxonomy).results[0].id;

      const response = await client.callTool({
        name: "search_listings",
        arguments: {
          keywords: "  handmade mugs & pottery  ",
          limit: 8,
          offset: 25,
          min_price: 10,
          max_price: 50,
          sort_on: "price",
          sort_order: "ascending",
          taxonomy_id: sellerCategoryId,
          shop_location: "  Montréal, QC  ",
          is_safe: false,
          currency: "EUR",
          buyer_country: "DE",
        },
      });

      assert.equal(response.isError, undefined, response.content[0].text);
      assert.deepEqual(calls.map((call) => call.url), [
        "/application/seller-taxonomy/nodes",
        "/application/listings/active",
      ]);
      assert.equal(calls[1].method, "get");
      assert.deepEqual(calls[1].params, {
        keywords: "handmade mugs & pottery",
        limit: 8,
        offset: 25,
        min_price: 10,
        max_price: 50,
        taxonomy_id: 54321,
        shop_location: "Montréal, QC",
        is_safe: false,
        currency: "EUR",
        buyer_country: "DE",
        sort_on: "price",
        sort_order: "ascending",
      });
      assert.equal(
        etsyClient.getUri(calls[1]),
        "https://openapi.etsy.com/v3/application/listings/active?keywords=handmade+mugs+%26+pottery&limit=8&offset=25&min_price=10&max_price=50&taxonomy_id=54321&shop_location=Montr%C3%A9al,+QC&is_safe=false&currency=EUR&buyer_country=DE&sort_on=price&sort_order=ascending",
      );

      const result = jsonText(response);
      assert.equal(result.count, 2);
      assert.equal(result.results[0].price, "18 USD");
      assert.equal(Object.hasOwn(result.results[0], "converted_price"), false);
      assert.equal(result.results[1].price, "N/A");
      assert.equal(Object.hasOwn(result.results[1], "converted_price"), false);
      assert.equal(JSON.stringify(result).includes(syntheticKey), false);
      assert.equal(JSON.stringify(result).includes("private@example.invalid"), false);
    },
  );
});

test("listing search rejects invalid new filter types and values before any Etsy request", async () => {
  const calls = [];
  const invalidFilters = [
    { taxonomy_id: 0 },
    { taxonomy_id: -1 },
    { taxonomy_id: 1.5 },
    { taxonomy_id: Number.MAX_SAFE_INTEGER + 1 },
    { taxonomy_id: "123" },
    { taxonomy_id: [] },
    { shop_location: "   " },
    { shop_location: "x".repeat(201) },
    { shop_location: 3 },
    { shop_location: null },
    { shop_location: ["New York"] },
    { is_safe: "false" },
    { is_safe: 0 },
    { is_safe: null },
    { is_safe: [] },
    { currency: "usd" },
    { currency: "US" },
    { currency: "USDD" },
    { currency: " USD " },
    { currency: "USD\n" },
    { currency: "$UD" },
    { currency: 123 },
    { currency: [] },
    { currency: null },
    { buyer_country: "us" },
    { buyer_country: "USA" },
    { buyer_country: "1D" },
    { buyer_country: " DE " },
    { buyer_country: "DE\n" },
    { buyer_country: [] },
    { buyer_country: null },
  ];

  await withMcp(
    mockAdapter((config) => successResponse(config, { count: 0, results: [] }), calls),
    async ({ client }) => {
      for (const filter of invalidFilters) {
        const response = await client.callTool({
          name: "search_listings",
          arguments: { keywords: "mug", ...filter },
        });
        assert.equal(response.isError, true, JSON.stringify(filter));
        assert.match(response.content[0].text, /^Error:/, JSON.stringify(filter));
      }
      assert.equal(calls.length, 0, "invalid filters must not reach the request adapter");
    },
  );
});

test("score ordering is always sent descending while other sort aliases are preserved", async () => {
  const calls = [];
  await withMcp(
    mockAdapter((config) => successResponse(config, { count: 0, results: [] }), calls),
    async ({ client }) => {
      for (const sortOrder of ["asc", "ascending", "up", "desc", "descending", "down"]) {
        const response = await client.callTool({
          name: "search_listings",
          arguments: { keywords: "mug", sort_on: "score", sort_order: sortOrder },
        });
        assert.equal(response.isError, undefined, response.content[0].text);
      }
      const implicitScoreOrder = await client.callTool({
        name: "search_listings",
        arguments: { keywords: "mug", sort_on: "score" },
      });
      assert.equal(implicitScoreOrder.isError, undefined, implicitScoreOrder.content[0].text);

      for (const sortOrder of ["asc", "ascending", "up", "desc", "descending", "down"]) {
        const response = await client.callTool({
          name: "search_listings",
          arguments: { keywords: "mug", sort_on: "price", sort_order: sortOrder },
        });
        assert.equal(response.isError, undefined, response.content[0].text);
      }
      const defaultSort = await client.callTool({
        name: "search_listings",
        arguments: { keywords: "mug" },
      });
      assert.equal(defaultSort.isError, undefined, defaultSort.content[0].text);

      for (const call of calls.slice(0, 7)) {
        assert.equal(call.params.sort_on, "score");
        assert.equal(call.params.sort_order, "desc");
      }
      assert.deepEqual(calls.slice(7, 13).map((call) => call.params.sort_order), [
        "asc", "ascending", "up", "desc", "descending", "down",
      ]);
      assert.equal(Object.hasOwn(calls[13].params, "sort_on"), false);
      assert.equal(Object.hasOwn(calls[13].params, "sort_order"), false);
      assert.deepEqual(calls[13].params, { keywords: "mug", limit: 25, offset: 0 });
    },
  );
});

test("listing-search validation errors do not disclose upstream bodies or API credentials", async () => {
  const calls = [];
  await withMcp(
    mockAdapter((config) => {
      throw httpError(config, 400, {
        error: `untrusted Etsy response ${syntheticKey}`,
      });
    }, calls),
    async ({ client }) => {
      const response = await client.callTool({
        name: "search_listings",
        arguments: { keywords: "mug", shop_location: "Somewhere" },
      });
      assert.equal(response.isError, true);
      assert.match(response.content[0].text, /^Error:/);
      assert.doesNotMatch(response.content[0].text, /untrusted Etsy response|synthetic-key|synthetic-secret/);
      assert.equal(calls.length, 1);
    },
  );
});

test("listing search output stays bounded and reports removed result rows", async () => {
  const listings = Array.from({ length: 100 }, (_, index) => ({
    listing_id: index + 1,
    title: "T".repeat(250),
    description: "D".repeat(1500),
    price: { amount: 1250, divisor: 100, currency_code: "USD" },
    url: `https://www.etsy.com/listing/${index + 1}`,
    shop_id: 9,
    quantity: 1,
    state: "active",
    created_timestamp: 1700000000,
    updated_timestamp: 1700000100,
    tags: Array.from({ length: 20 }, () => "G".repeat(100)),
  }));
  await withMcp(
    mockAdapter((config) => successResponse(config, {
      count: listings.length,
      results: listings,
    })),
    async ({ client }) => {
      const response = await client.callTool({
        name: "search_listings",
        arguments: { keywords: "mug", limit: 100 },
      });
      assert.equal(response.isError, undefined, response.content[0].text);
      const raw = response.content[0].text;
      const result = JSON.parse(raw);
      assert.ok(Buffer.byteLength(raw, "utf8") <= 128 * 1024);
      assert.equal(result.count, 100);
      assert.equal(result.truncated, true);
      assert.equal(result.returned, result.results.length);
      assert.ok(result.returned > 0 && result.returned < 100);
    },
  );
});

test("public listing search remains a GET while the development mutation lock is enabled", async () => {
  const calls = [];
  await withMcp(
    mockAdapter((config) => successResponse(config, { count: 0, results: [] }), calls),
    async ({ client }) => {
      const response = await client.callTool({
        name: "search_listings",
        arguments: {
          keywords: "mug",
          taxonomy_id: 42,
          is_safe: false,
          currency: "USD",
          buyer_country: "US",
        },
      });
      assert.equal(response.isError, undefined, response.content[0].text);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].method, "get");
      assert.deepEqual(calls[0].params, {
        keywords: "mug",
        limit: 25,
        offset: 0,
        taxonomy_id: 42,
        is_safe: false,
        currency: "USD",
        buyer_country: "US",
      });
    },
    (etsyClient) => createEtsyMcpServer(etsyClient, { developmentMode: true }),
  );
});
