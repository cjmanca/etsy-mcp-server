import assert from "node:assert/strict";
import test from "node:test";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  jsonText,
  mockAdapter,
  successResponse,
  withMcp,
} from "./helpers/mcp.js";

const { CapabilityRegistry, CapabilityUnavailableError } = await import(
  "../build/index.js"
);

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

function createCapabilityTestServer(etsyClient, calls) {
  const invokeDisabledHandler = async () => {
    calls.handlers += 1;
    await etsyClient.get("/application/should-not-run");
    return { content: [{ type: "text", text: "unexpected dispatch" }] };
  };
  const registry = new CapabilityRegistry({
    enabledCapabilities: ["public"],
    registrations: [
      {
        capability: "public",
        tool: {
          name: "test_public_read",
          description: "Test-owned public registration",
          inputSchema: { type: "object", properties: {} },
        },
        handler: async () => ({
          content: [{ type: "text", text: JSON.stringify({ ready: true }) }],
        }),
      },
      {
        capability: "account",
        tool: {
          name: "test_account_read",
          description: "Test-owned disabled account registration",
          annotations: READ_ONLY_ANNOTATIONS,
          inputSchema: { type: "object", properties: {} },
        },
        handler: invokeDisabledHandler,
      },
      {
        capability: "write",
        tool: {
          name: "test_write",
          description: "Test-owned disabled write registration",
          annotations: READ_ONLY_ANNOTATIONS,
          inputSchema: { type: "object", properties: {} },
        },
        handler: invokeDisabledHandler,
      },
      {
        capability: "event",
        tool: {
          name: "test_event_read",
          description: "Test-owned disabled event registration",
          inputSchema: { type: "object", properties: {} },
        },
        handler: invokeDisabledHandler,
      },
    ],
  });
  const server = new Server(
    { name: "etsy-capability-test", version: "1.0.0" },
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
      const message = error instanceof Error ? error.message : "Unknown failure.";
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  });
  return server;
}

test("only enabled test-owned capabilities are discoverable and dispatchable", async () => {
  assert.equal(typeof CapabilityRegistry, "function", "capability registry is exported");
  assert.equal(typeof CapabilityUnavailableError, "function");

  const calls = [];
  const dispatches = { handlers: 0 };
  await withMcp(
    mockAdapter((config) => successResponse(config, {}), calls),
    async ({ client }) => {
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((tool) => tool.name), ["test_public_read"]);

      const publicResult = await client.callTool({
        name: "test_public_read",
        arguments: {},
      });
      assert.deepEqual(jsonText(publicResult), { ready: true });

      const disabledAttempts = [
        ["test_account_read", /OAuth.*scope/i],
        ["test_write", /write.*authorization|confirmation/i],
        ["test_event_read", /event receiver/i],
      ];
      for (const [name, prerequisite] of disabledAttempts) {
        const result = await client.callTool({
          name,
          arguments: {
            connection_id: "model-supplied-connection",
            access_token: "synthetic-untrusted-token",
            capability: "public",
          },
        });
        assert.equal(result.isError, true, `${name} is denied`);
        assert.match(result.content[0].text, prerequisite, `${name} explains its prerequisite`);
        assert.equal(result.content[0].text.includes("synthetic-untrusted-token"), false);
      }
      assert.equal(dispatches.handlers, 0);
      assert.equal(calls.length, 0);
    },
    (etsyClient) => createCapabilityTestServer(etsyClient, dispatches),
  );
});

test("capability dependencies reject trusted configurations that skip prerequisites", () => {
  assert.equal(typeof CapabilityRegistry, "function", "capability registry is exported");
  assert.throws(
    () => new CapabilityRegistry({ enabledCapabilities: ["account"] }),
    /account.*public/i,
  );
  assert.throws(
    () => new CapabilityRegistry({ enabledCapabilities: ["write"] }),
    /write.*account/i,
  );
  assert.throws(
    () => new CapabilityRegistry({ enabledCapabilities: ["event"] }),
    /event.*account/i,
  );
});
