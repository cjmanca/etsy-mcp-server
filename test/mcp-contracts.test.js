import assert from "node:assert/strict";
import { AxiosError } from "axios";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { createEtsyMcpServer } from "../build/index.js";
import {
  httpError,
  jsonText,
  mockAdapter,
  successResponse,
  syntheticKey,
  withMcp,
} from "./helpers/mcp.js";

const PUBLIC_TOOL_NAMES = [
  "get_featured_shop_listings",
  "get_listing_buyer_prices",
  "get_listing_details",
  "get_listing_reviews",
  "get_listings_batch",
  "get_shop",
  "get_shop_by_name",
  "get_shop_by_owner",
  "get_shop_listings",
  "get_shop_reviews",
  "get_shop_section",
  "get_shop_section_listings",
  "get_shop_sections",
  "get_taxonomy_nodes",
  "get_taxonomy_properties",
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

test("tool discovery lists exactly seventeen public tools with accurate safety annotations", async () => {
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

test("taxonomy tool discovery requires an explicit buyer or seller selector", async () => {
  await withMcp(
    mockAdapter((config) => successResponse(config, { count: 0, results: [] })),
    async ({ client }) => {
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((tool) => tool.name).sort(), PUBLIC_TOOL_NAMES);
      const tool = tools.find((candidate) => candidate.name === "get_taxonomy_nodes");
      assert.ok(tool, "get_taxonomy_nodes is discoverable");
      assert.deepEqual(tool.inputSchema.required, ["taxonomy_type"]);
      assert.deepEqual(
        tool.inputSchema.properties.taxonomy_type.enum,
        ["buyer", "seller"],
      );
      assert.equal(tool.inputSchema.properties.taxonomy_id.minimum, 1);
      assert.equal(tool.inputSchema.properties.name.maxLength, 200);
      assert.equal(tool.inputSchema.properties.limit.maximum, 100);
      assert.equal(tool.inputSchema.properties.offset.maximum, 12000);
      assert.deepEqual(tool.annotations, {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      });
    },
  );
});

test("taxonomy node browsing uses separate buyer and seller routes and local filters", async () => {
  const calls = [];
  const buyerTree = {
    count: 1,
    results: [{
      id: 100,
      name: "Crafts",
      level: 0,
      parent_id: null,
      full_path_taxonomy_ids: [100],
      children: [{
        id: 101,
        name: "Home & Living",
        level: 1,
        parent_id: 100,
        full_path_taxonomy_ids: [100, 101],
        children: [{
          id: 102,
          name: "Mugs",
          level: 2,
          parent_id: 101,
          full_path_taxonomy_ids: [100, 101, 102],
          children: [],
        }],
      }],
    }],
  };
  const sellerTree = {
    count: 1,
    results: [{
      id: 200,
      name: "Seller supplies",
      level: 0,
      parent_id: null,
      full_path_taxonomy_ids: [200],
      children: [],
    }],
  };

  await withMcp(
    mockAdapter((config) => successResponse(
      config,
      config.url === "/application/buyer-taxonomy/nodes" ? buyerTree : sellerTree,
    ), calls),
    async ({ client }) => {
      const buyerResponse = await client.callTool({
        name: "get_taxonomy_nodes",
        arguments: {
          taxonomy_type: "buyer",
          taxonomy_id: 101,
          name: "mug",
          limit: 1,
        },
      });
      assert.equal(buyerResponse.isError, undefined, buyerResponse.content[0].text);
      const buyer = jsonText(buyerResponse);
      assert.equal(buyer.taxonomy_type, "buyer");
      assert.equal(buyer.count, 1);
      assert.equal(buyer.count_scope, "locally matched nodes");
      assert.deepEqual(buyer.filters_applied, {
        scope: "local",
        taxonomy_id: 101,
        name: "mug",
      });
      assert.equal(buyer.returned, 1);
      assert.equal(buyer.truncated, false);
      assert.deepEqual(buyer.results, [{
        id: 102,
        name: "Mugs",
        level: 2,
        parent_id: 101,
        full_path_taxonomy_ids: [100, 101, 102],
        child_ids: [],
        child_count: 0,
      }]);
      assert.match(buyer.untrusted_content_notice, /untrusted third-party data/i);

      const buyerPageResponse = await client.callTool({
        name: "get_taxonomy_nodes",
        arguments: { taxonomy_type: "buyer", taxonomy_id: 101, limit: 1, offset: 1 },
      });
      assert.equal(buyerPageResponse.isError, undefined, buyerPageResponse.content[0].text);
      const buyerPage = jsonText(buyerPageResponse);
      assert.equal(buyerPage.count, 2);
      assert.equal(buyerPage.returned, 1);
      assert.equal(buyerPage.offset, 1);
      assert.equal(buyerPage.results[0].id, 102);

      const sellerResponse = await client.callTool({
        name: "get_taxonomy_nodes",
        arguments: { taxonomy_type: "seller" },
      });
      assert.equal(sellerResponse.isError, undefined, sellerResponse.content[0].text);
      const seller = jsonText(sellerResponse);
      assert.equal(seller.taxonomy_type, "seller");
      assert.equal(seller.count, 1);
      assert.deepEqual(seller.results[0], {
        id: 200,
        name: "Seller supplies",
        level: 0,
        parent_id: null,
        full_path_taxonomy_ids: [200],
        child_ids: [],
        child_count: 0,
      });

      assert.deepEqual(calls.map((config) => config.url), [
        "/application/buyer-taxonomy/nodes",
        "/application/seller-taxonomy/nodes",
      ]);
      assert.equal(calls[0].params, undefined, "the buyer endpoint has no filters");
      assert.equal(calls[1].params, undefined, "the seller endpoint has no filters");
    },
  );
});

test("taxonomy arguments reject invalid selectors and bounds before any request", async () => {
  const calls = [];
  await withMcp(
    mockAdapter((config) => successResponse(config, { results: [] }), calls),
    async ({ client }) => {
      const invalidArguments = [
        [{}, /taxonomy_type/i],
        [{ taxonomy_type: "other" }, /taxonomy_type/i],
        [{ taxonomy_type: "BUYER" }, /taxonomy_type/i],
        [{ taxonomy_type: "buyer", taxonomy_id: 0 }, /taxonomy_id/i],
        [{ taxonomy_type: "buyer", taxonomy_id: -1 }, /taxonomy_id/i],
        [{ taxonomy_type: "buyer", taxonomy_id: 1.5 }, /taxonomy_id/i],
        [{ taxonomy_type: "buyer", taxonomy_id: Number.MAX_SAFE_INTEGER + 1 }, /taxonomy_id/i],
        [{ taxonomy_type: "buyer", name: "  " }, /name/i],
        [{ taxonomy_type: "buyer", name: "n".repeat(201) }, /name/i],
        [{ taxonomy_type: "buyer", limit: 0 }, /limit/i],
        [{ taxonomy_type: "buyer", limit: 101 }, /limit/i],
        [{ taxonomy_type: "buyer", offset: -1 }, /offset/i],
        [{ taxonomy_type: "buyer", offset: 12001 }, /offset/i],
        [{ taxonomy_type: "buyer", offset: 1.5 }, /offset/i],
      ];
      for (const [args, expectedField] of invalidArguments) {
        const response = await client.callTool({
          name: "get_taxonomy_nodes",
          arguments: args,
        });
        assert.equal(response.isError, true, JSON.stringify(args));
        assert.match(response.content[0].text, expectedField, JSON.stringify(args));
      }
      assert.equal(calls.length, 0);
    },
  );
});

test("taxonomy subtree misses are errors while name misses are empty local matches", async () => {
  const calls = [];
  await withMcp(
    mockAdapter((config) => successResponse(config, {
      count: 1,
      results: [{
        id: 10,
        name: "Art",
        level: 0,
        parent_id: null,
        full_path_taxonomy_ids: [10],
        children: [],
      }],
    }), calls),
    async ({ client }) => {
      const missingSubtree = await client.callTool({
        name: "get_taxonomy_nodes",
        arguments: { taxonomy_type: "buyer", taxonomy_id: 999 },
      });
      assert.equal(missingSubtree.isError, true);
      assert.match(missingSubtree.content[0].text, /taxonomy_id.*not found.*buyer/i);

      const missingName = await client.callTool({
        name: "get_taxonomy_nodes",
        arguments: { taxonomy_type: "buyer", name: "ceramics" },
      });
      assert.equal(missingName.isError, undefined);
      assert.equal(jsonText(missingName).count, 0);
      assert.deepEqual(jsonText(missingName).results, []);
      assert.equal(calls.length, 1, "the complete buyer tree is reused from cache");
    },
  );
});

test("taxonomy tree cache is selector-isolated, single-flight, and expires", async () => {
  const calls = [];
  let now = 1_000;
  const createServer = (etsyClient) => createEtsyMcpServer(etsyClient, {
    now: () => now,
  });
  await withMcp(
    mockAdapter((config) => successResponse(config, {
      count: 1,
      results: [{
        id: config.url === "/application/buyer-taxonomy/nodes" ? 10 : 20,
        name: config.url === "/application/buyer-taxonomy/nodes" ? "Buyer" : "Seller",
        level: 0,
        parent_id: null,
        full_path_taxonomy_ids: [config.url === "/application/buyer-taxonomy/nodes" ? 10 : 20],
        children: [],
      }],
    }), calls),
    async ({ client }) => {
      const buyerArguments = {
        name: "Buyer",
        taxonomy_type: "buyer",
      };
      const concurrentBuyerResults = await Promise.all([
        client.callTool({ name: "get_taxonomy_nodes", arguments: buyerArguments }),
        client.callTool({ name: "get_taxonomy_nodes", arguments: buyerArguments }),
      ]);
      for (const response of concurrentBuyerResults) {
        assert.equal(response.isError, undefined, response.content[0].text);
        assert.equal(jsonText(response).results[0].id, 10);
      }
      assert.equal(calls.length, 1, "concurrent cold buyer calls share one acquisition");

      const sellerResponse = await client.callTool({
        name: "get_taxonomy_nodes",
        arguments: { taxonomy_type: "seller" },
      });
      assert.equal(sellerResponse.isError, undefined, sellerResponse.content[0].text);
      assert.equal(jsonText(sellerResponse).results[0].id, 20);
      assert.equal(calls.length, 2, "seller data uses an independent cache entry");

      now += 16 * 60 * 1000;
      const expiredBuyerResponse = await client.callTool({
        name: "get_taxonomy_nodes",
        arguments: buyerArguments,
      });
      assert.equal(expiredBuyerResponse.isError, undefined, expiredBuyerResponse.content[0].text);
      assert.equal(jsonText(expiredBuyerResponse).results[0].id, 10);
      assert.equal(calls.length, 3, "an expired complete tree is acquired again");
      assert.deepEqual(calls.map((config) => config.url), [
        "/application/buyer-taxonomy/nodes",
        "/application/seller-taxonomy/nodes",
        "/application/buyer-taxonomy/nodes",
      ]);
    },
    createServer,
  );
});

test("malformed taxonomy trees are rejected and never poison the cache", async () => {
  const calls = [];
  await withMcp(
    mockAdapter((config, callNumber) => successResponse(config, callNumber === 1
      ? {
          count: 1,
          results: [{
            id: 10,
            name: "Valid root",
            level: 0,
            parent_id: null,
            full_path_taxonomy_ids: [10],
            children: [{
              id: 11,
              name: "UNTRUSTED MALFORMED NAME",
              level: 1,
              parent_id: 10,
              full_path_taxonomy_ids: [999, 11],
              children: [],
            }],
          }],
        }
      : {
          count: 1,
          results: [{
            id: 10,
            name: "Valid root",
            level: 0,
            parent_id: null,
            full_path_taxonomy_ids: [10],
            children: [],
          }],
        }), calls),
    async ({ client }) => {
      const malformed = await client.callTool({
        name: "get_taxonomy_nodes",
        arguments: { taxonomy_type: "buyer" },
      });
      assert.equal(malformed.isError, true);
      assert.equal(malformed.content[0].text.includes("UNTRUSTED MALFORMED NAME"), false);

      const valid = await client.callTool({
        name: "get_taxonomy_nodes",
        arguments: { taxonomy_type: "buyer" },
      });
      assert.equal(valid.isError, undefined, valid.content[0].text);
      assert.equal(jsonText(valid).results[0].name, "Valid root");
      assert.equal(calls.length, 2, "the malformed response was not cached as complete");
    },
  );
});

test("inconsistent taxonomy result counts are rejected without caching partial trees", async () => {
  const calls = [];
  const root = {
    id: 10,
    name: "Root",
    level: 0,
    parent_id: null,
    full_path_taxonomy_ids: [10],
    children: [{
      id: 11,
      name: "Child",
      level: 1,
      parent_id: 10,
      full_path_taxonomy_ids: [10, 11],
      children: [],
    }],
  };
  const responses = [
    { count: 5, results: [] },
    {
      count: 1,
      results: [
        {
          id: 10,
          name: "First root",
          level: 0,
          parent_id: null,
          full_path_taxonomy_ids: [10],
          children: [],
        },
        {
          id: 20,
          name: "Second root",
          level: 0,
          parent_id: null,
          full_path_taxonomy_ids: [20],
          children: [],
        },
      ],
    },
    { count: 1, results: [root] },
  ];

  await withMcp(
    mockAdapter((config, callNumber) => successResponse(config, responses[callNumber - 1]), calls),
    async ({ client }) => {
      for (let index = 0; index < 2; index += 1) {
        const inconsistent = await client.callTool({
          name: "get_taxonomy_nodes",
          arguments: { taxonomy_type: "buyer" },
        });
        assert.equal(inconsistent.isError, true, `inconsistent response ${index + 1}`);
        assert.match(inconsistent.content[0].text, /invalid taxonomy tree/i);
      }

      const complete = await client.callTool({
        name: "get_taxonomy_nodes",
        arguments: { taxonomy_type: "buyer" },
      });
      assert.equal(complete.isError, undefined, complete.content[0].text);
      assert.equal(jsonText(complete).count, 2);
      assert.deepEqual(jsonText(complete).results.map((node) => node.id), [10, 11]);

      const cached = await client.callTool({
        name: "get_taxonomy_nodes",
        arguments: { taxonomy_type: "buyer" },
      });
      assert.equal(cached.isError, undefined, cached.content[0].text);
      assert.equal(calls.length, 3, "only the complete root-count-consistent tree was cached");
    },
  );
});

test("nested taxonomy parents derive for null or omitted IDs and reject conflicts", async () => {
  const calls = [];
  const responses = [
    {
      count: 1,
      results: [{
        id: 10,
        name: "Root",
        level: 0,
        parent_id: null,
        full_path_taxonomy_ids: [10],
        children: [{
          id: 11,
          name: "Conflicting child",
          level: 1,
          parent_id: 99,
          full_path_taxonomy_ids: [10, 11],
          children: [],
        }],
      }],
    },
    {
      count: 1,
      results: [{
        id: 10,
        name: "Root",
        level: 0,
        parent_id: null,
        full_path_taxonomy_ids: [10],
        children: [{
          id: 11,
          name: "Null parent",
          level: 1,
          parent_id: null,
          full_path_taxonomy_ids: [10, 11],
          children: [],
        }, {
          id: 12,
          name: "Omitted parent",
          level: 1,
          full_path_taxonomy_ids: [10, 12],
          children: [],
        }],
      }],
    },
  ];

  await withMcp(
    mockAdapter((config, callNumber) => successResponse(config, responses[callNumber - 1]), calls),
    async ({ client }) => {
      const conflicting = await client.callTool({
        name: "get_taxonomy_nodes",
        arguments: { taxonomy_type: "seller" },
      });
      assert.equal(conflicting.isError, true);
      assert.match(conflicting.content[0].text, /invalid taxonomy tree/i);

      const derived = await client.callTool({
        name: "get_taxonomy_nodes",
        arguments: { taxonomy_type: "seller" },
      });
      assert.equal(derived.isError, undefined, derived.content[0].text);
      assert.deepEqual(jsonText(derived).results, [
        {
          id: 10,
          name: "Root",
          level: 0,
          parent_id: null,
          full_path_taxonomy_ids: [10],
          child_ids: [11, 12],
          child_count: 2,
        },
        {
          id: 11,
          name: "Null parent",
          level: 1,
          parent_id: 10,
          full_path_taxonomy_ids: [10, 11],
          child_ids: [],
          child_count: 0,
        },
        {
          id: 12,
          name: "Omitted parent",
          level: 1,
          parent_id: 10,
          full_path_taxonomy_ids: [10, 12],
          child_ids: [],
          child_count: 0,
        },
      ]);

      const cached = await client.callTool({
        name: "get_taxonomy_nodes",
        arguments: { taxonomy_type: "seller" },
      });
      assert.equal(cached.isError, undefined, cached.content[0].text);
      assert.equal(calls.length, 2, "the conflicting tree was rejected before the valid tree was cached");
    },
  );
});

test("taxonomy trees with duplicate IDs or cyclic descendants are rejected", async () => {
  const calls = [];
  const cyclicRoot = {
    id: 1,
    name: "Cycle",
    level: 0,
    parent_id: null,
    full_path_taxonomy_ids: [1],
    children: [],
  };
  cyclicRoot.children.push(cyclicRoot);
  await withMcp(
    mockAdapter((config, callNumber) => successResponse(config, {
      count: 1,
      results: callNumber === 1
        ? [{
            id: 1,
            name: "Root",
            level: 0,
            parent_id: null,
            full_path_taxonomy_ids: [1],
            children: [{
              id: 2,
              name: "Child",
              level: 1,
              parent_id: 1,
              full_path_taxonomy_ids: [1, 2],
              children: [],
            }],
          }, {
            id: 2,
            name: "Duplicate root",
            level: 0,
            parent_id: null,
            full_path_taxonomy_ids: [2],
            children: [],
          }]
        : [cyclicRoot],
    }), calls),
    async ({ client }) => {
      for (let index = 0; index < 2; index += 1) {
        const response = await client.callTool({
          name: "get_taxonomy_nodes",
          arguments: { taxonomy_type: "seller" },
        });
        assert.equal(response.isError, true);
        assert.doesNotMatch(response.content[0].text, /Duplicate root|Cycle/);
      }
      assert.equal(calls.length, 2, "neither malformed tree was accepted into cache");
    },
  );
});

test("taxonomy tree depth, node count, and retained names have hard acquisition bounds", async () => {
  const deepRoot = (() => {
    let node = {
      id: 34,
      name: "Node 34",
      level: 33,
      parent_id: 33,
      full_path_taxonomy_ids: Array.from({ length: 34 }, (_, index) => index + 1),
      children: [],
    };
    for (let id = 33; id >= 1; id -= 1) {
      node = {
        id,
        name: `Node ${id}`,
        level: id - 1,
        parent_id: id === 1 ? null : id - 1,
        full_path_taxonomy_ids: Array.from({ length: id }, (_, index) => index + 1),
        children: [node],
      };
    }
    return node;
  })();
  const cases = [
    {
      label: "excessive depth",
      response: { count: 1, results: [deepRoot] },
    },
    {
      label: "excessive node count",
      response: {
        count: 20_001,
        results: Array.from({ length: 20_001 }, (_, index) => ({
          id: index + 1,
          name: "Node",
          level: 0,
          parent_id: null,
          full_path_taxonomy_ids: [index + 1],
          children: [],
        })),
      },
    },
    {
      label: "excessive retained name length",
      response: {
        count: 1,
        results: [{
          id: 1,
          name: "x".repeat(513),
          level: 0,
          parent_id: null,
          full_path_taxonomy_ids: [1],
          children: [],
        }],
      },
    },
  ];

  for (const scenario of cases) {
    const calls = [];
    await withMcp(
      mockAdapter((config) => successResponse(config, scenario.response), calls),
      async ({ client }) => {
        const response = await client.callTool({
          name: "get_taxonomy_nodes",
          arguments: { taxonomy_type: "buyer" },
        });
        assert.equal(response.isError, true, scenario.label);
        assert.doesNotMatch(response.content[0].text, /Node 34|x{50}/);
        assert.equal(calls.length, 1);
      },
    );
  }
});

test("taxonomy node output bounds text and child summaries under the MCP byte cap", async () => {
  const calls = [];
  const rootId = 1;
  const children = Array.from({ length: 30 }, (_, index) => {
    const id = index + 2;
    return {
      id,
      name: "Child ".concat("x".repeat(300)),
      level: 1,
      parent_id: rootId,
      full_path_taxonomy_ids: [rootId, id],
      children: [],
    };
  });
  await withMcp(
    mockAdapter((config) => successResponse(config, {
      count: 1,
      results: [{
        id: rootId,
        name: "Root ".concat("x".repeat(300)),
        level: 0,
        parent_id: null,
        full_path_taxonomy_ids: [rootId],
        children,
      }],
    }), calls),
    async ({ client }) => {
      const response = await client.callTool({
        name: "get_taxonomy_nodes",
        arguments: { taxonomy_type: "buyer", limit: 100 },
      });
      assert.equal(response.isError, undefined, response.content[0].text);
      assert.ok(Buffer.byteLength(response.content[0].text, "utf8") <= 128 * 1024);
      const result = jsonText(response);
      assert.equal(result.count, 31);
      assert.equal(result.returned, 31);
      assert.equal(result.truncated, true);
      assert.equal(result.results[0].child_count, 30);
      assert.equal(result.results[0].child_ids.length, 25);
      assert.equal(result.results[0].name.length, 200);
      assert.match(result.results[0].name, /\[truncated\]$/);
      assert.equal(result.results[1].name.length, 200);
      assert.match(result.untrusted_content_notice, /untrusted third-party data/i);
    },
  );
});

test("oversized taxonomy acquisitions fail actionably and do not cache partial data", async () => {
  const calls = [];
  await withMcp(
    mockAdapter((config, callNumber) => {
      if (callNumber === 1) {
        throw new AxiosError(
          "maxContentLength size of 1048576 exceeded",
          AxiosError.ERR_BAD_RESPONSE,
          config,
        );
      }
      return successResponse(config, {
        count: 1,
        results: [{
          id: 10,
          name: "Recovered",
          level: 0,
          parent_id: null,
          full_path_taxonomy_ids: [10],
          children: [],
        }],
      });
    }, calls),
    async ({ client, etsyClient }) => {
      assert.equal(etsyClient.defaults.maxContentLength, 1024 * 1024);
      const oversized = await client.callTool({
        name: "get_taxonomy_nodes",
        arguments: { taxonomy_type: "buyer", name: "never sent upstream" },
      });
      assert.equal(oversized.isError, true);
      assert.match(oversized.content[0].text, /full buyer taxonomy tree.*1 MiB/i);
      assert.match(oversized.content[0].text, /local filters cannot reduce|no partial/i);
      assert.equal(oversized.content[0].text.includes("1048576"), false);

      const recovered = await client.callTool({
        name: "get_taxonomy_nodes",
        arguments: { taxonomy_type: "buyer" },
      });
      assert.equal(recovered.isError, undefined, recovered.content[0].text);
      assert.equal(jsonText(recovered).results[0].id, 10);
      assert.equal(calls.length, 2, "oversized acquisition was not cached");
      assert.equal(calls[0].params, undefined, "filters never alter the full-tree request");
    },
  );
});

test("taxonomy API errors sanitize upstream bodies and credentials", async () => {
  const calls = [];
  await withMcp(
    mockAdapter((config) => {
      throw httpError(config, 401, { error: `untrusted upstream ${syntheticKey}` });
    }, calls),
    async ({ client }) => {
      const response = await client.callTool({
        name: "get_taxonomy_nodes",
        arguments: { taxonomy_type: "seller" },
      });
      assert.equal(response.isError, true);
      assert.match(response.content[0].text, /credentials/);
      assert.equal(response.content[0].text.includes(syntheticKey), false);
      assert.equal(response.content[0].text.includes("untrusted upstream"), false);
      assert.equal(calls.length, 1);
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
