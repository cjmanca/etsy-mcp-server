import assert from "node:assert/strict";
import { createServer } from "node:http";
import { getDefaultResultOrder, setDefaultResultOrder } from "node:dns";
import { once } from "node:events";
import test from "node:test";
import axios, { AxiosError } from "axios";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  ConfigurationError,
  createEtsyClient,
  validateApiKey,
} from "../build/etsy-client.js";
import { createEtsyMcpServer } from "../build/index.js";

const syntheticKey = "synthetic-key:synthetic-secret";

function successResponse(config, data) {
  return { data, status: 200, statusText: "OK", headers: {}, config };
}

function httpError(config, status, data = {}, headers = {}) {
  const response = {
    data,
    status,
    statusText: "Simulated response",
    headers,
    config,
  };
  return new AxiosError(
    "Simulated HTTP failure",
    AxiosError.ERR_BAD_REQUEST,
    config,
    undefined,
    response,
  );
}

async function withMcp(adapter, run) {
  const etsyClient = createEtsyClient(syntheticKey);
  etsyClient.defaults.adapter = adapter;
  const server = createEtsyMcpServer(etsyClient);
  const client = new Client(
    { name: "etsy-mcp-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  try {
    return await run({ client, etsyClient });
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
}

function mockAdapter(respond, calls = []) {
  return async (config) => {
    calls.push(config);
    return respond(config, calls.length);
  };
}

function jsonText(result) {
  assert.equal(result.content[0].type, "text");
  return JSON.parse(result.content[0].text);
}

test("credentials are validated without being repeated in errors", () => {
  assert.equal(validateApiKey(syntheticKey), syntheticKey);
  for (const malformed of [
    undefined,
    "",
    "only-a-keystring",
    "empty-secret:",
    ":empty-keystring",
    "too:many:parts",
    " secret-value ",
    "secret-value\n:part",
  ]) {
    assert.throws(
      () => validateApiKey(malformed),
      (error) => {
        assert.ok(error instanceof ConfigurationError);
        assert.equal(error.message.includes("secret-value"), false);
        return true;
      },
    );
  }

  const client = createEtsyClient(syntheticKey);
  assert.equal(client.defaults.baseURL, "https://openapi.etsy.com/v3");
  assert.equal(client.defaults.headers["x-api-key"], syntheticKey);
  assert.equal(client.defaults.maxRedirects, 0);
  assert.equal(client.defaults.timeout, 10_000);
  assert.equal(client.defaults.maxContentLength, 1024 * 1024);
  assert.equal(client.defaults.proxy, false);
  assert.equal(client.defaults.httpsAgent, undefined);
});

test("a cross-origin redirect is rejected without contacting its target", async () => {
  const previousDnsOrder = getDefaultResultOrder();
  setDefaultResultOrder("ipv4first");
  let sourceKey;
  let destinationRequests = 0;
  const destination = createServer((request, response) => {
    destinationRequests += 1;
    response.end("unexpected");
  });
  destination.listen(0, "127.0.0.1");
  await once(destination, "listening");
  const destinationPort = destination.address().port;

  const source = createServer((request, response) => {
    sourceKey = request.headers["x-api-key"];
    response.writeHead(302, {
      Location: `http://127.0.0.1:${destinationPort}/collect`,
    });
    response.end();
  });
  source.listen(0, "127.0.0.1");
  await once(source, "listening");

  try {
    await assert.rejects(
      axios.get(`http://localhost:${source.address().port}/redirect`, {
        headers: { "x-api-key": syntheticKey },
        maxRedirects: 0,
        proxy: false,
        timeout: 1000,
      }),
      (error) => error.response?.status === 302,
    );
    assert.equal(sourceKey, syntheticKey);
    assert.equal(destinationRequests, 0);
  } finally {
    source.close();
    destination.close();
    setDefaultResultOrder(previousDnsOrder);
  }
});

test("MCP tools validate arguments before requests and exclude unsupported features", async () => {
  const calls = [];
  await withMcp(
    mockAdapter((config) => successResponse(config, { count: 0, results: [] }), calls),
    async ({ client }) => {
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name).sort();
      assert.deepEqual(names, [
        "get_listing_details",
        "get_shop_by_name",
        "get_shop_listings",
        "get_shop_reviews",
        "search_listings",
        "search_shops",
      ]);
      assert.equal(
        listed.tools.find((tool) => tool.name === "get_listing_details")
          .inputSchema.properties.includes.items.enum.includes("Inventory"),
        false,
      );

      const invalidCalls = [
        ["get_listing_details", { listing_id: 0 }],
        ["get_listing_details", { listing_id: -1 }],
        ["get_listing_details", { listing_id: 1.5 }],
        ["get_listing_details", { listing_id: "1/../shops" }],
        ["get_listing_details", { listing_id: Number.MAX_SAFE_INTEGER + 1 }],
        ["get_listing_details", { listing_id: 1, includes: ["Inventory"] }],
        ["get_shop_listings", { shop_id: 73, keywords: "  " }],
        ["search_listings", { keywords: "  " }],
        ["search_listings", { keywords: "mugs", limit: 101 }],
        ["search_listings", { keywords: "mugs", offset: 12001 }],
        ["search_listings", { keywords: "mugs", min_price: -1 }],
        ["search_listings", { keywords: "mugs", min_price: 20, max_price: 10 }],
        ["search_listings", { keywords: "mugs", sort_on: "external" }],
        ["get_shop_reviews", { shop_id: 3, min_created: 1.5 }],
        ["get_shop_reviews", { shop_id: 3, min_created: 1700000000, max_created: 1600000000 }],
      ];

      for (const [name, args] of invalidCalls) {
        const result = await client.callTool({ name, arguments: args });
        assert.equal(result.isError, true, `${name} should reject invalid arguments`);
      }
      const unsupported = await client.callTool({
        name: "get_trending_listings",
        arguments: {},
      });
      assert.equal(unsupported.isError, true);
      assert.equal(calls.length, 0);
    },
  );
});

test("shop lookup uses findShops and shop listings use the public active route", async () => {
  const calls = [];
  await withMcp(
    mockAdapter((config) => {
      if (config.url === "/application/shops" && config.params.shop_name === "handmadehome") {
        return successResponse(config, {
          count: 2,
          results: [{ shop_id: 73, shop_name: "HandmadeHome", title: "Search result" }],
        });
      }
      if (config.url === "/application/shops/73") {
        return successResponse(config, {
          shop_id: 73,
          shop_name: "HandmadeHome",
          announcement: "A shop announcement",
        });
      }
      if (config.url === "/application/shops/73/listings/active") {
        return successResponse(config, { count: 1, results: [{ listing_id: 991 }] });
      }
      throw new Error(`Unexpected mocked URL: ${config.url}`);
    }, calls),
    async ({ client, etsyClient }) => {
      const shop = await client.callTool({
        name: "get_shop_by_name",
        arguments: { shop_name: "handmadehome" },
      });
      assert.equal(jsonText(shop).found, true);
      assert.equal(jsonText(shop).shop_id, 73);
      assert.equal(calls[0].url, "/application/shops");
      assert.equal(calls[0].params.shop_name, "handmadehome");
      assert.equal(calls[0].params.limit, 100);
      assert.equal(calls[0].headers.get("x-api-key"), syntheticKey);
      assert.equal(calls[1].url, "/application/shops/73");

      const listings = await client.callTool({
        name: "get_shop_listings",
        arguments: { shop_id: 73, limit: 1, offset: 0, sort_on: "price" },
      });
      assert.equal(jsonText(listings).count, 1);
      assert.equal(calls[2].url, "/application/shops/73/listings/active");
      assert.equal(calls[2].params.offset, 0);
      assert.equal(calls[2].params.sort_on, "price");
      assert.equal(etsyClient.defaults.baseURL, "https://openapi.etsy.com/v3");
      assert.equal(etsyClient.defaults.headers["x-api-key"], syntheticKey);
    },
  );
});

test("shop-name lookup reports ambiguous and missing exact matches", async () => {
  const calls = [];
  await withMcp(
    mockAdapter((config) => {
      if (config.params.shop_name === "ambiguous") {
        return successResponse(config, {
          count: 3,
          results: [
            { shop_id: 10, shop_name: "Ambiguous" },
            { shop_id: 11, shop_name: "AMBIGUOUS" },
          ],
        });
      }
      return successResponse(config, {
        count: 1,
        results: [{ shop_id: 12, shop_name: "SimilarButNotExact" }],
      });
    }, calls),
    async ({ client }) => {
      const ambiguous = await client.callTool({
        name: "get_shop_by_name",
        arguments: { shop_name: "ambiguous" },
      });
      assert.equal(jsonText(ambiguous).ambiguous, true);
      assert.equal(jsonText(ambiguous).matches.length, 2);

      const missing = await client.callTool({
        name: "get_shop_by_name",
        arguments: { shop_name: "missing" },
      });
      assert.equal(jsonText(missing).found, false);
      assert.equal(jsonText(missing).shop_name, "missing");
      assert.equal(calls.length, 2);
    },
  );
});

test("shop-name lookup finds an exact match on the second results page", async () => {
  const calls = [];
  await withMcp(
    mockAdapter((config) => {
      if (config.url === "/application/shops" && config.params.offset === 0) {
        return successResponse(config, {
          count: 101,
          results: Array.from({ length: 100 }, (_, index) => ({
            shop_id: index + 1,
            shop_name: `OtherShop${index}`,
          })),
        });
      }
      if (config.url === "/application/shops" && config.params.offset === 100) {
        return successResponse(config, {
          count: 101,
          results: [{ shop_id: 73, shop_name: "TargetShop" }],
        });
      }
      if (config.url === "/application/shops/73") {
        return successResponse(config, { shop_id: 73, shop_name: "TargetShop" });
      }
      throw new Error(`Unexpected mocked URL: ${config.url}`);
    }, calls),
    async ({ client }) => {
      const response = await client.callTool({
        name: "get_shop_by_name",
        arguments: { shop_name: "targetshop" },
      });
      const result = jsonText(response);
      assert.equal(result.found, true);
      assert.equal(result.shop_id, 73);
      assert.equal(calls[0].params.offset, 0);
      assert.equal(calls[1].params.offset, 100);
      assert.equal(calls[2].url, "/application/shops/73");
    },
  );
});

test("shop-name lookup marks searches incomplete at its bounded result limit", async () => {
  const calls = [];
  await withMcp(
    mockAdapter((config) => {
      const offset = config.params.offset;
      return successResponse(config, {
        count: 1000,
        results: Array.from({ length: 100 }, (_, index) => ({
          shop_id: offset + index + 1,
          shop_name: `OtherShop${offset + index}`,
        })),
      });
    }, calls),
    async ({ client }) => {
      const response = await client.callTool({
        name: "get_shop_by_name",
        arguments: { shop_name: "MissingExactShop" },
      });
      const result = jsonText(response);
      assert.equal(result.status, "incomplete");
      assert.equal(result.incomplete, true);
      assert.equal(Object.hasOwn(result, "found"), false);
      assert.equal(result.examined, 500);
      assert.equal(result.search_result_count, 1000);
      assert.deepEqual(calls.map((config) => config.params.offset), [0, 100, 200, 300, 400]);
    },
  );
});

test("shop listing keywords are forwarded with sorting options", async () => {
  const calls = [];
  await withMcp(
    mockAdapter((config) => successResponse(config, { count: 0, results: [] }), calls),
    async ({ client }) => {
      await client.callTool({
        name: "get_shop_listings",
        arguments: {
          shop_id: 73,
          keywords: "ceramic mug",
          sort_on: "price",
          sort_order: "asc",
        },
      });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, "/application/shops/73/listings/active");
      assert.equal(calls[0].params.keywords, "ceramic mug");
      assert.equal(calls[0].params.sort_on, "price");
      assert.equal(calls[0].params.sort_order, "asc");
    },
  );
});

