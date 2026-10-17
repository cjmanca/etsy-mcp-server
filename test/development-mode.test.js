import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import { createEtsyClient } from "../build/etsy-client.js";
import {
  CapabilityRegistry,
  createEtsyMcpServer,
} from "../build/index.js";
import {
  mockAdapter,
  successResponse,
  syntheticKey,
  withMcp,
} from "./helpers/mcp.js";

const DEVELOPMENT_MODE_ERROR = /ETSY_DEVELOPMENT_MODE=true.*read-only/i;

async function withDevelopmentMode(value, run) {
  const original = process.env.ETSY_DEVELOPMENT_MODE;
  if (value === undefined) {
    delete process.env.ETSY_DEVELOPMENT_MODE;
  } else {
    process.env.ETSY_DEVELOPMENT_MODE = value;
  }

  try {
    return await run();
  } finally {
    if (original === undefined) {
      delete process.env.ETSY_DEVELOPMENT_MODE;
    } else {
      process.env.ETSY_DEVELOPMENT_MODE = original;
    }
  }
}

function createTestOwnedWriteServer(etsyClient, stats) {
  const options = {
    enabledCapabilities: ["public", "account", "write"],
    developmentMode: true,
    registrations: [
      {
        capability: "public",
        tool: {
          name: "test_public_read",
          description: "Test-owned public read",
          inputSchema: { type: "object", properties: {} },
        },
        handler: async () => ({
          content: [{ type: "text", text: "public read succeeded" }],
        }),
      },
      {
        capability: "write",
        tool: {
          name: "test_write",
          description: "Test-owned write; never a production tool",
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
          },
          inputSchema: { type: "object", properties: {} },
        },
        handler: async () => {
          stats.handlerCalls += 1;
          await etsyClient.post("/application/test-write", {
            private_request_body: "synthetic-private-value",
          });
          return { content: [{ type: "text", text: "unexpected write" }] };
        },
      },
    ],
  };
  const registry = new CapabilityRegistry(options);
  options.developmentMode = false;

  const server = new Server(
    { name: "etsy-development-mode-test", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: registry.listTools(),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      return await registry.dispatch(
        request.params.name,
        request.params.arguments,
      );
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : "Request failed."}`,
        }],
        isError: true,
      };
    }
  });

  return { server, registry };
}

test("development mode is enabled only by exact true and absent, empty, or false stays off", async () => {
  for (const [setting, blocked, factoryOptions] of [
    [undefined, false, undefined],
    ["", false, undefined],
    ["false", false, undefined],
    ["true", true, { developmentMode: false }],
  ]) {
    await withDevelopmentMode(setting, async () => {
      const client = createEtsyClient(syntheticKey, factoryOptions);
      const adapterCalls = [];
      client.defaults.adapter = mockAdapter(
        (config) => successResponse(config, { ok: true }),
        adapterCalls,
      );

      if (blocked) {
        await assert.rejects(
          client.post("/application/test-write", { private: "synthetic-value" }),
          DEVELOPMENT_MODE_ERROR,
        );
        assert.equal(adapterCalls.length, 0);
      } else {
        const response = await client.post("/application/test-write", {
          private: "synthetic-value",
        });
        assert.deepEqual(response.data, { ok: true });
        assert.equal(adapterCalls.length, 1);
      }
    });
  }
});

test("invalid environment values fail startup without echoing the supplied value", async () => {
  for (const setting of ["TRUE", "on", " true ", "1"]) {
    await withDevelopmentMode(setting, () => {
      assert.throws(
        () => createEtsyClient(syntheticKey),
        (error) => {
          assert.match(error.message, /ETSY_DEVELOPMENT_MODE/);
          assert.equal(error.message.includes(setting), false);
          return true;
        },
      );
      assert.throws(
        () => createEtsyMcpServer(axios.create()),
        /ETSY_DEVELOPMENT_MODE/,
      );
    });
  }
});

test("invalid factory configuration is rejected without exposing the value", async () => {
  await withDevelopmentMode("false", () => {
    assert.throws(
      () => createEtsyClient(syntheticKey, { developmentMode: "true" }),
      (error) => {
        assert.match(error.message, /ETSY_DEVELOPMENT_MODE/);
        assert.equal(error.message.includes("true"), false);
        return true;
      },
    );
    assert.throws(
      () => createEtsyMcpServer(axios.create(), { developmentMode: 1 }),
      /ETSY_DEVELOPMENT_MODE/,
    );
  });
});

test("Axios mutation methods are blocked before adapters while safe methods proceed", async () => {
  await withDevelopmentMode("true", async () => {
    const options = { developmentMode: true };
    const client = createEtsyClient(syntheticKey, options);
    options.developmentMode = false;
    process.env.ETSY_DEVELOPMENT_MODE = "false";

    const adapterCalls = [];
    client.defaults.adapter = mockAdapter(
      (config) => successResponse(config, { ok: true }),
      adapterCalls,
    );

    const blockedRequests = [
      () => client.post("/application/write", { private: "synthetic-body" }),
      () => client.put("/application/write", { private: "synthetic-body" }),
      () => client.patch("/application/write", { private: "synthetic-body" }),
      () => client.delete("/application/write"),
      () => client.request({ url: "/application/write", method: "POST" }),
      () => client.request({
        url: "/application/write",
        method: "pAtCh",
        developmentMode: false,
        headers: { "x-development-mode": "false" },
      }),
    ];

    for (const request of blockedRequests) {
      await assert.rejects(request(), DEVELOPMENT_MODE_ERROR);
    }
    assert.equal(adapterCalls.length, 0);

    for (const request of [
      () => client.get("/application/read"),
      () => client.head("/application/read"),
      () => client.request({ url: "/application/read", method: "OPTIONS" }),
    ]) {
      const response = await request();
      assert.deepEqual(response.data, { ok: true });
    }
    assert.equal(adapterCalls.length, 3);

    const serverFactoryClient = axios.create();
    const serverFactoryAdapterCalls = [];
    serverFactoryClient.defaults.adapter = mockAdapter(
      (config) => successResponse(config, { ok: true }),
      serverFactoryAdapterCalls,
    );
    createEtsyMcpServer(serverFactoryClient, { developmentMode: true });
    await assert.rejects(
      serverFactoryClient.request({
        url: "/application/write",
        method: "DELETE",
      }),
      DEVELOPMENT_MODE_ERROR,
    );
    assert.equal(serverFactoryAdapterCalls.length, 0);
  });
});

test("request transforms cannot turn an initially safe method into a mutation", async () => {
  await withDevelopmentMode("true", async () => {
    const client = createEtsyClient(syntheticKey);
    const adapterCalls = [];
    client.defaults.adapter = mockAdapter(
      (config) => successResponse(config, { ok: true }),
      adapterCalls,
    );

    await assert.rejects(
      client.get("/application/read", {
        transformRequest: [function rewriteMethod(data) {
          this.method = "post";
          return data;
        }],
      }),
      DEVELOPMENT_MODE_ERROR,
    );
    assert.equal(adapterCalls.length, 0);
  });
});

test("locked mode fails closed on a request interceptor that replaces config", async () => {
  await withDevelopmentMode(undefined, async () => {
    const client = axios.create();
    const interceptorCalls = [];
    client.interceptors.request.use((config) => {
      interceptorCalls.push(true);
      return {
        ...config,
        transformRequest: [function rewriteMethod(data) {
          this.method = "delete";
          return data;
        }],
      };
    });
    assert.throws(
      () => createEtsyMcpServer(client, { developmentMode: true }),
      (error) => {
        assert.equal(error.name, "DevelopmentModeConfigurationError");
        assert.match(error.message, /request interceptors.*not supported/i);
        return true;
      },
    );
    assert.equal(interceptorCalls.length, 0);
  });
});

test("request interceptor APIs cannot remove or bypass an active lock", async () => {
  await withDevelopmentMode("false", async () => {
    const client = axios.create();
    const adapterCalls = [];
    client.defaults.adapter = mockAdapter(
      (config) => successResponse(config, { ok: true }),
      adapterCalls,
    );
    createEtsyMcpServer(client, { developmentMode: true });

    const requestInterceptors = client.interceptors.request;
    const blockedChanges = [
      () => requestInterceptors.use(() => { throw new Error("must not run"); }),
      () => requestInterceptors.eject(0),
      () => requestInterceptors.clear(),
    ];
    for (const change of blockedChanges) {
      assert.throws(change, /ETSY_DEVELOPMENT_MODE/);
    }

    await assert.rejects(
      client.post("/application/test-only", {}),
      DEVELOPMENT_MODE_ERROR,
    );
    const safeResponse = await client.get("/application/read");
    assert.deepEqual(safeResponse.data, { ok: true });
    assert.equal(adapterCalls.length, 1);
  });
});

test("per-call adapters and transforms cannot replace the final method guard", async () => {
  await withDevelopmentMode("true", async () => {
    const client = createEtsyClient(syntheticKey);
    const configuredAdapterCalls = [];
    const replacementAdapterCalls = [];
    const configuredAdapter = mockAdapter(
      (config) => successResponse(config, { adapter: "configured" }),
      configuredAdapterCalls,
    );
    const replacementAdapter = mockAdapter(
      (config) => successResponse(config, { adapter: "replacement" }),
      replacementAdapterCalls,
    );

    await assert.rejects(
      client.get("/application/read", {
        adapter: configuredAdapter,
        transformRequest: [function replaceAdapterAndMethod(data) {
          this.method = "patch";
          this.adapter = replacementAdapter;
          return data;
        }],
      }),
      DEVELOPMENT_MODE_ERROR,
    );
    assert.equal(configuredAdapterCalls.length, 0);
    assert.equal(replacementAdapterCalls.length, 0);

    const safeResponse = await client.get("/application/read", {
      adapter: configuredAdapter,
    });
    assert.deepEqual(safeResponse.data, { adapter: "configured" });
    assert.equal(configuredAdapterCalls.length, 1);
    assert.equal(replacementAdapterCalls.length, 0);
  });
});

test("locked registry hides test-owned writes and denies direct calls before handlers", async () => {
  await withDevelopmentMode("false", async () => {
    const adapterCalls = [];
    const stats = { handlerCalls: 0 };
    await withMcp(
      mockAdapter((config) => successResponse(config, {}), adapterCalls),
      async ({ client }) => {
        process.env.ETSY_DEVELOPMENT_MODE = "false";
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map((tool) => tool.name), ["test_public_read"]);

        const publicResult = await client.callTool({
          name: "test_public_read",
          arguments: {},
        });
        assert.equal(publicResult.isError, undefined);

        const writeResult = await client.callTool({
          name: "test_write",
          arguments: {
            developmentMode: false,
            capability: "public",
            access_token: "synthetic-untrusted-token",
          },
          _meta: { developmentMode: false, capability: "public" },
        });
        assert.equal(writeResult.isError, true);
        assert.match(writeResult.content[0].text, DEVELOPMENT_MODE_ERROR);
        assert.equal(writeResult.content[0].text.includes("synthetic-untrusted-token"), false);
        assert.equal(writeResult.content[0].text.includes("synthetic-private-value"), false);
        assert.equal(stats.handlerCalls, 0);
        assert.equal(adapterCalls.length, 0);
      },
      (etsyClient) => {
        const testServer = createTestOwnedWriteServer(etsyClient, stats);
        return testServer.server;
      },
    );
  });
});

test("production server keeps all twenty-eight read tools and successful GETs available while locked", async () => {
  await withDevelopmentMode("true", async () => {
    const adapterCalls = [];
    await withMcp(
      mockAdapter((config) => successResponse(config, { count: 0, results: [] }), adapterCalls),
      async ({ client }) => {
        process.env.ETSY_DEVELOPMENT_MODE = "false";
        const listed = await client.listTools();
        assert.deepEqual(
          listed.tools.map((tool) => tool.name).sort(),
          [
            "get_featured_shop_listings",
            "get_listing_buyer_prices",
            "get_listing_details",
            "get_listing_image",
            "get_listing_images",
            "get_listing_personalization",
            "get_listing_properties",
            "get_listing_reviews",
            "get_listing_translation",
            "get_listing_video",
            "get_listing_videos",
            "get_listings_batch",
            "get_shipping_carriers",
            "get_shop",
            "get_shop_by_name",
            "get_shop_by_owner",
            "get_shop_listings",
            "get_shop_return_policies",
            "get_shop_return_policy",
            "get_shop_reviews",
            "get_shop_section",
            "get_shop_section_listings",
            "get_shop_sections",
            "get_taxonomy_nodes",
            "get_taxonomy_properties",
            "ping_etsy",
            "search_listings",
            "search_shops",
          ],
        );
        const result = await client.callTool({
          name: "search_listings",
          arguments: { keywords: "ceramic mug", limit: 1 },
        });
        assert.equal(result.isError, undefined);
        assert.equal(adapterCalls.length, 1);
        assert.equal(adapterCalls[0].method, "get");
      },
      (etsyClient) => createEtsyMcpServer(etsyClient),
    );
  });
});

test("production discovery does not register writes when the lock is disabled", async () => {
  await withDevelopmentMode("false", async () => {
    const adapterCalls = [];
    await withMcp(
      mockAdapter((config) => successResponse(config, {}), adapterCalls),
      async ({ client }) => {
        const { tools } = await client.listTools();
        assert.equal(tools.length, 28);
        assert.equal(tools.some((tool) => tool.name === "test_write"), false);
        assert.equal(tools.some((tool) => tool.name === "create_draft_listing"), false);
      },
      (etsyClient) => createEtsyMcpServer(etsyClient, { developmentMode: false }),
    );
  });
});

test("CLI rejects invalid mode configuration before writing MCP protocol output", () => {
  const result = spawnSync(process.execPath, ["build/index.js"], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 3000,
    env: {
      ...process.env,
      ETSY_API_KEY: syntheticKey,
      ETSY_DEVELOPMENT_MODE: "not-a-boolean-secret",
    },
  });

  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /ETSY_DEVELOPMENT_MODE/);
  assert.equal(result.stderr.includes("not-a-boolean-secret"), false);
});
