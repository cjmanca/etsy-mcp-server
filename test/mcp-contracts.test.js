import assert from "node:assert/strict";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import {
  jsonText,
  mockAdapter,
  successResponse,
  syntheticKey,
  withMcp,
} from "./helpers/mcp.js";

const PUBLIC_TOOL_NAMES = [
  "get_listing_details",
  "get_shop_by_name",
  "get_shop_listings",
  "get_shop_reviews",
  "search_listings",
  "search_shops",
];

function createRequestFixtureServer(etsyClient, onDispatch = () => {}) {
  const server = new McpServer(
    { name: "etsy-test-fixture", version: "1.0.0" },
    { capabilities: {} },
  );
  server.registerTool(
    "test_request_fixture",
    {
      inputSchema: {
        shop_id: z.number().int().positive(),
        query: z.string().min(1),
        note: z.string(),
      },
    },
    async ({ shop_id, query, note }) => {
      onDispatch();
      const response = await etsyClient.post(
        "/application/test-fixture",
        { shop_id, note },
        { params: { query } },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(response.data) }],
      };
    },
  );
  return server;
}

test("tool discovery lists exactly six public tools with accurate safety annotations", async () => {
  await withMcp(
    mockAdapter((config) => successResponse(config, { count: 0, results: [] })),
    async ({ client }) => {
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((tool) => tool.name).sort(), PUBLIC_TOOL_NAMES);
      for (const tool of tools) {
        assert.deepEqual(tool.annotations, {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        }, `${tool.name} annotations`);
      }
    },
  );
});

test("selected listing output omits unselected upstream fields and synthetic credentials", async () => {
  const calls = [];
  await withMcp(
    mockAdapter((config) => successResponse(config, {
      count: 1,
      results: [{
        listing_id: 73,
        title: "Blue ceramic mug",
        description: "Hand-thrown stoneware.",
        price: { amount: 1800, divisor: 100, currency_code: "USD" },
        url: "https://www.etsy.com/listing/73",
        shop_id: 9,
        quantity: 2,
        state: "active",
        created_timestamp: 1700000000,
        updated_timestamp: 1700000100,
        tags: ["ceramic", "mug"],
        buyer_email: "private@example.invalid",
        api_key: syntheticKey,
        unselected_private_field: "must not be returned",
      }],
    }), calls),
    async ({ client, etsyClient }) => {
      const response = await client.callTool({
        name: "search_listings",
        arguments: { keywords: "ceramic mugs & clay", limit: 1 },
      });
      const result = jsonText(response);
      assert.deepEqual(result.results[0], {
        listing_id: 73,
        title: "Blue ceramic mug",
        description: "Hand-thrown stoneware.",
        price: "18 USD",
        url: "https://www.etsy.com/listing/73",
        shop_id: 9,
        quantity: 2,
        state: "active",
        created: 1700000000,
        updated: 1700000100,
        tags: ["ceramic", "mug"],
      });
      assert.equal(JSON.stringify(result).includes(syntheticKey), false);
      assert.equal(JSON.stringify(result).includes("private@example.invalid"), false);
      assert.equal(JSON.stringify(result).includes("unselected_private_field"), false);
      assert.equal(
        etsyClient.getUri(calls[0]),
        "https://openapi.etsy.com/v3/application/listings/active?keywords=ceramic+mugs+%26+clay&limit=1&offset=0",
      );
      assert.equal(calls.length, 1);
    },
  );
});

test("Axios query and JSON body encoding are observable on a test-owned MCP tool", async () => {
  const calls = [];
  await withMcp(
    mockAdapter((config) => successResponse(config, { accepted: true }), calls),
    async ({ client, etsyClient }) => {
      const result = await client.callTool({
        name: "test_request_fixture",
        arguments: {
          shop_id: 73,
          query: "ceramic mugs & clay",
          note: "A & B",
        },
      });
      assert.equal(result.isError, undefined);
      assert.equal(calls.length, 1);
      const request = calls[0];
      assert.equal(request.method, "post");
      assert.equal(
        etsyClient.getUri(request),
        "https://openapi.etsy.com/v3/application/test-fixture?query=ceramic+mugs+%26+clay",
      );
      assert.equal(request.data, '{"shop_id":73,"note":"A & B"}');
      assert.deepEqual(JSON.parse(request.data), {
        shop_id: 73,
        note: "A & B",
      });
    },
    (etsyClient) => createRequestFixtureServer(etsyClient),
  );
});

test("MCP rejects invalid arguments for a newly registered fixture before its upstream request", async () => {
  const calls = [];
  let dispatches = 0;
  await withMcp(
    mockAdapter((config) => successResponse(config, { accepted: true }), calls),
    async ({ client }) => {
      const response = await client.callTool({
        name: "test_request_fixture",
        arguments: {
          shop_id: 0,
          query: "ceramic mugs",
          note: "should not dispatch",
        },
      });
      assert.equal(response.isError, true);
      assert.match(response.content[0].text, /input validation error/i);
      assert.equal(dispatches, 0);
      assert.equal(calls.length, 0);
    },
    (etsyClient) => createRequestFixtureServer(etsyClient, () => {
      dispatches += 1;
    }),
  );
});
