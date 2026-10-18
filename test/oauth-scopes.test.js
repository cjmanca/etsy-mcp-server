import assert from "node:assert/strict";
import test from "node:test";
import {
  createNativeWindowsOAuthFixture,
  createOAuthFixture,
  createOAuthServiceHarness,
  syntheticConnection,
  syntheticOAuthConfig,
  syntheticOAuthEnvKey,
} from "./helpers/oauth.js";
import {
  jsonText,
  mockAdapter,
  successResponse,
  withMcp,
} from "./helpers/mcp.js";

const scopesModule = await import("../build/oauth/scopes.js").catch(() => undefined);
const transportModule = await import("../build/oauth/transport.js").catch(() => undefined);
const serverModule = await import("../build/index.js");
const CONNECTION_ID = "AAAAAAAAAAAAAAAAAAAAAA";

function serverFactory(service, developmentMode) {
  const runtime = { developmentMode, service, close: async () => {} };
  return (client) => serverModule.createEtsyMcpServer(client, {
    developmentMode,
    oauth: runtime,
  });
}

async function nativeFixture(t) {
  return process.platform === "win32"
    ? createNativeWindowsOAuthFixture(t)
    : createOAuthFixture(t);
}

test("unsupported tokenScopes schema stays gated without resolving a token", async (t) => {
  const record = syntheticConnection();
  const fixture = await createOAuthServiceHarness(t, { records: [record] });

  if (fixture.service.scopeInspectionAvailable !== false) {
    assert.fail("scope inspection must remain unavailable until Etsy documents its response fields.");
  }
  if (typeof fixture.service.inspectScopes !== "function") {
    assert.fail("the known diagnostic must fail with a prerequisite before reading stored credentials.");
  }

  await assert.rejects(fixture.service.inspectScopes(CONNECTION_ID), {
    name: "OAuthError",
    reason: "oauth_scope_diagnostic_unavailable",
  });
  assert.deepEqual(fixture.store.calls.reads, []);
  assert.deepEqual(fixture.transport.calls.refreshes, []);
  assert.equal(typeof scopesModule?.parseDiagnosticScopes, "undefined");
});

test("production OAuth transport has no unsupported scope-inspection operation", async (t) => {
  if (typeof transportModule?.createOAuthTransport !== "function") {
    assert.fail("the fixed OAuth transport must be available for contract-gate verification.");
  }

  const fixture = await nativeFixture(t);
  const transport = transportModule.createOAuthTransport(
    syntheticOAuthConfig(fixture),
    syntheticOAuthEnvKey,
    async () => {},
  );
  assert.equal(transport.inspectScopes, undefined);
});

test("diagnostic is hidden but direct dispatch explains the gate under the local lock", async (t) => {
  const fixture = await createOAuthServiceHarness(t, {
    developmentMode: true,
    records: [syntheticConnection()],
  });

  await withMcp(
    mockAdapter((config) => successResponse(config, {})),
    async ({ client }) => {
      const { tools } = await client.listTools();
      assert.equal(tools.length, 31);
      assert.equal(tools.some((tool) => tool.name === "get_etsy_token_scopes"), false);
      assert.ok(tools.some((tool) => tool.name === "get_etsy_connection_status"));
      assert.ok(tools.some((tool) => tool.name === "disconnect_etsy_connection"));

      const result = await client.callTool({
        name: "get_etsy_token_scopes",
        arguments: { connection_id: CONNECTION_ID },
      });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /scope diagnostic.*official response.*not documented/i);
      assert.equal(result.content[0].text.includes("synthetic-access-token"), false);
      assert.deepEqual(fixture.store.calls.reads, []);
      assert.deepEqual(fixture.transport.calls.refreshes, []);

      const status = await client.callTool({
        name: "get_etsy_connection_status",
        arguments: { connection_id: CONNECTION_ID },
      });
      assert.equal(status.isError, undefined);
      assert.equal(jsonText(status).state, "connected");
    },
    serverFactory(fixture.service, true),
  );
});