test("search and review routes use documented query parameters", async () => {
  const calls = [];
  await withMcp(
    mockAdapter((config) => successResponse(config, { count: 0, results: [] }), calls),
    async ({ client }) => {
      const search = await client.callTool({
        name: "search_listings",
        arguments: { keywords: "ceramic mugs", min_price: 0, offset: 0 },
      });
      assert.equal(jsonText(search).count, 0);
      assert.equal(calls[0].url, "/application/listings/active");
      assert.equal(calls[0].params.min_price, 0);

      await client.callTool({
        name: "search_shops",
        arguments: { shop_name: "pottery", limit: 10 },
      });
      assert.equal(calls[1].url, "/application/shops");
      assert.equal(calls[1].params.shop_name, "pottery");

      await client.callTool({
        name: "get_shop_reviews",
        arguments: { shop_id: 12, min_created: 946684800, max_created: 1700000000 },
      });
      assert.equal(calls[2].url, "/application/shops/12/reviews");
      assert.equal(calls[2].params.min_created, 946684800);
      assert.equal(calls[2].params.max_created, 1700000000);
    },
  );
});

test("external text and total MCP output are truncated as valid JSON", async () => {
  const description = "seller text ".repeat(300);
  const calls = [];
  await withMcp(
    mockAdapter((config) => {
      const results = Array.from({ length: 100 }, (_, index) => ({
        listing_id: index + 1,
        title: "A".repeat(400),
        description,
        tags: ["tag".repeat(100)],
      }));
      return successResponse(config, { count: 250, results });
    }, calls),
    async ({ client }) => {
      const response = await client.callTool({
        name: "search_listings",
        arguments: { keywords: "craft", limit: 100 },
      });
      const bytes = Buffer.byteLength(response.content[0].text, "utf8");
      const result = jsonText(response);
      assert.ok(bytes <= 128 * 1024);
      assert.equal(result.count, 250);
      assert.equal(result.truncated, true);
      assert.equal(result.returned, result.results.length);
      assert.ok(result.returned < 100);
      assert.ok(result.results[0].title.length <= 250);
      assert.ok(result.results[0].description.length <= 1500);
      assert.match(result.results[0].description, /\[truncated\]$/);
      assert.match(result.untrusted_content_notice, /untrusted third-party data/);
    },
  );
});

