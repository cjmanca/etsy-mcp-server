import assert from "node:assert/strict";
import test from "node:test";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  createOAuthServiceHarness,
  syntheticConnection,
  syntheticConnectionIdFor,
} from "./helpers/oauth.js";
import {
  jsonText,
  mockAdapter,
  successResponse,
  withMcp,
} from "./helpers/mcp.js";

const authorizationModule = await import("../build/oauth/authorization.js").catch(() => undefined);
const authorizeOperation = authorizationModule?.authorizeOperation;
const { CapabilityRegistry } = await import("../build/index.js");
const CONNECTION_ID = "AAAAAAAAAAAAAAAAAAAAAA";
const BASE_TIME = 1_800_000_000_000;

function createAuthorizationDispatchServer(etsyClient, options) {
  const state = { dispatchAttempts: 0, protectedWork: 0 };
  const enabledCapabilities = options.enabledCapabilities ?? ["public", "account"];
  const registrations = options.operations.map((operation) => ({
    capability: operation.capability ?? "account",
    ...(operation.available === undefined ? {} : { available: operation.available }),
    prerequisite: operation.prerequisite,
    tool: {
      name: operation.name,
      description: "Test-owned operation used to exercise OAuth authorization dispatch.",
      inputSchema: {
        type: "object",
        properties: {
          connection_id: { type: "string", pattern: "^[A-Za-z0-9_-]{22}$" },
          ...(operation.requirement.resource === "account"
            ? {}
            : { shop_id: { type: "integer", minimum: 1 } }),
        },
        required: [
          "connection_id",
          ...(operation.requirement.resource === "account" ? [] : ["shop_id"]),
        ],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    handler: async (args) => {
      state.dispatchAttempts += 1;
      options.onDispatchAttempt?.(state.dispatchAttempts);
      if (
        args === null ||
        typeof args !== "object" ||
        Array.isArray(args) ||
        Object.keys(args).some((key) =>
          key !== "connection_id" && key !== "shop_id"
        ) ||
        typeof args.connection_id !== "string" ||
        (operation.requirement.resource !== "account" &&
          (!Number.isSafeInteger(args.shop_id) || args.shop_id <= 0))
      ) {
        throw new Error("Test operation arguments are invalid.");
      }

      const result = await options.service.withConnection(
        args.connection_id,
        async (record) => {
          authorizeOperation({
            record,
            owner: options.trustedOwner,
            currentGeneration: options.currentGeneration(args.connection_id),
            required: operation.requirement,
            enabledCapabilities,
            ...(operation.requirement.resource === "account"
              ? {}
              : { requestedShopId: args.shop_id }),
            relationshipVerified: operation.relationshipVerified ?? false,
            developmentMode: options.developmentMode ?? false,
          });
          state.protectedWork += 1;
          const requestPath = typeof operation.path === "function"
            ? operation.path(args)
            : operation.path ?? `/shops/${args.shop_id}`;
          const response = await etsyClient.get(requestPath, {
            headers: { Authorization: `Bearer ${record.accessToken}` },
          });
          return response.data;
        },
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  }));
  const registry = new CapabilityRegistry({
    enabledCapabilities,
    developmentMode: options.developmentMode ?? false,
    registrations,
  });
  const server = new Server(
    { name: "etsy-oauth-authorization-test", version: "1.0.0" },
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
    } catch {
      return {
        content: [{ type: "text", text: "Error: Test operation is unavailable or unauthorized." }],
        isError: true,
      };
    }
  });
  return { server, state, registry };
}

async function createAuthorizationFixture(t, options = {}) {
  const fixture = await createOAuthServiceHarness(t, options);
  t.after(async () => fixture.service.close());
  return fixture;
}

async function withAuthorizationMcp(fixture, options, adapter, run) {
  let dispatch;
  return withMcp(
    adapter,
    async ({ client, etsyClient }) => run({ client, etsyClient, dispatch }),
    (etsyClient) => {
      dispatch = createAuthorizationDispatchServer(etsyClient, {
        service: fixture.service,
        ...options,
      });
      return dispatch.server;
    },
  );
}

function ownContext(record) {
  return {
    operatorId: record.owner.operatorId,
    appFingerprint: record.owner.appFingerprint,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function authorizationInput(record, overrides = {}) {
  return {
    record,
    owner: ownContext(record),
    currentGeneration: record.generation,
    required: {
      scopes: ["shops_r"],
      capability: "account",
      resource: "account",
    },
    enabledCapabilities: ["account"],
    relationshipVerified: false,
    developmentMode: false,
    ...overrides,
  };
}

function updateShopRequirement(record, overrides = {}) {
  return authorizationInput(record, {
    required: {
      scopes: ["shops_r", "shops_w"],
      capability: "write",
      resource: "shop",
    },
    enabledCapabilities: ["account", "write"],
    requestedShopId: record.shopId,
    ...overrides,
  });
}

test("actual grants authorize independently of unavailable diagnostic", async (t) => {
  if (typeof authorizeOperation !== "function") {
    assert.fail("authorizeOperation must enforce the documented getMe shops_r requirement.");
  }

  const record = syntheticConnection({
    requestedScopes: ["shops_r"],
    grants: {
      scopes: ["shops_r"],
      source: "authorization_code_response",
      checkedAt: 1_800_000_000_000,
    },
  });
  const fixture = await createOAuthServiceHarness(t, { records: [record] });

  assert.equal(fixture.service.scopeInspectionAvailable, false);
  const authorized = await fixture.service.withConnection(CONNECTION_ID, async (freshRecord) => {
    authorizeOperation(authorizationInput(freshRecord));
    return true;
  });

  assert.equal(authorized, true);
  assert.deepEqual(fixture.transport.calls.refreshes, []);
});

test("getMe and updateShop require their exact documented scopes", async (t) => {
  if (typeof authorizeOperation !== "function") {
    assert.fail("authorizeOperation must enforce fixed per-operation scope requirements.");
  }

  const identityRecord = syntheticConnection({
    requestedScopes: ["shops_r"],
    grants: {
      scopes: ["shops_r"],
      source: "authorization_code_response",
      checkedAt: 1_800_000_000_000,
    },
  });
  assert.doesNotThrow(() => authorizeOperation(authorizationInput(identityRecord)));

  const shopWriteRecord = syntheticConnection({
    requestedScopes: ["shops_r", "shops_w"],
    grants: {
      scopes: ["shops_r", "shops_w"],
      source: "authorization_code_response",
      checkedAt: 1_800_000_000_000,
    },
  });
  assert.doesNotThrow(() => authorizeOperation(updateShopRequirement(shopWriteRecord)));
});

test("malformed trusted scope arrays are not split into multiple entries", () => {
  const record = syntheticConnection({
    requestedScopes: ["shops_r", "shops_w"],
    grants: {
      scopes: ["shops_r", "shops_w"],
      source: "authorization_code_response",
      checkedAt: BASE_TIME,
    },
  });
  const malformedInputs = [
    updateShopRequirement({
      ...record,
      grants: { ...record.grants, scopes: ["shops_r shops_w"] },
    }),
    updateShopRequirement({
      ...record,
      requestedScopes: ["shops_r shops_w"],
    }),
    updateShopRequirement(record, {
      required: {
        scopes: ["shops_r shops_w"],
        capability: "write",
        resource: "shop",
      },
    }),
    updateShopRequirement({
      ...record,
      grants: { ...record.grants, scopes: ["shops_r", "shops_r"] },
    }),
  ];

  for (const input of malformedInputs) {
    assert.throws(() => authorizeOperation(input), { name: "OAuthError" });
  }
});

test("missing scopes and stale owner generation deny direct dispatch", async (t) => {
  if (typeof authorizeOperation !== "function") {
    assert.fail("authorizeOperation must deny reduced grants and stale generations.");
  }

  const reducedRecord = syntheticConnection({
    requestedScopes: ["shops_r", "shops_w"],
    grants: {
      scopes: ["shops_w"],
      source: "refresh_response",
      checkedAt: 1_800_000_000_000,
    },
  });
  assert.throws(() => authorizeOperation(updateShopRequirement(reducedRecord)), { name: "OAuthError" });

  const freshRecord = syntheticConnection();
  assert.throws(() => authorizeOperation(authorizationInput(freshRecord, {
    currentGeneration: freshRecord.generation + 1,
  })), { name: "OAuthError" });
});

test("foreign owner metadata never authorizes a connection", async (t) => {
  if (typeof authorizeOperation !== "function") {
    assert.fail("authorizeOperation must compare the trusted operator and application owner.");
  }

  const record = syntheticConnection({
    owner: {
      operatorId: "another_operator",
      appFingerprint: syntheticConnection().owner.appFingerprint,
    },
    requestedScopes: ["shops_r", "shops_w", "listings_r", "transactions_r"],
    grants: {
      scopes: ["shops_r", "shops_w", "listings_r", "transactions_r"],
      source: "authorization_code_response",
      checkedAt: 1_800_000_000_000,
    },
  });
  const input = authorizationInput(record, {
    owner: {
      operatorId: "trusted_operator",
      appFingerprint: record.owner.appFingerprint,
    },
    required: {
      scopes: ["shops_r"],
      capability: "account",
      resource: "account",
    },
    enabledCapabilities: ["account", "write", "model-supplied-capability"],
    modelName: "trusted_operator",
    connectionId: CONNECTION_ID,
    scopes: ["shops_r", "shops_w", "listings_r", "transactions_r"],
  });

  assert.throws(() => authorizeOperation(input), { name: "OAuthError" });
});

test("foreign shops, unverified relationships, and unusable records are denied", async (t) => {
  if (typeof authorizeOperation !== "function") {
    assert.fail("authorizeOperation must enforce resource relationships and usable connection state.");
  }

  const shopRecord = syntheticConnection({
    requestedScopes: ["shops_r", "shops_w"],
    grants: {
      scopes: ["shops_r", "shops_w"],
      source: "authorization_code_response",
      checkedAt: 1_800_000_000_000,
    },
  });
  assert.throws(() => authorizeOperation(updateShopRequirement(shopRecord, {
    requestedShopId: shopRecord.shopId + 1,
  })), { name: "OAuthError" });

  const relationshipRequirement = {
    scopes: ["listings_r"],
    capability: "account",
    resource: "verified_relationship",
  };
  const relatedRecord = syntheticConnection({
    requestedScopes: ["shops_r", "listings_r"],
    grants: {
      scopes: ["shops_r", "listings_r"],
      source: "authorization_code_response",
      checkedAt: 1_800_000_000_000,
    },
  });
  assert.throws(() => authorizeOperation(authorizationInput(relatedRecord, {
    required: relationshipRequirement,
    relationshipVerified: false,
  })), { name: "OAuthError" });

  for (const state of ["reconnect_required", "recovery_required", "scope_verification_required"]) {
    assert.throws(() => authorizeOperation(authorizationInput(syntheticConnection({ state }))), {
      name: "OAuthError",
    });
  }
});

test("write scope cannot substitute for a read scope or the write safety gate", async (t) => {
  if (typeof authorizeOperation !== "function") {
    assert.fail("authorizeOperation must not infer read access from write grants.");
  }

  const writeOnlyRecord = syntheticConnection({
    requestedScopes: ["shops_r", "shops_w"],
    grants: {
      scopes: ["shops_w"],
      source: "authorization_code_response",
      checkedAt: 1_800_000_000_000,
    },
  });
  assert.throws(() => authorizeOperation(authorizationInput(writeOnlyRecord)), { name: "OAuthError" });

  const fullWriteRecord = syntheticConnection({
    requestedScopes: ["shops_r", "shops_w"],
    grants: {
      scopes: ["shops_r", "shops_w"],
      source: "authorization_code_response",
      checkedAt: 1_800_000_000_000,
    },
  });
  assert.throws(() => authorizeOperation(updateShopRequirement(fullWriteRecord, {
    enabledCapabilities: ["account"],
  })), { name: "OAuthError" });
  assert.throws(() => authorizeOperation(updateShopRequirement(fullWriteRecord, {
    developmentMode: true,
  })), { name: "OAuthError", reason: "development_mode_locked" });
});

test("unrequested grants do not reach a registered protected adapter", async (t) => {
  const record = syntheticConnection({
    generation: 7,
    requestedScopes: ["shops_r"],
    grants: {
      scopes: ["shops_r", "listings_r"],
      source: "authorization_code_response",
      checkedAt: BASE_TIME,
    },
  });
  const fixture = await createAuthorizationFixture(t, { records: [record] });
  const trustedGenerations = new Map([[CONNECTION_ID, 7]]);
  const adapterCalls = [];

  await withAuthorizationMcp(
    fixture,
    {
      enabledCapabilities: ["public", "account"],
      trustedOwner: fixture.config.owner,
      currentGeneration: (connectionId) => trustedGenerations.get(connectionId),
      operations: [{
        name: "test_authorized_listing_read",
        requirement: {
          scopes: ["listings_r"],
          capability: "account",
          resource: "shop",
        },
        path: "/test-only/private-listing-read",
      }],
    },
    mockAdapter((config) => successResponse(config, { authorized: true }), adapterCalls),
    async ({ client, dispatch }) => {
      const result = await client.callTool({
        name: "test_authorized_listing_read",
        arguments: { connection_id: CONNECTION_ID, shop_id: record.shopId },
      });

      assert.deepEqual(
        {
          isError: result.isError,
          protectedWork: dispatch.state.protectedWork,
          adapterCalls: adapterCalls.length,
        },
        { isError: true, protectedWork: 0, adapterCalls: 0 },
      );
    },
  );
});

test("registered private-read dispatch succeeds with independent trusted proofs while diagnostics are unavailable", async (t) => {
  const record = syntheticConnection({
    generation: 7,
    requestedScopes: ["shops_r"],
    grants: {
      scopes: ["shops_r"],
      source: "authorization_code_response",
      checkedAt: BASE_TIME,
    },
  });
  const fixture = await createAuthorizationFixture(t, { records: [record] });
  const trustedGenerations = new Map([[CONNECTION_ID, 7]]);
  const adapterCalls = [];
  assert.notStrictEqual(fixture.config.owner, record.owner);

  await withAuthorizationMcp(
    fixture,
    {
      enabledCapabilities: ["public", "account"],
      trustedOwner: fixture.config.owner,
      currentGeneration: (connectionId) => trustedGenerations.get(connectionId),
      operations: [{
        name: "test_authorized_shop_read",
        requirement: {
          scopes: ["shops_r"],
          capability: "account",
          resource: "shop",
        },
      }],
    },
    mockAdapter((config) => successResponse(config, { shop_id: record.shopId }), adapterCalls),
    async ({ client, dispatch }) => {
      assert.equal(fixture.service.scopeInspectionAvailable, false);
      const { tools } = await client.listTools();
      assert.ok(tools.some((tool) => tool.name === "test_authorized_shop_read"));

      const result = await client.callTool({
        name: "test_authorized_shop_read",
        arguments: { connection_id: CONNECTION_ID, shop_id: record.shopId },
      });
      assert.equal(result.isError, undefined);
      assert.deepEqual(jsonText(result), { shop_id: record.shopId });
      assert.equal(dispatch.state.protectedWork, 1);
      assert.equal(adapterCalls.length, 1);
      assert.equal(adapterCalls[0].method, "get");
      assert.equal(adapterCalls[0].url, `/shops/${record.shopId}`);
      assert.equal(
        adapterCalls[0].headers.Authorization,
        `Bearer ${record.accessToken}`,
      );

      const readsBeforeSpoof = fixture.store.calls.reads.length;
      const spoofed = await client.callTool({
        name: "test_authorized_shop_read",
        arguments: {
          connection_id: CONNECTION_ID,
          shop_id: record.shopId,
          owner: { operatorId: "synthetic_operator", appFingerprint: record.owner.appFingerprint },
          current_generation: 7,
          scopes: ["shops_r"],
          enabled_capabilities: ["public", "account"],
        },
      });
      assert.equal(spoofed.isError, true);
      assert.equal(fixture.store.calls.reads.length, readsBeforeSpoof);
      assert.equal(dispatch.state.protectedWork, 1);
      assert.equal(adapterCalls.length, 1);
      assert.deepEqual(fixture.transport.calls.refreshes, []);
    },
  );
});

test("missing and unknown grants deny registered protected work", async (t) => {
  const missingId = syntheticConnectionIdFor(1);
  const unknownId = syntheticConnectionIdFor(2);
  const missing = syntheticConnection({
    connectionId: missingId,
    generation: 9,
    requestedScopes: ["shops_r", "listings_r"],
    grants: {
      scopes: ["shops_r"],
      source: "authorization_code_response",
      checkedAt: BASE_TIME,
    },
  });
  const unknown = syntheticConnection({
    connectionId: unknownId,
    generation: 10,
    requestedScopes: ["shops_r"],
    grants: {
      scopes: ["shops_r", "unknown_scope"],
      source: "authorization_code_response",
      checkedAt: BASE_TIME,
    },
  });
  const fixture = await createAuthorizationFixture(t, { records: [missing, unknown] });
  const trustedGenerations = new Map([[missingId, 9], [unknownId, 10]]);
  const adapterCalls = [];

  await withAuthorizationMcp(
    fixture,
    {
      enabledCapabilities: ["public", "account"],
      trustedOwner: fixture.config.owner,
      currentGeneration: (connectionId) => trustedGenerations.get(connectionId),
      operations: [{
        name: "test_authorized_listing_read",
        requirement: {
          scopes: ["listings_r"],
          capability: "account",
          resource: "shop",
        },
      }],
    },
    mockAdapter((config) => successResponse(config, { unexpected: true }), adapterCalls),
    async ({ client, dispatch }) => {
      for (const [connectionId, shopId] of [[missingId, missing.shopId], [unknownId, unknown.shopId]]) {
        const result = await client.callTool({
          name: "test_authorized_listing_read",
          arguments: { connection_id: connectionId, shop_id: shopId },
        });
        assert.equal(result.isError, true);
      }
      assert.equal(dispatch.state.protectedWork, 0);
      assert.equal(adapterCalls.length, 0);
    },
  );
});

test("concurrent dispatch and ensureFresh share refresh and reject reduced grants", async (t) => {
  const record = syntheticConnection({
    generation: 11,
    issuedAt: BASE_TIME,
    expiresAt: BASE_TIME + 30_000,
    requestedScopes: ["shops_r", "listings_r"],
    grants: {
      scopes: ["shops_r", "listings_r"],
      source: "authorization_code_response",
      checkedAt: BASE_TIME,
    },
  });
  const fixture = await createAuthorizationFixture(t, {
    initialTime: BASE_TIME,
    records: [record],
  });
  const trustedGenerations = new Map([[CONNECTION_ID, 11]]);
  const refreshStarted = deferred();
  const twoDispatchesStarted = deferred();
  const releaseRefresh = deferred();
  fixture.transport.setRefresh(async () => {
    trustedGenerations.set(CONNECTION_ID, 12);
    refreshStarted.resolve();
    await releaseRefresh.promise;
    return {
      accessToken: "12345.synthetic-refreshed-access-token",
      refreshToken: "12345.synthetic-refreshed-refresh-token",
      expiresIn: 3600,
      grants: {
        scopes: ["shops_r"],
        source: "refresh_response",
        checkedAt: BASE_TIME,
      },
    };
  });
  const adapterCalls = [];

  await withAuthorizationMcp(
    fixture,
    {
      enabledCapabilities: ["public", "account"],
      trustedOwner: fixture.config.owner,
      currentGeneration: (connectionId) => trustedGenerations.get(connectionId),
      onDispatchAttempt: (count) => {
        if (count === 2) twoDispatchesStarted.resolve();
      },
      operations: [{
        name: "test_authorized_listing_read",
        requirement: {
          scopes: ["listings_r"],
          capability: "account",
          resource: "shop",
        },
      }],
    },
    mockAdapter((config) => successResponse(config, { unexpected: true }), adapterCalls),
    async ({ client, dispatch }) => {
      const concurrent = Promise.all([
        client.callTool({
          name: "test_authorized_listing_read",
          arguments: { connection_id: CONNECTION_ID, shop_id: record.shopId },
        }),
        client.callTool({
          name: "test_authorized_listing_read",
          arguments: { connection_id: CONNECTION_ID, shop_id: record.shopId },
        }),
        fixture.service.ensureFresh(CONNECTION_ID),
      ]);
      await Promise.all([refreshStarted.promise, twoDispatchesStarted.promise]);
      try {
        assert.equal(dispatch.state.dispatchAttempts, 2);
        assert.equal(fixture.transport.calls.refreshes.length, 1);
      } finally {
        releaseRefresh.resolve();
      }

      const [first, second, fresh] = await concurrent;
      assert.equal(first.isError, true);
      assert.equal(second.isError, true);
      assert.equal(fresh.generation, 12);
      assert.deepEqual(fresh.grants.scopes, ["shops_r"]);
      assert.equal(fixture.store.records.get(CONNECTION_ID).generation, 12);
      assert.deepEqual(fixture.store.records.get(CONNECTION_ID).grants.scopes, ["shops_r"]);
      assert.equal(dispatch.state.protectedWork, 0);
      assert.equal(adapterCalls.length, 0);
      assert.equal(fixture.transport.calls.refreshes.length, 1);
    },
  );
});

test("disconnect invalidates an in-flight dispatch and reconnect issues a fresh usable ID", async (t) => {
  const record = syntheticConnection({ generation: 5 });
  const fixture = await createAuthorizationFixture(t, { records: [record] });
  const trustedGenerations = new Map([[CONNECTION_ID, 5]]);
  const adapterStarted = deferred();
  const releaseFirstAdapter = deferred();
  const adapterCalls = [];
  const adapter = async (config) => {
    adapterCalls.push(config);
    if (adapterCalls.length === 1) {
      adapterStarted.resolve();
      await releaseFirstAdapter.promise;
    }
    return successResponse(config, { authorized: true, shop_id: record.shopId });
  };

  await withAuthorizationMcp(
    fixture,
    {
      enabledCapabilities: ["public", "account"],
      trustedOwner: fixture.config.owner,
      currentGeneration: (connectionId) => trustedGenerations.get(connectionId),
      operations: [{
        name: "test_authorized_shop_read",
        requirement: {
          scopes: ["shops_r"],
          capability: "account",
          resource: "shop",
        },
      }],
    },
    adapter,
    async ({ client, dispatch }) => {
      const inFlight = client.callTool({
        name: "test_authorized_shop_read",
        arguments: { connection_id: CONNECTION_ID, shop_id: record.shopId },
      });
      await adapterStarted.promise;
      const disconnecting = fixture.service.disconnect(CONNECTION_ID);
      const readsAfterDisconnectStart = fixture.store.calls.reads.length;
      const stale = await client.callTool({
        name: "test_authorized_shop_read",
        arguments: { connection_id: CONNECTION_ID, shop_id: record.shopId },
      });
      assert.equal(stale.isError, true);
      assert.equal(fixture.store.calls.reads.length, readsAfterDisconnectStart);
      assert.equal(dispatch.state.protectedWork, 1);
      assert.equal(adapterCalls.length, 1);

      releaseFirstAdapter.resolve();
      const [inFlightResult, disconnected] = await Promise.all([inFlight, disconnecting]);
      assert.equal(inFlightResult.isError, true);
      assert.deepEqual(disconnected, {
        connection_id: CONNECTION_ID,
        state: "disconnected",
        local_credentials_removed: true,
        upstream_revoked: false,
      });
      assert.equal(fixture.store.records.has(CONNECTION_ID), false);

      const pending = await fixture.service.begin({ bundles: [] });
      const callbackState = new URL(pending.authorization_url).searchParams.get("state");
      assert.equal(await fixture.service.completeCallback({
        state: callbackState,
        code: "synthetic-reconnect-code",
      }), "complete");
      assert.notEqual(pending.connection_id, CONNECTION_ID);
      trustedGenerations.set(pending.connection_id, 1);

      const reconnected = await client.callTool({
        name: "test_authorized_shop_read",
        arguments: { connection_id: pending.connection_id, shop_id: record.shopId },
      });
      assert.equal(reconnected.isError, undefined);
      assert.deepEqual(jsonText(reconnected), { authorized: true, shop_id: record.shopId });
      assert.equal(dispatch.state.protectedWork, 2);
      assert.equal(adapterCalls.length, 2);
    },
  );
});

test("foreign owners, stale generations, and IDs cannot reach registered protected work", async (t) => {
  const foreignId = CONNECTION_ID;
  const staleId = syntheticConnectionIdFor(4);
  const wrongShopId = syntheticConnectionIdFor(5);
  const staleGeneration = syntheticConnection({
    connectionId: staleId,
    generation: 8,
  });
  const owned = syntheticConnection({
    connectionId: wrongShopId,
    generation: 6,
  });
  const foreign = syntheticConnection({
    connectionId: foreignId,
    generation: 4,
    owner: {
      operatorId: "foreign_operator",
      appFingerprint: syntheticConnection().owner.appFingerprint,
    },
  });
  const missingId = syntheticConnectionIdFor(3);
  const fixture = await createAuthorizationFixture(t, { records: [foreign, staleGeneration, owned] });
  const trustedGenerations = new Map([[foreignId, 4], [staleId, 7], [wrongShopId, 6]]);
  const adapterCalls = [];

  await withAuthorizationMcp(
    fixture,
    {
      enabledCapabilities: ["public", "account"],
      trustedOwner: fixture.config.owner,
      currentGeneration: (connectionId) => trustedGenerations.get(connectionId),
      operations: [{
        name: "test_authorized_shop_read",
        requirement: {
          scopes: ["shops_r"],
          capability: "account",
          resource: "shop",
        },
      }],
    },
    mockAdapter((config) => successResponse(config, { unexpected: true }), adapterCalls),
    async ({ client, dispatch }) => {
      for (const [connectionId, shopId] of [
        [CONNECTION_ID, foreign.shopId],
        [staleId, staleGeneration.shopId],
        [missingId, foreign.shopId],
        [wrongShopId, owned.shopId + 1],
      ]) {
        const result = await client.callTool({
          name: "test_authorized_shop_read",
          arguments: { connection_id: connectionId, shop_id: shopId },
        });
        assert.equal(result.isError, true);
      }
      assert.equal(dispatch.state.protectedWork, 0);
      assert.equal(adapterCalls.length, 0);
    },
  );
});

test("disabled and hidden test-owned tools deny direct calls before protected work", async (t) => {
  const record = syntheticConnection();
  const fixture = await createAuthorizationFixture(t, { records: [record] });
  const trustedGenerations = new Map([[CONNECTION_ID, record.generation]]);
  const adapterCalls = [];
  const operation = {
    name: "test_authorized_shop_read",
    requirement: {
      scopes: ["shops_r"],
      capability: "account",
      resource: "shop",
    },
  };
  const adapter = mockAdapter((config) => successResponse(config, { unexpected: true }), adapterCalls);

  for (const options of [
    {
      enabledCapabilities: ["public"],
      trustedOwner: fixture.config.owner,
      currentGeneration: (connectionId) => trustedGenerations.get(connectionId),
      operations: [operation],
    },
    {
      enabledCapabilities: ["public", "account"],
      trustedOwner: fixture.config.owner,
      currentGeneration: (connectionId) => trustedGenerations.get(connectionId),
      operations: [{
        ...operation,
        available: false,
        prerequisite: "Test-owned protected dispatch is not enabled.",
      }],
    },
  ]) {
    await withAuthorizationMcp(fixture, options, adapter, async ({ client, dispatch }) => {
      const { tools } = await client.listTools();
      assert.equal(tools.some((tool) => tool.name === operation.name), false);
      const result = await client.callTool({
        name: operation.name,
        arguments: { connection_id: CONNECTION_ID, shop_id: record.shopId },
      });
      assert.equal(result.isError, true);
      assert.equal(dispatch.state.dispatchAttempts, 0);
      assert.equal(dispatch.state.protectedWork, 0);
    });
  }

  assert.deepEqual(fixture.store.calls.reads, []);
  assert.equal(adapterCalls.length, 0);
});