test("authentication, timeout, and rate-limit errors never expose secrets", async () => {
  const calls = [];
  await withMcp(
    mockAdapter((config) => {
      if (config.url.endsWith("/1")) {
        throw httpError(config, 401, { error: `leaked ${syntheticKey}` });
      }
      if (config.url.endsWith("/2")) {
        throw new AxiosError("synthetic timeout", "ETIMEDOUT", config);
      }
      if (config.url.endsWith("/4")) {
        throw httpError(
          config,
          302,
          { error: `leaked ${syntheticKey}` },
          { location: "https://unrelated.invalid/collect" },
        );
      }
      throw httpError(
        config,
        429,
        { error: `leaked ${syntheticKey}` },
        { "retry-after": "30" },
      );
    }, calls),
    async ({ client }) => {
      for (const [id, expected] of [
        [1, /credentials/],
        [2, /timed out/],
        [3, /rate limit.*30 seconds/i],
        [4, /redirects are blocked/i],
      ]) {
        const result = await client.callTool({
          name: "get_listing_details",
          arguments: { listing_id: id },
        });
        assert.equal(result.isError, true);
        const message = result.content[0].text;
        assert.match(message, expected);
        assert.equal(message.includes(syntheticKey), false);
      }
      assert.equal(calls.length, 4);
    },
  );
});
